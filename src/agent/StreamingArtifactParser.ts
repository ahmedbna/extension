/**
 * StreamingArtifactParser
 *
 * Parses streamed assistant text and:
 *  1. SUPPRESSES all content inside <boltArtifact> tags from the visible chat.
 *  2. Collects file content inside <boltAction type="file"> and calls onFileComplete
 *     when the closing tag arrives.
 *  3. Cleans up stray trailing punctuation (lone commas) that the model sometimes
 *     emits just before or after an artifact block.
 *
 * The key correctness guarantee: text inside artifact tags NEVER reaches output.
 * Even if the artifact opening tag is split across two feed() calls (partial tag
 * at the end of a chunk), we hold the potential-tag prefix in the buffer and do
 * not emit it until we know it is NOT an artifact tag.
 */

export interface ParsedFileAction {
  filePath: string;
  content: string;
}

export interface ParserCallbacks {
  onFileComplete?: (file: ParsedFileAction) => void;
  onTextDelta?: (text: string) => void;
}

const ART_OPEN = '<boltArtifact';
const ART_CLOSE = '</boltArtifact>';
const ACT_OPEN = '<boltAction';
const ACT_CLOSE = '</boltAction>';

export class StreamingArtifactParser {
  private buf = '';
  private inArtifact = false;
  private inAction = false;
  private filePath = '';
  private fileContent = '';
  private callbacks: ParserCallbacks;

  constructor(callbacks: ParserCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * Feed one streamed delta into the parser.
   * Returns the text that should appear in the chat (may be empty string).
   */
  feed(chunk: string): string {
    this.buf += chunk;
    return this.process();
  }

  private process(): string {
    let out = '';
    let pos = 0;
    const buf = this.buf;

    while (pos < buf.length) {
      // ── Inside a <boltAction type="file"> block ────────────────────────
      if (this.inAction) {
        const end = buf.indexOf(ACT_CLOSE, pos);
        if (end === -1) {
          // Still streaming file content — accumulate and wait
          this.fileContent += buf.slice(pos);
          pos = buf.length;
        } else {
          this.fileContent += buf.slice(pos, end);
          const content = this.cleanContent(this.fileContent);
          if (this.filePath && content) {
            this.callbacks.onFileComplete?.({
              filePath: this.normalizePath(this.filePath),
              content: content + '\n',
            });
          }
          this.inAction = false;
          this.filePath = '';
          this.fileContent = '';
          pos = end + ACT_CLOSE.length;
        }
        continue;
      }

      // ── Inside <boltArtifact> but not yet in an action ─────────────────
      if (this.inArtifact) {
        const actStart = buf.indexOf(ACT_OPEN, pos);
        const artClose = buf.indexOf(ART_CLOSE, pos);

        if (actStart !== -1 && (artClose === -1 || actStart < artClose)) {
          // Found an action tag — parse it
          const tagEnd = buf.indexOf('>', actStart);
          if (tagEnd === -1) {
            // Incomplete tag — keep in buffer
            pos = buf.length;
            break;
          }
          const tag = buf.slice(actStart, tagEnd + 1);
          const typeMatch = tag.match(/type="([^"]+)"/);
          const pathMatch = tag.match(/filePath="([^"]+)"/);
          if (typeMatch?.[1] === 'file' && pathMatch?.[1]) {
            this.inAction = true;
            this.filePath = pathMatch[1];
            this.fileContent = '';
          }
          pos = tagEnd + 1;
        } else if (artClose !== -1) {
          // Artifact closed
          this.inArtifact = false;
          pos = artClose + ART_CLOSE.length;
          // Skip trailing lone comma/semicolon on same or next line
          pos = this.skipJunk(buf, pos);
        } else {
          // Still inside artifact, no closing tag yet — discard everything
          pos = buf.length;
        }
        continue;
      }

      // ── Normal text — look for start of an artifact ────────────────────
      const artStart = buf.indexOf(ART_OPEN, pos);

      if (artStart === -1) {
        // No artifact tag at all.
        // But the buffer might END with a partial tag prefix like "<boltArt"
        // — don't emit that yet.
        const safe = this.safePrefixEnd(buf, pos, ART_OPEN);
        out += buf.slice(pos, safe);
        pos = buf.length; // leave potential partial tag in buffer below
        break;
      }

      // Emit text before the artifact
      const textBefore = buf.slice(pos, artStart);
      // Strip trailing lone comma/whitespace that precedes the artifact
      out += this.stripTrailingJunk(textBefore);

      // Parse the opening artifact tag
      const tagEnd = buf.indexOf('>', artStart);
      if (tagEnd === -1) {
        // Incomplete opening tag — keep everything from artStart in buffer
        pos = artStart;
        break;
      }
      this.inArtifact = true;
      pos = tagEnd + 1;
    }

    // Keep unprocessed bytes in buffer
    // (either a partial tag prefix, or we broke early)
    this.buf = buf.slice(pos);

    if (out) this.callbacks.onTextDelta?.(out);
    return out;
  }

  /**
   * Find the largest suffix of buf[from..] that is a prefix of tagStr.
   * Returns the index up to which it is safe to emit.
   * e.g. buf="Hello <boltArt", tagStr="<boltArtifact"
   *   → returns index of '<' (don't emit "<boltArt" yet)
   */
  private safePrefixEnd(buf: string, from: number, tagStr: string): number {
    // Try progressively shorter suffixes
    const end = buf.length;
    for (let len = Math.min(tagStr.length - 1, end - from); len >= 1; len--) {
      const suffix = buf.slice(end - len);
      if (tagStr.startsWith(suffix)) {
        return end - len; // don't emit from here onwards
      }
    }
    return end; // nothing matches — safe to emit everything
  }

  /**
   * Skip whitespace + lone comma/semicolons at pos in buf.
   * Only skips if the skipped chars are just junk (no meaningful text).
   */
  private skipJunk(buf: string, pos: number): number {
    let i = pos;
    while (i < buf.length && /[\s,;]/.test(buf[i])) {
      i++;
    }
    // Only skip if we actually consumed ONLY junk (nothing meaningful lost)
    return i;
  }

  /**
   * Strip trailing whitespace and lone comma/semicolon from text
   * that appears just before an artifact tag.
   */
  private stripTrailingJunk(text: string): string {
    // Remove a trailing comma (possibly with surrounding whitespace) that is
    // on its own or at the very end — the classic "," leak between artifacts.
    return text.replace(/,\s*$/, '').replace(/\s*$/, '');
  }

  private cleanContent(content: string): string {
    let c = content.trim();
    // Strip markdown code fence wrapper
    const fenceMatch = c.match(/^\s*```\w*\n([\s\S]*?)\n\s*```\s*$/);
    if (fenceMatch) c = fenceMatch[1];
    return c.replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  }

  private normalizePath(p: string): string {
    if (p.startsWith('/home/project/')) return p.slice('/home/project/'.length);
    if (p.startsWith('/home/project')) return p.slice('/home/project'.length);
    if (p.startsWith('/')) return p.slice(1);
    return p;
  }

  flush(): string {
    const wasInArtifact = this.inArtifact;
    const rem = this.buf;
    this.reset();
    // Only return buffered text if we were not mid-artifact
    return wasInArtifact ? '' : rem;
  }

  reset(): void {
    this.buf = '';
    this.inArtifact = false;
    this.inAction = false;
    this.filePath = '';
    this.fileContent = '';
  }
}
