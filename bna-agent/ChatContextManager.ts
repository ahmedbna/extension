import { type ToolInvocation, type UIMessage } from 'ai';
import { type AbsolutePath, getAbsolutePath } from './utils/workDir.js';
import { type Dirent, type EditorDocument, type FileMap } from './types.js';
import { PREWARM_PATHS, WORK_DIR } from './constants.js';
import { renderFile } from './utils/renderFile.js';
import { StreamingMessageParser } from './message-parser.js';
import { makePartId, type PartId } from './partId.js';
import { viewParameters } from './tools/view.js';
import { editToolParameters } from './tools/edit.js';
import { loggingSafeParse } from './utils/zodUtil.js';
import { npmInstallToolParameters } from './tools/npmInstall.js';
import { path } from './utils/path.js';
import { EXCLUDED_FILE_PATHS } from './constants.js';

const MAX_RELEVANT_FILES = 16;

type UIMessagePart = UIMessage['parts'][number];

export type PromptCharacterCounts = {
  messageHistoryChars: number;
  currentTurnChars: number;
  totalPromptChars: number;
};

type ParsedAssistantMessage = {
  filesTouched: Map<AbsolutePath, number>;
};

export class ChatContextManager {
  assistantMessageCache: WeakMap<UIMessage, ParsedAssistantMessage> = new WeakMap();
  messageSizeCache: WeakMap<UIMessage, number> = new WeakMap();
  partSizeCache: WeakMap<UIMessagePart, number> = new WeakMap();
  messageIndex: number = -1;
  partIndex: number = -1;

  constructor(
    private getCurrentDocument: () => EditorDocument | undefined,
    private getFiles: () => FileMap,
    private getUserWrites: () => Map<AbsolutePath, number>,
  ) {}

  reset(): void {
    this.assistantMessageCache = new WeakMap();
    this.messageSizeCache = new WeakMap();
    this.partSizeCache = new WeakMap();
    this.messageIndex = -1;
    this.partIndex = -1;
  }

  prepareContext(
    messages: UIMessage[],
    maxCollapsedMessagesSize: number,
    minCollapsedMessagesSize: number,
  ): { messages: UIMessage[]; collapsedMessages: boolean; promptCharacterCounts?: PromptCharacterCounts } {
    let collapsedMessages = false;
    if (messages[messages.length - 1].role === 'user') {
      const [messageIndex, partIndex] = this.messagePartCutoff(messages, maxCollapsedMessagesSize);
      if (messageIndex === this.messageIndex && partIndex === this.partIndex) {
        return { messages, collapsedMessages };
      }
      if (messageIndex >= this.messageIndex && partIndex >= this.partIndex) {
        const [newMessageIndex, newPartIndex] = this.messagePartCutoff(messages, minCollapsedMessagesSize);
        this.messageIndex = newMessageIndex;
        this.partIndex = newPartIndex;
        collapsedMessages = true;
      }
    }
    messages = this.collapseMessages(messages);
    return { messages, collapsedMessages };
  }

  calculatePromptCharacterCounts(messages: UIMessage[], systemPrompts?: string[]): PromptCharacterCounts {
    let messageHistoryChars = 0;
    const lastMessage = messages[messages.length - 1];
    const isLastMessageUser = lastMessage?.role === 'user';

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      if (isLastMessageUser && i === messages.length - 1) continue;
      messageHistoryChars += this.messageSize(message);
    }

    let currentTurnChars = 0;
    if (isLastMessageUser) {
      currentTurnChars = this.messageSize(lastMessage);
    }

    let systemPromptsChars = 0;
    if (systemPrompts) {
      systemPromptsChars = systemPrompts.reduce((sum, p) => sum + p.length, 0);
    }

