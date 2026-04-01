import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { TokenStore } from '../auth/TokenStore';
import { AuthManager } from '../auth/AuthManager';
import {
  ToolExecutor,
  type ToolCall,
  type ToolResult,
} from '../tools/ToolExecutor';
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
  type:
    | 'text'
    | 'tool-call'
    | 'tool-result'
    | 'finish'
    | 'error'
    | 'file-write'
    | 'auth-required';
  content?: string;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
  filePath?: string;
  error?: string;
}

/**
 * The main BNA AI agent.
 *
 * Calls the BNA API (/api/chat) which handles system prompts, tool definitions,
 * and credit tracking. The extension executes tool calls locally on the real FS.
 *
 * Auth-aware: validates token before each request and fires auth-required events
 * when the token is invalid or expired.
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
    private readonly authManager: AuthManager,
    private readonly toolExecutor: ToolExecutor,
    private readonly creditsManager: CreditsManager,
    private readonly projectManager: ConvexProjectManager,
  ) {
    this.chatId = crypto.randomUUID();
    this.messageHistory = new MessageHistory();

    this.artifactParser = new StreamingArtifactParser({
      onFileComplete: (file) => {
        if (EXCLUDED_FILE_PATHS.some((ex) => file.filePath.includes(ex))) {
          logger.warn(`Skipping excluded file: ${file.filePath}`);
          return;
        }
        executeFileTool(file.filePath, file.content).catch((err) => {
          logger.error(`Failed to write file ${file.filePath}:`, err);
        });
        this._onStreamEvent.fire({
          type: 'file-write',
          filePath: file.filePath,
        });
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
   * Validates auth before making the request.
   */
  async sendMessage(userMessage: string): Promise<void> {
    // ── Auth gate ──────────────────────────────────────────────
    const isAuth = await this.authManager.isAuthenticated();
    if (!isAuth) {
      this._onStreamEvent.fire({
        type: 'auth-required',
        error: 'Please sign in to continue.',
      });
      return;
    }

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
        this._onStreamEvent.fire({
          type: 'finish',
          content: 'Stopped by user',
        });
        return;
      }

      // Check if the error is auth-related
      if (this.isAuthError(err)) {
        logger.warn('Auth error during API call — token may be expired');
        this._onStreamEvent.fire({
          type: 'auth-required',
          error: 'Your session has expired. Please sign in again.',
        });
        return;
      }

      logger.error('Agent error:', err);
      this._onStreamEvent.fire({
        type: 'error',
        error: err.message || String(err),
      });
    }
  }

  /**
   * Call the BNA API (same endpoint as the web app's /api/chat).
   */
  private async callBNAApi(signal: AbortSignal): Promise<void> {
    const token = await this.tokenStore.getConvexAuthToken();
    const accessToken = await this.tokenStore.getConvexAccessToken();
    const teamSlug = await this.tokenStore.getTeamSlug();
    const userId = await this.tokenStore.getUserId();
    const projectInfo = this.projectManager.getProjectInfo();

    if (!token) {
      throw new AuthError('No valid auth token. Please sign in.');
    }

    if (!accessToken || !teamSlug) {
      throw new Error(
        'Not connected to Convex. Please connect your Convex account.',
      );
    }

    const body = {
      messages: this.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        parts: m.parts,
        annotations: m.annotations,
      })),
      firstUserMessage:
        this.messages.filter((m) => m.role === 'user').length === 1,
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
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (response.status === 401 || response.status === 403) {
      throw new AuthError('Authentication failed. Please sign in again.');
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`API error (${response.status}): ${text}`);
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    await this.processStream(response.body, signal);
  }

  /**
   * Process the Server-Sent Events stream from the BNA API.
   */
  private async processStream(
    body: ReadableStream<Uint8Array>,
    signal: AbortSignal,
  ): Promise<void> {
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
        if (signal.aborted) {
          break;
        }

        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) {
            continue;
          }

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

    this._onStreamEvent.fire({ type: 'finish' });
  }

  /**
   * Process a single line from the data stream.
   * Vercel AI SDK data stream protocol:
   * 0: text delta
   * 2: data (annotations)
   * 9: tool call
   * a: tool result
   * e: finish
   * d: error
   */
  private async processStreamLine(
    line: string,
    assistantMsg: ChatMessage,
    signal: AbortSignal,
  ): Promise<void> {
    if (line.length < 2) {
      return;
    }

    const type = line[0];
    const data = line.slice(2);

    switch (type) {
      case '0': {
        try {
          const text = JSON.parse(data) as string;
          assistantMsg.content += text;

          const cleanText = this.artifactParser.feed(text);
          if (cleanText) {
            this._onStreamEvent.fire({ type: 'text', content: cleanText });
          }
        } catch {
          assistantMsg.content += data;
          this._onStreamEvent.fire({ type: 'text', content: data });
        }
        break;
      }

      case '9': {
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
        this._onStreamEvent.fire({ type: 'finish' });
        break;
      }

      case 'd': {
        try {
          const errorData = JSON.parse(data);
          const errorMsg =
            typeof errorData === 'string'
              ? errorData
              : JSON.stringify(errorData);

          // Check if server reported auth error in the stream
          if (
            errorMsg.includes('auth') ||
            errorMsg.includes('unauthorized') ||
            errorMsg.includes('token')
          ) {
            this._onStreamEvent.fire({
              type: 'auth-required',
              error: 'Session expired. Please sign in again.',
            });
          } else {
            this._onStreamEvent.fire({ type: 'error', error: errorMsg });
          }
        } catch {
          this._onStreamEvent.fire({ type: 'error', error: data });
        }
        break;
      }
    }
  }

  /**
   * Check if an error is authentication-related.
   */
  private isAuthError(err: any): boolean {
    if (err instanceof AuthError) {
      return true;
    }
    const msg = (err.message || String(err)).toLowerCase();
    return (
      msg.includes('401') ||
      msg.includes('403') ||
      msg.includes('unauthorized') ||
      msg.includes('authentication') ||
      msg.includes('token expired') ||
      msg.includes('sign in')
    );
  }

  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.artifactParser.flush();
  }

  reset(): void {
    this.messages = [];
    this.chatId = crypto.randomUUID();
    this.toolExecutor.reset();
    this.artifactParser.reset();
  }

  async saveHistory(): Promise<void> {
    await this.messageHistory.saveLocal(this.chatId, this.messages);
  }

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

/**
 * Custom error class for auth-related failures.
 */
class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}
