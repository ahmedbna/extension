import * as vscode from 'vscode';
import { BNAAgent, type StreamEvent } from '../agent/BNAAgent';
import { AuthManager } from '../auth/AuthManager';
import { CreditsManager } from '../credits/CreditsManager';
import { WEBVIEW_VIEW_TYPE } from '../constants';
import { logger } from '../utils/logger';

/**
 * Provides the chat webview in the VS Code sidebar.
 * The webview is a React app that communicates with the extension host
 * via postMessage.
 */
export class ChatWebviewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private streamDisposable?: vscode.Disposable;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly agent: BNAAgent,
    private readonly authManager: AuthManager,
    private readonly creditsManager: CreditsManager,
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'media'),
        vscode.Uri.joinPath(this.extensionUri, 'webview-ui', 'dist'),
      ],
    };

    webviewView.webview.html = this.getHtmlContent(webviewView.webview);

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      try {
        await this.handleMessage(message);
      } catch (err) {
        logger.error('Error handling webview message:', err);
        this.postMessage({ type: 'error', error: String(err) });
      }
    });

    // Listen to stream events from the agent
    this.streamDisposable = this.agent.onStreamEvent((event) => {
      this.handleStreamEvent(event);
    });

    // Listen to auth state changes
    this.authManager.onAuthStateChanged((isAuthenticated) => {
      this.postMessage({ type: 'authState', isAuthenticated });
    });

    webviewView.onDidDispose(() => {
      this.streamDisposable?.dispose();
    });

    // Send initial state
    this.sendInitialState();
  }

  /**
   * Post a message to the webview.
   */
  private postMessage(message: any): void {
    this.view?.webview.postMessage(message);
  }

  /**
   * Send the initial state to the webview on load.
   */
  private async sendInitialState(): Promise<void> {
    const isAuthenticated = await this.authManager.isAuthenticated();
    this.postMessage({
      type: 'init',
      isAuthenticated,
      messages: this.agent.getMessages(),
    });
  }

  /**
   * Handle messages from the webview React app.
   */
  private async handleMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'sendMessage':
        await this.agent.sendMessage(message.text);
        break;

      case 'stopGeneration':
        this.agent.abort();
        break;

      case 'signIn':
        await this.authManager.signIn();
        break;

      case 'signOut':
        await this.authManager.signOut();
        break;

      case 'newChat':
        this.agent.reset();
        this.postMessage({ type: 'chatReset' });
        break;

      case 'viewCredits':
        vscode.commands.executeCommand('bna.viewCredits');
        break;

      case 'buyCredits':
        vscode.commands.executeCommand('bna.buyCredits');
        break;

      case 'connectConvex':
        vscode.commands.executeCommand('bna.connectConvex');
        break;

      case 'ready':
        await this.sendInitialState();
        break;
    }
  }

  /**
   * Forward stream events from the agent to the webview.
   */
  private handleStreamEvent(event: StreamEvent): void {
    switch (event.type) {
      case 'text':
        this.postMessage({
          type: 'streamText',
          text: event.content,
        });
        break;

      case 'tool-call':
        this.postMessage({
          type: 'toolCall',
          toolName: event.toolCall?.toolName,
          toolCallId: event.toolCall?.toolCallId,
        });
        break;

      case 'tool-result':
        this.postMessage({
          type: 'toolResult',
          toolCallId: event.toolResult?.toolCallId,
          result: event.toolResult?.result,
          isError: event.toolResult?.isError,
        });
        break;

      case 'file-write':
        this.postMessage({
          type: 'fileWrite',
          filePath: event.filePath,
        });
        break;

      case 'finish':
        this.postMessage({ type: 'streamEnd' });
        break;

      case 'error':
        this.postMessage({
          type: 'error',
          error: event.error,
        });
        break;
    }
  }

  /**
   * Generate the HTML content for the webview.
   * In development, this loads from the Vite dev server.
   * In production, it loads the built React bundle.
   */
  private getHtmlContent(webview: vscode.Webview): string {
    // Try to load from webview-ui build
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'webview-ui', 'dist', 'index.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'webview-ui', 'dist', 'index.css'),
    );
    const logoUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'bricks.png'),
    );

    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https:; font-src ${webview.cspSource};">
  <link rel="stylesheet" href="${styleUri}">
  <title>BNA Chat</title>
  <style>
    :root {
      --bna-yellow: #FAD40B;
      --bna-black: #0d0d0f;
    }
    body {
      margin: 0;
      padding: 0;
      background: var(--vscode-sideBar-background);
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      height: 100vh;
      overflow: hidden;
    }
    #root {
      height: 100%;
      display: flex;
      flex-direction: column;
    }

    /* Inline fallback chat UI if React bundle not loaded */
    .bna-fallback {
      display: flex;
      flex-direction: column;
      height: 100%;
      padding: 16px;
    }
    .bna-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--vscode-widget-border);
      margin-bottom: 12px;
    }
    .bna-header img { width: 24px; height: 24px; }
    .bna-header h2 { margin: 0; font-size: 16px; font-weight: 700; }
    .bna-messages {
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .bna-msg {
      padding: 8px 12px;
      border-radius: 8px;
      font-size: 13px;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .bna-msg.user {
      align-self: flex-end;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      max-width: 85%;
    }
    .bna-msg.assistant {
      align-self: flex-start;
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-widget-border);
      max-width: 95%;
    }
    .bna-msg.tool {
      align-self: flex-start;
      background: var(--vscode-textBlockQuote-background);
      border-left: 3px solid var(--bna-yellow);
      font-size: 12px;
      max-width: 90%;
    }
    .bna-input-area {
      display: flex;
      gap: 8px;
      padding-top: 12px;
      border-top: 1px solid var(--vscode-widget-border);
    }
    .bna-input-area textarea {
      flex: 1;
      resize: none;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      padding: 8px;
      border-radius: 6px;
      font-family: inherit;
      font-size: 13px;
      min-height: 40px;
      max-height: 200px;
    }
    .bna-input-area textarea:focus { outline: 1px solid var(--vscode-focusBorder); }
    .bna-send-btn {
      background: var(--bna-yellow);
      color: #000;
      border: none;
      border-radius: 6px;
      padding: 8px 16px;
      font-weight: 700;
      cursor: pointer;
      font-size: 13px;
      align-self: flex-end;
    }
    .bna-send-btn:hover { opacity: 0.9; }
    .bna-send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .bna-status {
      padding: 4px 8px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }
    .bna-empty {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      gap: 12px;
      opacity: 0.6;
    }
    .bna-empty img { width: 48px; opacity: 0.5; }
    .bna-auth-prompt {
      text-align: center;
      padding: 40px 20px;
    }
    .bna-auth-btn {
      background: var(--bna-yellow);
      color: #000;
      border: none;
      border-radius: 8px;
      padding: 12px 24px;
      font-weight: 700;
      cursor: pointer;
      font-size: 14px;
      margin-top: 16px;
    }
  </style>
</head>
<body>
  <div id="root">
    <div class="bna-fallback" id="fallback-ui">
      <div class="bna-header">
        <img src="${logoUri}" alt="BNA" />
        <h2>BNA</h2>
      </div>

      <div class="bna-messages" id="messages-container">
        <div class="bna-empty" id="empty-state">
          <img src="${logoUri}" alt="BNA" />
          <p>Build fullstack mobile apps with AI</p>
          <p style="font-size: 12px;">Send a message to start building</p>
        </div>
      </div>

      <div id="status-bar" class="bna-status" style="display: none;"></div>

      <div class="bna-input-area">
        <textarea
          id="message-input"
          placeholder="Describe what you want to build..."
          rows="2"
        ></textarea>
        <button class="bna-send-btn" id="send-btn">Send</button>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const messagesContainer = document.getElementById('messages-container');
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const emptyState = document.getElementById('empty-state');
    const statusBar = document.getElementById('status-bar');

    let isStreaming = false;
    let currentAssistantEl = null;
    let currentAssistantText = '';

    // Send message
    function sendMessage() {
      const text = messageInput.value.trim();
      if (!text || isStreaming) return;

      addMessage('user', text);
      messageInput.value = '';
      vscode.postMessage({ type: 'sendMessage', text });
      isStreaming = true;
      sendBtn.textContent = 'Stop';
      setStatus('Building...');
    }

    sendBtn.addEventListener('click', () => {
      if (isStreaming) {
        vscode.postMessage({ type: 'stopGeneration' });
        isStreaming = false;
        sendBtn.textContent = 'Send';
        setStatus('');
      } else {
        sendMessage();
      }
    });

    messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (isStreaming) {
          vscode.postMessage({ type: 'stopGeneration' });
          isStreaming = false;
          sendBtn.textContent = 'Send';
        } else {
          sendMessage();
        }
      }
    });

    function addMessage(role, text) {
      if (emptyState) emptyState.style.display = 'none';

      const el = document.createElement('div');
      el.className = 'bna-msg ' + role;
      el.textContent = text;
      messagesContainer.appendChild(el);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
      return el;
    }

    function setStatus(text) {
      statusBar.style.display = text ? 'block' : 'none';
      statusBar.textContent = text;
    }

    // Handle messages from extension
    window.addEventListener('message', (event) => {
      const msg = event.data;

      switch (msg.type) {
        case 'init':
          // Render existing messages
          if (msg.messages) {
            msg.messages.forEach(m => addMessage(m.role, m.content));
          }
          break;

        case 'streamText':
          if (!currentAssistantEl) {
            currentAssistantEl = addMessage('assistant', '');
            currentAssistantText = '';
          }
          currentAssistantText += msg.text;
          currentAssistantEl.textContent = currentAssistantText;
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
          break;

        case 'toolCall':
          addMessage('tool', '🔧 ' + (msg.toolName || 'Tool') + '...');
          break;

        case 'toolResult':
          if (msg.isError) {
            addMessage('tool', '❌ Error: ' + (msg.result || '').substring(0, 200));
          } else {
            addMessage('tool', '✅ ' + (msg.toolName || 'Tool') + ' completed');
          }
          break;

        case 'fileWrite':
          addMessage('tool', '📄 Wrote: ' + msg.filePath);
          break;

        case 'streamEnd':
          isStreaming = false;
          sendBtn.textContent = 'Send';
          currentAssistantEl = null;
          currentAssistantText = '';
          setStatus('Done');
          setTimeout(() => setStatus(''), 2000);
          break;

        case 'error':
          addMessage('tool', '❌ ' + msg.error);
          isStreaming = false;
          sendBtn.textContent = 'Send';
          currentAssistantEl = null;
          setStatus('');
          break;

        case 'chatReset':
          messagesContainer.innerHTML = '';
          if (emptyState) {
            messagesContainer.appendChild(emptyState);
            emptyState.style.display = 'flex';
          }
          break;

        case 'authState':
          // Could show/hide auth prompt
          break;
      }
    });

    // Tell extension we're ready
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}

// Types for messages from webview
interface WebviewMessage {
  type: string;
  text?: string;
  [key: string]: any;
}

function getNonce(): string {
  let text = '';
  const possible =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