    return {
      messageHistoryChars,
      currentTurnChars,
      totalPromptChars: messageHistoryChars + currentTurnChars + systemPromptsChars,
    };
  }

  private messageSize(message: UIMessage): number {
    const cached = this.messageSizeCache.get(message);
    if (cached !== undefined) return cached;

    let size = message.content.length;
    for (const part of message.parts) {
      size += this.partSize(part);
    }
    this.messageSizeCache.set(message, size);
    return size;
  }

  relevantFiles(messages: UIMessage[], id: string, maxRelevantFilesSize: number): UIMessage {
    const currentDocument = this.getCurrentDocument();
    const cache = this.getFiles();
    const allPaths = Object.keys(cache).sort();

    const lastUsed: Map<AbsolutePath, number> = new Map();
    for (const p of PREWARM_PATHS) {
      const absPath = p as AbsolutePath;
      if (cache[absPath]) lastUsed.set(absPath, 0);
    }

    let partCounter = 0;
    for (const message of messages) {
      const createdAt = message.createdAt?.getTime();
      const parsed = this.parsedAssistantMessage(message);
      if (!parsed) continue;
      for (const [absPath, partIndex] of parsed.filesTouched.entries()) {
        const entry = cache[absPath];
        if (!entry || entry.type !== 'file') continue;
        const lastUsedTime = (createdAt ?? partCounter) + partIndex;
        lastUsed.set(absPath, lastUsedTime);
      }
      partCounter += message.parts.length;
    }

    for (const [p, lastUsedTime] of this.getUserWrites().entries()) {
      const existing = lastUsed.get(p) ?? 0;
      lastUsed.set(p, Math.max(existing, lastUsedTime));
    }

    if (currentDocument) lastUsed.delete(currentDocument.filePath);

    const sortedByLastUsed = Array.from(lastUsed.entries()).sort((a, b) => b[1] - a[1]);
    let sizeEstimate = 0;
    const fileActions: string[] = [];
    let numFiles = 0;

    for (const [p] of sortedByLastUsed) {
      if (EXCLUDED_FILE_PATHS.some((ex) => p.includes(ex))) continue;
      if (sizeEstimate > maxRelevantFilesSize) break;
      if (numFiles >= MAX_RELEVANT_FILES) break;
      const entry = cache[p];
      if (!entry || entry.type !== 'file') continue;
      const content = renderFile(entry.content);
      fileActions.push(`<boltAction type="file" filePath="${p}">${content}</boltAction>`);
      sizeEstimate += estimateSize(entry);
      numFiles++;
    }

    if (currentDocument) {
      const content = renderFile(currentDocument.value);
      fileActions.push(`<boltAction type="file" filePath="${currentDocument.filePath}">${content}</boltAction>`);
    }

    if (allPaths.length > 0) {
      fileActions.push(`Here are all the paths in the project:\n${allPaths.map((p) => ` - ${p}`).join('\n')}\n\n`);
    }

    if (fileActions.length === 0) {
      return { id, content: '', role: 'user', parts: [] };
    }

    return makeUserMessage(fileActions, id);
  }

  private collapseMessages(messages: UIMessage[]): UIMessage[] {
    const fullMessages = [];
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      if (i < this.messageIndex) {
        // Fully collapsed messages: replace tool results with abbreviated summaries
        // so the model retains what happened without paying full token cost.
        if (message.role === 'assistant') {
          const abbreviatedParts: UIMessagePart[] = message.parts.map((p) => {
            if (p.type !== 'tool-invocation' || p.toolInvocation.state !== 'result') return p;
            try {
              const summary = abbreviateToolInvocation(p.toolInvocation);
              return {
                type: 'text' as const,
                text: summary,
              };
            } catch {
              return p;
            }
          });
          fullMessages.push({
            ...message,
            content: StreamingMessageParser.stripArtifacts(message.content),
            parts: abbreviatedParts,
          });
        } else {
          // Drop user messages that are fully before the cutoff (e.g. old "Relevant Files" blobs)
          continue;
        }
      } else if (i === this.messageIndex) {
        // Boundary message: abbreviate tool results up to partIndex, keep the rest full fidelity
        const processedParts: UIMessagePart[] = message.parts.map((p, j) => {
          if (j > this.partIndex) return p;
          if (p.type !== 'tool-invocation' || p.toolInvocation.state !== 'result') return p;
          try {
            const summary = abbreviateToolInvocation(p.toolInvocation);
            return { type: 'text' as const, text: summary };
          } catch {
            return p;
          }
        });
        fullMessages.push({
          ...message,
          content: StreamingMessageParser.stripArtifacts(message.content),
          parts: processedParts,
        });
      } else {
        // Recent messages: keep full fidelity
        fullMessages.push(message);
      }
    }
    return fullMessages;
  }

  shouldSendRelevantFiles(messages: UIMessage[], maxCollapsedMessagesSize: number): boolean {
    if (messages.length === 0) return true;

    const [messageIndex, partIndex] = this.messagePartCutoff(messages, maxCollapsedMessagesSize);
    if (messageIndex !== this.messageIndex || partIndex !== this.partIndex) return true;

    for (const message of messages) {
      if (message.role === 'user') {
        for (const part of message.parts) {
          if (part.type === 'text' && part.text.includes('title="Relevant Files"')) {
            const hasContent =
              part.text.includes('<boltAction type="file"') && !part.text.match(/<boltAction[^>]*><\/boltAction>/);
            if (hasContent) return false;
          }
        }
      }
    }
    return true;
  }

  private messagePartCutoff(messages: UIMessage[], maxCollapsedMessagesSize: number): [number, number] {
    let remaining = maxCollapsedMessagesSize;
    for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
      const message = messages[messageIndex];
      for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex--) {
        const part = message.parts[partIndex];
        if (part.type === 'tool-invocation' && part.toolInvocation.state !== 'result') continue;
        const size = this.partSize(part);
        if (size > remaining) return [messageIndex, partIndex];
        remaining -= size;
      }
    }
    return [-1, -1];
  }

  private parsedAssistantMessage(message: UIMessage): ParsedAssistantMessage | null {
    if (message.role !== 'assistant') return null;
    const cached = this.assistantMessageCache.get(message);
    if (cached) return cached;

    const filesTouched = new Map<AbsolutePath, number>();
    for (const file of extractFileArtifacts(makePartId(message.id, 0), message.content)) {
      filesTouched.set(getAbsolutePath(file), 0);
    }
    for (let j = 0; j < message.parts.length; j++) {
      const part = message.parts[j];
      if (part.type === 'text') {
        for (const file of extractFileArtifacts(makePartId(message.id, j), part.text)) {
          filesTouched.set(getAbsolutePath(file), j);
        }
      }
      if (part.type === 'tool-invocation' && part.toolInvocation.state !== 'partial-call') {
        if (part.toolInvocation.toolName === 'view') {
          const args = loggingSafeParse(viewParameters, part.toolInvocation.args);
          if (args.success) filesTouched.set(getAbsolutePath(args.data.path), j);
        }
        if (part.toolInvocation.toolName === 'edit') {
          const args = loggingSafeParse(editToolParameters, part.toolInvocation.args);
          if (args.success) filesTouched.set(getAbsolutePath(args.data.path), j);
        }
      }
    }

    const result = { filesTouched };
    this.assistantMessageCache.set(message, result);
    return result;
  }

  private partSize(part: UIMessagePart): number {
    const cached = this.partSizeCache.get(part);
    if (cached) return cached;

    let result = 0;
    switch (part.type) {
      case 'text':
        result = part.text.length;
        break;
      case 'file':
        result = part.data.length + part.mimeType.length;
        break;
      case 'reasoning':
        result = part.reasoning.length;
        break;
      case 'tool-invocation':
        result = JSON.stringify(part.toolInvocation.args).length;
        if (part.toolInvocation.state === 'result') {
          result += JSON.stringify(part.toolInvocation.result).length;
        }
        break;
      case 'source':
        result = (part.source.title ?? '').length + part.source.url.length;
        break;
      case 'step-start':
        break;
      default:
        throw new Error(`Unknown part type: ${JSON.stringify(part)}`);
    }

    this.partSizeCache.set(part, result);
    return result;
  }
}

