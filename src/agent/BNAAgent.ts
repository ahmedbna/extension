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
import { StreamingArtifactParser } from './StreamingArtifactParser';
import { MessageHistory } from './MessageHistory';
import { BNA_API_BASE_URL, EXCLUDED_FILE_PATHS } from '../constants';
import { logger } from '../utils/logger';
import { executeFileTool } from '../tools/FileTools';
import { SystemPromptBuilder } from './SystemPromptBuilder';

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
 * BNA AI Agent — Direct Anthropic Mode
 *
 * Instead of calling the BNA API (/api/extension-chat), this agent calls the Anthropic
 * API directly. This allows the agentic loop (tool call → execute → feed result
 * back) to happen entirely within the extension, using the real file system.
 *
 * Credit deduction is done via a separate call to the BNA server after each
 * generation completes.
 *
 * Two modes are supported:
 *   1. Direct mode (user provides their own ANTHROPIC_API_KEY in settings)
 *   2. Proxy mode (calls /api/extension-chat on BNA server, which proxies to
 *      Anthropic and handles credits)
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
      await this.callBNAProxy(this.abortController.signal);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        this._onStreamEvent.fire({
          type: 'finish',
          content: 'Stopped by user',
        });
        return;
      }

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
   * Process an Anthropic SSE stream.
   * Returns the stop reason and any tool_use blocks.
   */
  private async processAnthropicStream(
    body: ReadableStream<Uint8Array>,
    signal: AbortSignal,
  ): Promise<{
    stopReason: string;
    toolUses: Array<{ id: string; name: string; input: any }>;
    contentBlocks: any[];
  }> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let stopReason = 'end_turn';
    const toolUses: Array<{ id: string; name: string; input: any }> = [];
    const contentBlocks: any[] = [];

    // Track current content block for streaming
    let currentBlockType: string | null = null;
    let currentBlockIndex = -1;
    let currentToolUse: { id: string; name: string; inputJson: string } | null =
      null;

    let currentAssistantMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      parts: [],
      annotations: [],
    };
    this.messages.push(currentAssistantMsg);

    try {
      while (true) {
        if (signal.aborted) break;

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;

          try {
            const event = JSON.parse(data);

            switch (event.type) {
              case 'content_block_start': {
                currentBlockIndex = event.index;
                const block = event.content_block;
                currentBlockType = block.type;

                if (block.type === 'tool_use') {
                  currentToolUse = {
                    id: block.id,
                    name: block.name,
                    inputJson: '',
                  };
                  this._onStreamEvent.fire({
                    type: 'tool-call',
                    toolCall: {
                      toolCallId: block.id,
                      toolName: block.name,
                      args: {},
                    },
                  });
                }
                break;
              }

              case 'content_block_delta': {
                const delta = event.delta;
                if (delta.type === 'text_delta') {
                  currentAssistantMsg.content += delta.text;
                  const cleanText = this.artifactParser.feed(delta.text);
                  if (cleanText) {
                    this._onStreamEvent.fire({
                      type: 'text',
                      content: cleanText,
                    });
                  }
                } else if (delta.type === 'input_json_delta') {
                  if (currentToolUse) {
                    currentToolUse.inputJson += delta.partial_json;
                  }
                }
                break;
              }

              case 'content_block_stop': {
                if (currentBlockType === 'text') {
                  contentBlocks.push({
                    type: 'text',
                    text: currentAssistantMsg.content,
                  });
                } else if (currentBlockType === 'tool_use' && currentToolUse) {
                  let input = {};
                  try {
                    if (currentToolUse.inputJson) {
                      input = JSON.parse(currentToolUse.inputJson);
                    }
                  } catch {
                    logger.warn('Failed to parse tool input JSON');
                  }

                  const toolUseBlock = {
                    type: 'tool_use' as const,
                    id: currentToolUse.id,
                    name: currentToolUse.name,
                    input,
                  };
                  contentBlocks.push(toolUseBlock);
                  toolUses.push({
                    id: currentToolUse.id,
                    name: currentToolUse.name,
                    input,
                  });
                  currentToolUse = null;
                }
                currentBlockType = null;
                break;
              }

              case 'message_delta': {
                if (event.delta?.stop_reason) {
                  stopReason = event.delta.stop_reason;
                }
                break;
              }

              case 'message_stop': {
                break;
              }

              case 'error': {
                throw new Error(
                  event.error?.message || 'Anthropic stream error',
                );
              }
            }
          } catch (parseErr: any) {
            if (parseErr.message?.includes('Anthropic')) throw parseErr;
            logger.debug('Failed to parse SSE event:', data);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return { stopReason, toolUses, contentBlocks };
  }

  /**
   * Build Anthropic-format messages from the internal chat history.
   */
  private buildAnthropicMessages(): any[] {
    const msgs: any[] = [];

    for (const msg of this.messages) {
      if (msg.role === 'system') continue; // System prompt is separate
      if (msg.role === 'user') {
        msgs.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        msgs.push({ role: 'assistant', content: msg.content });
      }
    }

    return msgs;
  }

  /**
   * Proxy mode — call the BNA server's extension-specific endpoint.
   * The server proxies to Anthropic and handles credit deduction.
   * Tool calls come back via SSE and are executed locally.
   */
  private async callBNAProxy(signal: AbortSignal): Promise<void> {
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

    const response = await fetch(`${BNA_API_BASE_URL}/api/extension-chat`, {
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

    await this.processVercelAIStream(response.body, signal);
  }

  /**
   * Process the Vercel AI SDK data stream protocol from the BNA API.
   * 0: text delta, 9: tool call, a: tool result, e: finish, d: error
   */
  private async processVercelAIStream(
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
        if (signal.aborted) break;

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

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

    this._onStreamEvent.fire({ type: 'finish' });
  }

  /**
   * Process a single line from the Vercel AI data stream.
   */
  private async processStreamLine(
    line: string,
    assistantMsg: ChatMessage,
    signal: AbortSignal,
  ): Promise<void> {
    if (line.length < 2) return;

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
          // Ignore annotation parse errors
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
   * Report token usage to BNA server for credit tracking.
   * Fire-and-forget — doesn't block the user.
   */
  private async reportUsageToServer(): Promise<void> {
    try {
      const token = await this.tokenStore.getConvexAuthToken();
      const userId = await this.tokenStore.getUserId();
      if (!token || !userId) return;

      // Estimate token usage (rough approximation)
      const totalChars = this.messages.reduce(
        (sum, m) => sum + m.content.length,
        0,
      );
      const estimatedTokens = Math.ceil(totalChars / 4);

      await fetch(`${BNA_API_BASE_URL}/api/deduct-credits`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          userId,
          tokensUsed: estimatedTokens,
          chatInitialId: this.chatId,
        }),
      });
    } catch (err) {
      logger.debug('Usage report failed (non-fatal):', err);
    }
  }

  private isAuthError(err: any): boolean {
    if (err instanceof AuthError) return true;
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

class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}
