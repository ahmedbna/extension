// src/agent/BNAAgent.ts
//
// Direct Anthropic Agent — calls the Anthropic Messages API directly,
// executes tools on the real file system, and deducts credits via Convex.
//
// Flow:
//   1. Fetch Anthropic API key from Convex (extensionKeys table)
//   2. Build system prompt from bna-agent prompts
//   3. Call Anthropic Messages API with streaming
//   4. When tool_use blocks arrive → execute locally → feed tool_result back
//   5. Loop until stop_reason === 'end_turn'
//   6. Deduct credits based on token usage

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { TokenStore } from '../auth/TokenStore';
import { AuthManager } from '../auth/AuthManager';
import { ToolExecutor, type ToolCall, type ToolResult } from './ToolExecutor';
import { CreditsManager } from '../credits/CreditsManager';
import { ConvexProjectManager } from '../convex/ConvexProjectManager';
import { StreamingArtifactParser } from './StreamingArtifactParser';
import { MessageHistory } from './MessageHistory';
import { SystemPromptBuilder } from './SystemPromptBuilder';
import { EXCLUDED_FILE_PATHS } from '../constants';
import { logger } from '../utils/logger';
import { executeFileTool } from '../tools/FileTools';
import { ANTHROPIC_API_KEY } from '../keys/keys';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  parts?: Array<{ type: string; text?: string; toolInvocation?: any }>;
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
    | 'auth-required'
    | 'status';
  content?: string;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
  filePath?: string;
  error?: string;
}

/** Anthropic content block types */
type TextBlock = { type: 'text'; text: string };
type ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: any };
type ToolResultBlock = {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};
type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

/** Anthropic message format */
interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

// Maximum agentic loop iterations to prevent runaway
const MAX_TOOL_ROUNDS = 25;

// Anthropic model to use
const ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 128000;

// ─── Agent ───────────────────────────────────────────────────────────────────

export class BNAAgent {
  private messages: ChatMessage[] = [];
  private chatId: string;
  private _onStreamEvent = new vscode.EventEmitter<StreamEvent>();
  readonly onStreamEvent = this._onStreamEvent.event;

  private abortController: AbortController | null = null;
  private artifactParser: StreamingArtifactParser;
  private messageHistory: MessageHistory;