function makeUserMessage(content: string[], id: string): UIMessage {
  const parts: UIMessagePart[] = content.map((c) => ({
    type: 'text',
    text: `<boltArtifact id="${id}" title="Relevant Files">\n${c}\n</boltArtifact>`,
  }));
  return { id, content: '', role: 'user', parts };
}

function estimateSize(entry: Dirent): number {
  return entry.type === 'file' ? 4 + entry.content.length : 6;
}

function abbreviateToolInvocation(toolInvocation: ToolInvocation): string {
  if (toolInvocation.state !== 'result') {
    throw new Error(`Invalid tool invocation state: ${toolInvocation.state}`);
  }
  const wasError = toolInvocation.result.startsWith('Error:');
  let toolCall: string;

  switch (toolInvocation.toolName) {
    case 'view': {
      const args = loggingSafeParse(viewParameters, toolInvocation.args);
      const verb = toolInvocation.result.startsWith('Directory:') ? 'listed' : 'viewed';
      toolCall = `${verb} ${args?.data?.path || 'unknown file'}`;
      break;
    }
    case 'deploy':
      toolCall = 'deployed the app';
      break;
    case 'npmInstall': {
      const args = loggingSafeParse(npmInstallToolParameters, toolInvocation.args);
      toolCall = args.success
        ? `installed ${args.data.packages}${args.data.requiresNativeRebuild ? ' (native rebuild required)' : ''}`
        : 'attempted to install dependencies';
      break;
    }
    case 'edit': {
      const args = loggingSafeParse(editToolParameters, toolInvocation.args);
      toolCall = args.success ? `edited ${args.data.path}` : 'attempted to edit a file';
      break;
    }
    case 'getConvexDeploymentName':
      toolCall = 'retrieved the Convex deployment name';
      break;
    default:
      throw new Error(`Unknown tool name: ${toolInvocation.toolName}`);
  }

  return `The assistant ${toolCall} ${wasError ? 'and got an error' : 'successfully'}.`;
}

function extractFileArtifacts(partId: PartId, content: string): string[] {
  const filesTouched: Set<string> = new Set();
  const parser = new StreamingMessageParser({
    callbacks: {
      onActionClose: (data) => {
        if (data.action.type === 'file') {
          filesTouched.add(path.join(WORK_DIR, data.action.filePath));
        }
      },
    },
  });
  parser.parse(partId, content);
  return Array.from(filesTouched);
}
