import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { TokenStore } from '../auth/TokenStore';
import { ToolExecutor, type ToolCall, type ToolResult } from '../tools/ToolExecutor';
import { CreditsManager } from '../credits/CreditsManager';
import { ConvexProjectManager } from '../convex/ConvexProjectManager';
import { executeFileTool } from '../tools/FileTools';
import { StreamingArtifactParser } from './StreamingArtifactParser';
import { MessageHistory } from './MessageHistory';
import { BNA_API_BASE_URL, EXCLUDED_FILE_PATHS } from '../constants';
import { logger } from '../utils/logger';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  parts?: Array<{
    type: string;
    text?: string;
    toolInvocation?: any;
  }>;
  annotations?: any[];
}

export interface StreamEvent {
  type: 'text' | 'tool-call' | 'tool-result' | 'finish' | 'error' | 'file-write';
  content?: string;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
  filePath?: string;
  error?: string;
}

/**
 * The main BNA AI agent.
 *
 * Unlike the web app which calls /api/chat (a Remix server action),
 * the VS Code extension calls the Anthropic API directly using the
 * same prompts and tool definitions.
 *
 * Alternatively, it can proxy through the BNA API for credit tracking.
 */
export class BNAAgent {
  private messages: ChatMessage[] = [];
  private chatId: string;
  private _onStreamEvent = new vscode.EventEmitter<StreamEvent>();
  readonly onStreamEvent = this._onStreamEvent.event;

  private abortController: AbortController | null = null;
  private artifactParser: StreamingArtifactParser;
  private messageHistory: MessageHistory;

  constructor(
    private readonly tokenStore: TokenStore,
    private readonly toolExecutor: ToolExecutor,
    private readonly creditsManager: CreditsManager,
    private readonly projectManager: ConvexProjectManager
  ) {
    this.chatId = crypto.randomUUID();
    this.messageHistory = new MessageHistory();

    this.artifactParser = new StreamingArtifactParser({
      onFileComplete: (file) => {
        if (EXCLUDED_FILE_PATHS.some(ex => file.filePath.includes(ex))) {
          logger.warn(`Skipping excluded file: ${file.filePath}`);
          return;
        }
        executeFileTool(file.filePath, file.content).catch(err => {
          logger.error(`Failed to write file ${file.filePath}:`, err);
        });
        this._onStreamEvent.fire({ type: 'file-write', filePath: file.filePath });
      },
    });
  }

  getChatId(): string {
    return this.chatId;
  }

  getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  /**
   * Send a user message and stream the AI response.
   * Uses the BNA API endpoint which handles:
   * - System prompts (same as web app)
   * - Tool definitions
   * - Credit deduction
   * - Message history management
   */
  async sendMessage(userMessage: string): Promise<void> {
    // Add user message
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: userMessage,
      parts: [{ type: 'text', text: userMessage }],
    };
    this.messages.push(userMsg);

    this.abortController = new AbortController();