  // Accumulated token usage across the entire conversation turn
  private turnUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreation: 0,
    cacheRead: 0,
  };

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

  // ─── Main entry point ────────────────────────────────────────────────────

  async sendMessage(userMessage: string): Promise<void> {
    // Auth gate
    const isAuth = await this.authManager.isAuthenticated();
    if (!isAuth) {
      this._onStreamEvent.fire({
        type: 'auth-required',
        error: 'Please sign in to continue.',
      });
      return;
    }

    // Add user message
    this.messages.push({
      id: crypto.randomUUID(),
      role: 'user',
      content: userMessage,
      parts: [{ type: 'text', text: userMessage }],
    });

    this.abortController = new AbortController();
    this.turnUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreation: 0,
      cacheRead: 0,
    };

    try {
      this._onStreamEvent.fire({ type: 'status', content: 'Thinking...' });

      // Run the agentic loop
      await this.agenticLoop(ANTHROPIC_API_KEY, this.abortController.signal);

      // Deduct credits
      await this.deductCredits();

      this._onStreamEvent.fire({ type: 'finish' });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        this._onStreamEvent.fire({
          type: 'finish',
          content: 'Stopped by user',
        });
        return;
      }
      if (this.isAuthError(err)) {
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

  // ─── Agentic loop ────────────────────────────────────────────────────────

  /**
   * The core loop: call Anthropic → if tool_use → execute → feed result → repeat.
   * Continues until stop_reason is 'end_turn' or we hit MAX_TOOL_ROUNDS.
   */
  private async agenticLoop(
    apiKey: string,
    signal: AbortSignal,
  ): Promise<void> {
    // Build the conversation in Anthropic format
    const anthropicMessages: AnthropicMessage[] = this.buildAnthropicMessages();
    const systemPrompt = SystemPromptBuilder.build();
    const tools = SystemPromptBuilder.getToolDefinitions();

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (signal.aborted) break;

      // Call Anthropic Messages API with streaming
      const result = await this.callAnthropic({
        apiKey,
        system: systemPrompt,
        messages: anthropicMessages,
        tools,
        signal,
      });

      // Accumulate usage
      if (result.usage) {
        this.turnUsage.inputTokens += result.usage.input_tokens || 0;
        this.turnUsage.outputTokens += result.usage.output_tokens || 0;
        this.turnUsage.cacheCreation +=
          result.usage.cache_creation_input_tokens || 0;
        this.turnUsage.cacheRead += result.usage.cache_read_input_tokens || 0;
      }

      // Add assistant message to conversation
      anthropicMessages.push({
        role: 'assistant',
        content: result.contentBlocks,
      });

      // Also track in our internal messages for the webview
      const textContent = result.contentBlocks
        .filter((b): b is TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');

      if (textContent) {
        this.messages.push({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: textContent,
        });
      }

      // If no tool use, we're done
      if (result.stopReason !== 'tool_use') {
        break;
      }

      // Execute all tool_use blocks
      const toolUseBlocks = result.contentBlocks.filter(
        (b): b is ToolUseBlock => b.type === 'tool_use',
      );

      if (toolUseBlocks.length === 0) break;

      const toolResultBlocks: ToolResultBlock[] = [];

      for (const toolUse of toolUseBlocks) {
        if (signal.aborted) break;

        this._onStreamEvent.fire({
          type: 'tool-call',
          toolCall: {
            toolCallId: toolUse.id,
            toolName: toolUse.name,
            args: toolUse.input,
          },
        });

        this._onStreamEvent.fire({
          type: 'status',
          content: `Running ${formatToolName(toolUse.name)}...`,
        });

        const toolResult = await this.toolExecutor.execute({
          toolCallId: toolUse.id,
          toolName: toolUse.name,
          args: toolUse.input,
        });

        this._onStreamEvent.fire({ type: 'tool-result', toolResult });

        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: toolResult.result,
          is_error: toolResult.isError,
        });
      }

      // Add tool results as a user message (Anthropic format)
      anthropicMessages.push({ role: 'user', content: toolResultBlocks });

      this._onStreamEvent.fire({ type: 'status', content: 'Thinking...' });
    }
  }

  // ─── Anthropic API call with streaming ───────────────────────────────────

  private async callAnthropic(args: {
    apiKey: string;
    system: string;
    messages: AnthropicMessage[];
    tools: any[];
    signal: AbortSignal;
  }): Promise<{
    stopReason: string;
    contentBlocks: ContentBlock[];
    usage: any;
  }> {
    const body = {
      model: ANTHROPIC_MODEL,
      max_tokens: MAX_TOKENS,
      system: args.system,
      messages: args.messages,
      tools: args.tools,
      stream: true,
    };

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': args.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: args.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      if (response.status === 401) {
        throw new Error(
          'Invalid Anthropic API key. Please check your key in settings.',
        );
      }
      if (response.status === 429) {
        throw new Error(
          'Anthropic rate limit exceeded. Please wait a moment and try again.',
        );
      }
      throw new Error(`Anthropic API error (${response.status}): ${text}`);
    }

    if (!response.body) {
      throw new Error('No response body from Anthropic');
    }

    return this.processAnthropicSSE(response.body, args.signal);
  }

  /**
   * Process Anthropic SSE stream and collect content blocks.
   * Also streams text deltas to the webview in real-time.
   */
  private async processAnthropicSSE(
    body: ReadableStream<Uint8Array>,
    signal: AbortSignal,
  ): Promise<{
    stopReason: string;
    contentBlocks: ContentBlock[];
    usage: any;
  }> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let stopReason = 'end_turn';
    let usage: any = {};

    // Content block tracking
    const contentBlocks: ContentBlock[] = [];
    let currentBlockType: string | null = null;
    let currentText = '';
    let currentToolUse: { id: string; name: string; inputJson: string } | null =
      null;

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

          let event: any;
          try {
            event = JSON.parse(data);
          } catch {
            continue;
          }

          switch (event.type) {
            case 'message_start': {
              if (event.message?.usage) {
                usage = { ...usage, ...event.message.usage };
              }
              break;
            }

            case 'content_block_start': {
              const block = event.content_block;
              currentBlockType = block.type;

              if (block.type === 'text') {
                currentText = block.text || '';
              } else if (block.type === 'tool_use') {
                currentToolUse = {
                  id: block.id,
                  name: block.name,
                  inputJson: '',
                };
              }
              break;
            }

            case 'content_block_delta': {
              const delta = event.delta;
              if (delta.type === 'text_delta') {
                currentText += delta.text;
                // Stream text through artifact parser → webview
                const cleanText = this.artifactParser.feed(delta.text);
                if (cleanText) {
                  this._onStreamEvent.fire({
                    type: 'text',
                    content: cleanText,
                  });
                }
              } else if (delta.type === 'input_json_delta' && currentToolUse) {
                currentToolUse.inputJson += delta.partial_json;
              }
              break;
            }

            case 'content_block_stop': {
              if (currentBlockType === 'text') {
                contentBlocks.push({ type: 'text', text: currentText });
                currentText = '';
              } else if (currentBlockType === 'tool_use' && currentToolUse) {
                let input = {};
                try {
                  if (currentToolUse.inputJson) {
                    input = JSON.parse(currentToolUse.inputJson);
                  }
                } catch {
                  logger.warn('Failed to parse tool input JSON');
                }
                contentBlocks.push({
                  type: 'tool_use',
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
              if (event.usage) {
                usage = { ...usage, ...event.usage };
              }
              break;
            }

            case 'error': {
              throw new Error(event.error?.message || 'Anthropic stream error');
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
      // Flush any remaining artifact parser buffer
      this.artifactParser.flush();
    }

    return { stopReason, contentBlocks, usage };
  }

  // ─── Build Anthropic-format messages ─────────────────────────────────────

  private buildAnthropicMessages(): AnthropicMessage[] {
    const msgs: AnthropicMessage[] = [];

    for (const msg of this.messages) {
      if (msg.role === 'system') continue;
      if (msg.role === 'user') {
        msgs.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        msgs.push({ role: 'assistant', content: msg.content });
      }
    }

    return msgs;
  }

  // ─── Credit deduction ────────────────────────────────────────────────────

  private async deductCredits(): Promise<void> {
    try {
      const userId = await this.tokenStore.getUserId();
      if (!userId) return;

      const totalInput =
        this.turnUsage.inputTokens +
        this.turnUsage.cacheCreation +
        this.turnUsage.cacheRead;
      const totalOutput = this.turnUsage.outputTokens;

      if (totalInput === 0 && totalOutput === 0) return;

      const result = await this.creditsManager.reportUsage({
        userId,
        chatId: this.chatId,
        promptTokens: totalInput,
        completionTokens: totalOutput,
        basePromptTokens: this.turnUsage.inputTokens,
        cacheCreationTokens: this.turnUsage.cacheCreation,
        cacheReadTokens: this.turnUsage.cacheRead,
      });

      if (result) {
        logger.info(
          `Credits deducted: ${result.creditsDeducted} | Remaining: ${result.remainingCredits} | ` +
            `Tokens: ${totalInput} in + ${totalOutput} out`,
        );
      }
    } catch (err) {
      logger.debug('Credit deduction failed (non-fatal):', err);
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private isAuthError(err: any): boolean {
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
    this.turnUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreation: 0,
      cacheRead: 0,
    };
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatToolName(name: string): string {
  switch (name) {
    case 'deploy':
      return 'deploy';
    case 'npmInstall':
      return 'npm install';
    case 'view':
      return 'view file';
    case 'edit':
      return 'edit file';
    case 'lookupDocs':
      return 'docs lookup';
    case 'lookupConvexDocsTool':
      return 'Convex docs lookup';
    case 'addEnvironmentVariables':
      return 'environment variables';
    case 'getConvexDeploymentName':
      return 'get deployment name';
    default:
      return name;
  }
}
