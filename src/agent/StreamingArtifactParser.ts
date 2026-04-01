/**
 * Streaming parser for boltArtifact / boltAction tags in assistant messages.
 *
 * Ported from bna-agent/message-parser.ts for use in the VS Code extension.
 * Strips the artifact markup and emits file-write events as files are completed.
 */

export interface ParsedFileAction {
  filePath: string;
  content: string;
}

export interface ParserCallbacks {
  onFileComplete?: (file: ParsedFileAction) => void;
  onTextDelta?: (text: string) => void;
}

const ARTIFACT_TAG_OPEN = '<boltArtifact';
const ARTIFACT_TAG_CLOSE = '</boltArtifact>';
const ACTION_TAG_OPEN = '<boltAction';
const ACTION_TAG_CLOSE = '</boltAction>';

/**
 * Incrementally parses streamed text for boltArtifact and boltAction tags.
 * Emits file actions as they complete.
 */
export class StreamingArtifactParser {
  private buffer = '';
  private insideArtifact = false;
  private insideAction = false;
  private currentFilePath = '';
  private currentFileContent = '';
  private callbacks: ParserCallbacks;

  constructor(callbacks: ParserCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * Feed new text into the parser.
   * Returns the cleaned text (with artifact tags stripped).
   */
  feed(chunk: string): string {
    this.buffer += chunk;
    let output = '';
    let i = 0;

    while (i < this.buffer.length) {
      if (this.insideArtifact) {
        if (this.insideAction) {
          // Look for closing action tag
          const closeIdx = this.buffer.indexOf(ACTION_TAG_CLOSE, i);

          if (closeIdx !== -1) {
            // Action content complete
            this.currentFileContent += this.buffer.slice(i, closeIdx);

            // Clean the content
            let content = this.currentFileContent.trim();
            content = this.cleanMarkdownFence(content);
            content = content.replace(/&lt;/g, '<').replace(/&gt;/g, '>');

            if (this.currentFilePath && content) {
              this.callbacks.onFileComplete?.({
                filePath: this.normalizeFilePath(this.currentFilePath),
                content: content + '\n',
              });
            }

            this.insideAction = false;
            this.currentFilePath = '';
            this.currentFileContent = '';
            i = closeIdx + ACTION_TAG_CLOSE.length;
          } else {
            // Still accumulating action content
            this.currentFileContent += this.buffer.slice(i);
            i = this.buffer.length;
          }
        } else {
          // Inside artifact but not inside an action
          const actionIdx = this.buffer.indexOf(ACTION_TAG_OPEN, i);
          const artifactCloseIdx = this.buffer.indexOf(ARTIFACT_TAG_CLOSE, i);

          if (actionIdx !== -1 && (artifactCloseIdx === -1 || actionIdx < artifactCloseIdx)) {
            // Found an action tag
            const tagEnd = this.buffer.indexOf('>', actionIdx);
            if (tagEnd !== -1) {
              const tag = this.buffer.slice(actionIdx, tagEnd + 1);
              const typeMatch = tag.match(/type="([^"]+)"/);
              const pathMatch = tag.match(/filePath="([^"]+)"/);

              if (typeMatch?.[1] === 'file' && pathMatch?.[1]) {
                this.insideAction = true;
                this.currentFilePath = pathMatch[1];
                this.currentFileContent = '';
              }

              i = tagEnd + 1;
            } else {
              // Incomplete tag — wait for more data
              break;
            }
          } else if (artifactCloseIdx !== -1) {
            // Artifact closed
            this.insideArtifact = false;
            i = artifactCloseIdx + ARTIFACT_TAG_CLOSE.length;
          } else {
            // No more tags found — wait for more data
            break;
          }
        }
      } else {
        // Not inside an artifact — look for artifact open
        const artIdx = this.buffer.indexOf(ARTIFACT_TAG_OPEN, i);

        if (artIdx !== -1) {
          // Emit text before the artifact
          const textBefore = this.buffer.slice(i, artIdx);
          if (textBefore) {
            output += textBefore;
          }

          const tagEnd = this.buffer.indexOf('>', artIdx);
          if (tagEnd !== -1) {
            this.insideArtifact = true;
            i = tagEnd + 1;
          } else {
            // Incomplete tag — wait for more data
            break;
          }
        } else {
          // Check if we might be at the start of an artifact tag
          const remaining = this.buffer.slice(i);
          if (ARTIFACT_TAG_OPEN.startsWith(remaining) && remaining.length < ARTIFACT_TAG_OPEN.length) {
            // Might be a partial tag — keep in buffer
            break;
          }

          output += remaining;
          i = this.buffer.length;
        }
      }
    }

    // Keep unprocessed data in the buffer
    this.buffer = this.buffer.slice(i);

    if (output) {
      this.callbacks.onTextDelta?.(output);
    }

    return output;
  }

  /**
   * Flush any remaining buffer (call when stream ends).
   */
  flush(): string {
    const remaining = this.buffer;
    this.buffer = '';
    this.insideArtifact = false;
    this.insideAction = false;
    return remaining;
  }

  /**
   * Reset parser state.
   */
  reset(): void {
    this.buffer = '';
    this.insideArtifact = false;
    this.insideAction = false;
    this.currentFilePath = '';
    this.currentFileContent = '';
  }

  private normalizeFilePath(filePath: string): string {
    // Remove /home/project/ prefix if present
    if (filePath.startsWith('/home/project/')) {
      return filePath.slice('/home/project/'.length);
    }
    if (filePath.startsWith('/home/project')) {
      return filePath.slice('/home/project'.length);
    }
    // Remove leading slash
    if (filePath.startsWith('/')) {
      return filePath.slice(1);
    }
    return filePath;
  }

  private cleanMarkdownFence(content: string): string {
    const match = content.match(/^\s*```\w*\n([\s\S]*?)\n\s*```\s*$/);
    return match ? match[1] : content;
  }
}