    try {
      await this.callBNAApi(this.abortController.signal);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        this._onStreamEvent.fire({ type: 'finish', content: 'Stopped by user' });
        return;
      }
      logger.error('Agent error:', err);
      this._onStreamEvent.fire({ type: 'error', error: err.message || String(err) });
    }
  }

  /**
   * Call the BNA API (same endpoint as the web app's /api/chat).
   * This ensures the same system prompts, tool definitions, and credit tracking.
   */
  private async callBNAApi(signal: AbortSignal): Promise<void> {
    const token = await this.tokenStore.getConvexAuthToken();
    const accessToken = await this.tokenStore.getConvexAccessToken();
    const teamSlug = await this.tokenStore.getTeamSlug();
    const userId = await this.tokenStore.getUserId();
    const projectInfo = this.projectManager.getProjectInfo();

    if (!accessToken || !teamSlug) {
      throw new Error('Not connected to Convex. Please sign in and connect your Convex account.');
    }

    // Prepare request body (same shape as the web app's experimental_prepareRequestBody)
    const body = {
      messages: this.messages.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        parts: m.parts,
        annotations: m.annotations,
      })),
      firstUserMessage: this.messages.filter(m => m.role === 'user').length === 1,
      chatInitialId: this.chatId,
      token: accessToken,
      teamSlug,
      deploymentName: projectInfo?.deploymentName,
      shouldDisableTools: false,
      recordRawPromptsForDebugging: false,
      collapsedMessages: false,
      userId: userId || undefined,
      featureFlags: {
        enableResend: false,
      },
    };

    const response = await fetch(`${BNA_API_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`API error (${response.status}): ${text}`);
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    // Process the SSE stream
    await this.processStream(response.body, signal);
  }

  /**
   * Process the Server-Sent Events stream from the BNA API.
   * The stream format matches the Vercel AI SDK's data stream protocol.
   */
  private async processStream(body: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();

    let currentAssistantMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      parts: [],
      annotations: [],
    };
    this.messages.push(currentAssistantMsg);

    let buffer = '';

    try {
      while (true) {
        if (signal.aborted) break;

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete lines from the SSE stream
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            await this.processStreamLine(line, currentAssistantMsg, signal);
          } catch (err) {
            logger.debug('Failed to process stream line:', line, err);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Finalize
    this._onStreamEvent.fire({ type: 'finish' });
  }

  /**
   * Process a single line from the data stream.
   * The Vercel AI SDK data stream protocol uses single-character prefixes:
   * 0: text delta
   * 2: data (annotations, etc.)
   * 9: tool call
   * a: tool result
   * e: finish
   * d: error
   */
  private async processStreamLine(
    line: string,
    assistantMsg: ChatMessage,
    signal: AbortSignal
  ): Promise<void> {
    if (line.length < 2) return;

    const type = line[0];
    const data = line.slice(2); // Skip type char and colon

    switch (type) {
      case '0': {
        // Text delta
        try {
          const text = JSON.parse(data) as string;
          assistantMsg.content += text;

          // Parse through the artifact parser — it strips boltArtifact/boltAction tags
          // and emits file-write events when complete files are found
          const cleanText = this.artifactParser.feed(text);

          // Only emit the cleaned text (artifact tags stripped) to the UI
          if (cleanText) {
            this._onStreamEvent.fire({ type: 'text', content: cleanText });
          }
        } catch {
          // Raw text
          assistantMsg.content += data;
          this._onStreamEvent.fire({ type: 'text', content: data });
        }
        break;
      }

      case '9': {
        // Tool call
        try {
          const toolCall = JSON.parse(data) as {
            toolCallId: string;
            toolName: string;
            args: any;
          };

          this._onStreamEvent.fire({
            type: 'tool-call',
            toolCall: {
              toolCallId: toolCall.toolCallId,
              toolName: toolCall.toolName,
              args: toolCall.args,
            },
          });

          // Execute the tool
          if (!signal.aborted) {
            const result = await this.toolExecutor.execute({
              toolCallId: toolCall.toolCallId,
              toolName: toolCall.toolName,
              args: toolCall.args,
            });

            this._onStreamEvent.fire({
              type: 'tool-result',
              toolResult: result,
            });
          }
        } catch (err) {
          logger.error('Error processing tool call:', err);
        }
        break;
      }

      case '2': {
        // Data/annotations (usage, model info, etc.)
        try {
          const annotations = JSON.parse(data) as any[];
          if (assistantMsg.annotations) {
            assistantMsg.annotations.push(...annotations);
          }
        } catch {
          // Ignore parse errors for annotations
        }
        break;
      }

      case 'e': {
        // Finish reason
        this._onStreamEvent.fire({ type: 'finish' });
        break;
      }

      case 'd': {
        // Error
        try {
          const errorData = JSON.parse(data);
          this._onStreamEvent.fire({
            type: 'error',
            error: typeof errorData === 'string' ? errorData : JSON.stringify(errorData),
          });
        } catch {
          this._onStreamEvent.fire({ type: 'error', error: data });
        }
        break;
      }
    }
  }

  /**
   * Abort the current generation.
   */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.artifactParser.flush();
  }

  /**
   * Reset the chat (new conversation).
   */
  reset(): void {
    this.messages = [];
    this.chatId = crypto.randomUUID();
    this.toolExecutor.reset();
    this.artifactParser.reset();
  }

  /**
   * Save current messages locally.
   */
  async saveHistory(): Promise<void> {
    await this.messageHistory.saveLocal(this.chatId, this.messages);
  }

  /**
   * Load messages from local history.
   */
  async loadHistory(): Promise<boolean> {
    const stored = await this.messageHistory.loadLocal();
    if (stored) {
      this.messages = stored.messages;
      this.chatId = stored.chatId;
      return true;
    }
    return false;
  }

  dispose(): void {
    this.abort();
    this._onStreamEvent.dispose();
  }
}
