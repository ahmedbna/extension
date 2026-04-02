// src/webview/ChatWebviewProvider.ts

import * as vscode from 'vscode';
import { BNAAgent, type StreamEvent } from '../agent/BNAAgent';
import { AuthManager } from '../auth/AuthManager';
import { CreditsManager } from '../credits/CreditsManager';
import { WEBVIEW_VIEW_TYPE } from '../constants';
import { logger } from '../utils/logger';
import { ensureTemplateCopied } from '@/utils/template';

/**
 * Provides the chat webview in the VS Code sidebar.
 *
 * The webview communicates with the extension host via postMessage.
 * Auth state is pushed to the webview reactively so the UI always
 * reflects the correct state (sign-in prompt vs chat).
 */
export class ChatWebviewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private streamDisposable?: vscode.Disposable;
  private authDisposable?: vscode.Disposable;

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
        vscode.Uri.joinPath(this.extensionUri, 'web', 'dist'),
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

    // Listen to auth state changes and push to webview
    this.authDisposable = this.authManager.onAuthStateChanged(
      (isAuthenticated) => {
        this.postMessage({ type: 'authState', isAuthenticated });
      },
    );

    webviewView.onDidDispose(() => {
      this.streamDisposable?.dispose();
      this.authDisposable?.dispose();
    });

    // Send initial state after a brief delay to ensure webview is ready
    this.sendInitialState();
  }

  private postMessage(message: any): void {
    this.view?.webview.postMessage(message);
  }

  /**
   * Send the initial state to the webview on load.
   */
  private async sendInitialState(): Promise<void> {
    const isAuthenticated = await this.authManager.isAuthenticated();
    const hasConvex = await this.creditsManager.hasConnection();

    this.postMessage({
      type: 'init',
      isAuthenticated,
      hasConvexConnection: hasConvex,
      messages: isAuthenticated ? this.agent.getMessages() : [],
    });
  }

  /**
   * Handle messages from the webview.
   */
  private async handleMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'sendMessage': {
        const isAuth = await this.authManager.isAuthenticated();
        if (!isAuth) {
          this.postMessage({ type: 'authState', isAuthenticated: false });
          this.postMessage({
            type: 'error',
            error: 'Please sign in to send messages.',
          });
          return;
        }

        if (!message.text) return;

        // ✅ STEP 1: Ensure template exists BEFORE AI runs
        try {
          await ensureTemplateCopied(this.extensionUri);
        } catch (err: any) {
          this.postMessage({
            type: 'error',
            error: err.message || 'Failed to initialize project',
          });
          return;
        }

        // ✅ STEP 2: Now safe to run AI
        await this.agent.sendMessage(message.text);
        break;
      }

      case 'stopGeneration':
        this.agent.abort();
        break;

      case 'signIn': {
        const success = await this.authManager.signIn();
        if (success) {
          this.creditsManager.updateStatusBar();
          // Re-send full state so UI transitions properly
          await this.sendInitialState();
        }
        break;
      }

      case 'signOut':
        await this.authManager.signOut();
        this.agent.reset();
        this.postMessage({ type: 'chatReset' });
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
        this.postMessage({ type: 'streamText', text: event.content });
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
        this.postMessage({ type: 'fileWrite', filePath: event.filePath });
        break;

      case 'finish':
        this.postMessage({ type: 'streamEnd' });
        break;

      case 'error':
        this.postMessage({ type: 'error', error: event.error });
        break;

      case 'auth-required':
        // Push auth state change + specific error
        this.postMessage({ type: 'authState', isAuthenticated: false });
        this.postMessage({ type: 'authRequired', error: event.error });
        this.postMessage({ type: 'streamEnd' });
        break;
    }
  }

  /**
   * Generate the HTML content for the webview.
   * The fallback UI properly gates on auth state and shows sign-in when needed.
   */
  private getHtmlContent(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'web', 'dist', 'index.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'web', 'dist', 'index.css'),
    );
    const logoUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'bricks.png'),
    );
    const convexUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'convex.svg'),
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
    #root { height: 100%; display: flex; flex-direction: column; }

    /* ── Auth Prompt ─────────────────────────────────────── */
    .bna-auth-screen {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      padding: 32px;
      text-align: center;
      gap: 8px;
    }
    .bna-auth-screen img { width: 48px; margin-bottom: 8px; }
    .bna-auth-screen h1 { font-size: 24px; font-weight: 900; margin: 0; letter-spacing: -0.04em; }
    .bna-auth-screen h2 { font-size: 15px; font-weight: 600; margin: 0; opacity: 0.8; }
    .bna-auth-screen p { font-size: 13px; opacity: 0.5; max-width: 240px; line-height: 1.5; }
    .bna-auth-btn {
      background: var(--bna-yellow);
      color: #000;
      border: none;
      border-radius: 10px;
      padding: 12px 28px;
      font-weight: 700;
      font-size: 14px;
      cursor: pointer;
      margin-top: 12px;
      transition: opacity 0.15s;
    }
    .bna-auth-btn:hover { opacity: 0.9; }
    .bna-auth-note { font-size: 11px; opacity: 0.3; margin-top: 8px; }

    /* ── Chat UI ──────────────────────────────────────────── */
    .bna-fallback { display: none; flex-direction: column; height: 100%; }
    .bna-fallback.active { display: flex; }
    .bna-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      border-bottom: 1px solid var(--vscode-widget-border);
      flex-shrink: 0;
    }
    .bna-header-left { display: flex; align-items: center; gap: 6px; }
    .bna-header-left img { width: 20px; height: 20px; }
    .bna-header-left span { font-weight: 800; font-size: 15px; letter-spacing: -0.03em; }
    .bna-header-right { display: flex; gap: 4px; }
    .bna-header-btn {
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.1);
      color: var(--vscode-foreground);
      border-radius: 6px;
      padding: 4px 8px;
      cursor: pointer;
      font-size: 13px;
    }
    .bna-header-btn:hover { background: rgba(255,255,255,0.1); }
    .bna-messages {
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 12px;
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
      border-radius: 12px 12px 2px 12px;
    }
    .bna-msg.assistant {
      align-self: flex-start;
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-widget-border);
      max-width: 95%;
      border-radius: 2px 12px 12px 12px;
    }
    .bna-msg.tool {
      align-self: flex-start;
      background: var(--vscode-textBlockQuote-background);
      border-left: 3px solid var(--bna-yellow);
      font-size: 12px;
      max-width: 90%;
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
    .bna-input-area {
      display: flex;
      align-items: flex-end;
      gap: 6px;
      padding: 8px 12px 12px;
      border-top: 1px solid var(--vscode-widget-border);
      background: rgba(255,255,255,0.02);
    }
    .bna-input-area textarea {
      flex: 1;
      resize: none;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      padding: 8px;
      border-radius: 8px;
      font-family: inherit;
      font-size: 13px;
      min-height: 36px;
      max-height: 200px;
      outline: none;
    }
    .bna-input-area textarea:focus { border-color: var(--vscode-focusBorder); }
    .bna-send-btn {
      width: 32px; height: 32px;
      border-radius: 50%;
      border: none;
      background: var(--bna-yellow);
      color: #000;
      font-weight: 700;
      font-size: 14px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .bna-send-btn:hover { opacity: 0.9; }
    .bna-send-btn:disabled { opacity: 0.3; cursor: not-allowed; }
    .bna-send-btn.stop {
      background: rgba(255,255,255,0.1);
      color: var(--vscode-foreground);
      border: 1px solid rgba(255,255,255,0.15);
      font-size: 10px;
    }
    .bna-status {
      padding: 4px 12px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      display: none;
    }
    .bna-status.visible { display: block; }

    /* Hide element */
    .hidden { display: none !important; }
  </style>
</head>
<body>
  <div id="root">
    <!-- ── Auth Screen (shown when not authenticated) ── -->
    <div class="bna-auth-screen" id="auth-screen">
      <img src="${logoUri}" alt="BNA" />
      <h1>BNA</h1>
      <h2>Build Fullstack Mobile Apps</h2>
      <p>Sign in to start building Expo + Convex apps with AI</p>
      <button class="bna-auth-btn" id="sign-in-btn">Sign In to Get Started</button>
      <span class="bna-auth-note">Opens your browser for secure authentication</span>
    </div>

    <!-- ── Chat Screen (shown when authenticated) ── -->
    <div class="bna-fallback" id="chat-screen">
      <div class="bna-header">
        <div class="bna-header-left">
          <img src="${logoUri}" alt="BNA" />
          <span>BNA</span>
        </div>
        <div class="bna-header-right">
          <button class="bna-header-btn" id="btn-connect" title="Connect Convex"><img style="width: 12px; height: 12px;" src="${convexUri}" alt="Connect Convex" /></button>
          <button class="bna-header-btn" id="btn-new-chat" title="New Chat">💬</button>
          <button class="bna-header-btn" id="btn-sign-out" title="Sign Out">🛑</button>
        </div>
      </div>

      <div class="bna-messages" id="messages-container">
        <div class="bna-empty" id="empty-state">
          <img src="${logoUri}" alt="BNA" />
          <p>Build fullstack mobile apps with AI</p>
          <p style="font-size: 12px;">Send a message to start building</p>
        </div>
      </div>

      <div id="status-bar" class="bna-status"></div>

      <div class="bna-input-area">
        <textarea
          id="message-input"
          placeholder="Describe what you want to build..."
          rows="1"
        ></textarea>
        <button class="bna-send-btn" id="send-btn" disabled>↑</button>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const authScreen = document.getElementById('auth-screen');
    const chatScreen = document.getElementById('chat-screen');
    const messagesContainer = document.getElementById('messages-container');
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const emptyState = document.getElementById('empty-state');
    const statusBar = document.getElementById('status-bar');
    const signInBtn = document.getElementById('sign-in-btn');

    let isStreaming = false;
    let isAuthenticated = false;
    let currentAssistantEl = null;
    let currentAssistantText = '';

    // ── Screen switching ───────────────────────────────────
    function showScreen(screen) {
      if (screen === 'auth') {
        authScreen.classList.remove('hidden');
        chatScreen.classList.remove('active');
        chatScreen.classList.add('hidden');
      } else {
        authScreen.classList.add('hidden');
        chatScreen.classList.remove('hidden');
        chatScreen.classList.add('active');
      }
    }

    // Start with auth screen hidden until we know the state
    showScreen('auth');

    // ── Sign In ────────────────────────────────────────────
    signInBtn.addEventListener('click', () => {
      signInBtn.textContent = 'Signing in...';
      signInBtn.disabled = true;
      vscode.postMessage({ type: 'signIn' });
    });

    // ── Header buttons ─────────────────────────────────────
    document.getElementById('btn-connect').addEventListener('click', () => {
      vscode.postMessage({ type: 'connectConvex' });
    });
    document.getElementById('btn-new-chat').addEventListener('click', () => {
      vscode.postMessage({ type: 'newChat' });
    });
    document.getElementById('btn-sign-out').addEventListener('click', () => {
      vscode.postMessage({ type: 'signOut' });
    });

    // ── Send message ───────────────────────────────────────
    function sendMessage() {
      const text = messageInput.value.trim();
      if (!text || isStreaming) return;

      addMessage('user', text);
      messageInput.value = '';
      updateSendBtn();
      vscode.postMessage({ type: 'sendMessage', text: text });
      isStreaming = true;
      sendBtn.innerHTML = '■';
      sendBtn.classList.add('stop');
      sendBtn.disabled = false;
      setStatus('Building...');
    }

    sendBtn.addEventListener('click', () => {
      if (isStreaming) {
        vscode.postMessage({ type: 'stopGeneration' });
        stopStreaming();
      } else {
        sendMessage();
      }
    });

    messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (isStreaming) {
          vscode.postMessage({ type: 'stopGeneration' });
          stopStreaming();
        } else {
          sendMessage();
        }
      }
    });

    messageInput.addEventListener('input', updateSendBtn);

    function updateSendBtn() {
      if (!isStreaming) {
        sendBtn.disabled = !messageInput.value.trim();
      }
    }

    function stopStreaming() {
      isStreaming = false;
      sendBtn.innerHTML = '↑';
      sendBtn.classList.remove('stop');
      updateSendBtn();
      currentAssistantEl = null;
      currentAssistantText = '';
      setStatus('');
    }

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
      statusBar.textContent = text;
      statusBar.classList.toggle('visible', !!text);
    }

    // ── Handle messages from extension ─────────────────────
    window.addEventListener('message', (event) => {
      const msg = event.data;

      switch (msg.type) {
        case 'init': {
          isAuthenticated = msg.isAuthenticated;
          showScreen(isAuthenticated ? 'chat' : 'auth');

          // Reset sign-in button state
          signInBtn.textContent = 'Sign In to Get Started';
          signInBtn.disabled = false;

          if (msg.messages && msg.messages.length > 0) {
            // Clear existing messages
            while (messagesContainer.firstChild && messagesContainer.firstChild !== emptyState) {
              messagesContainer.removeChild(messagesContainer.firstChild);
            }
            msg.messages.forEach(m => addMessage(m.role, m.content));
          }
          break;
        }

        case 'authState': {
          isAuthenticated = msg.isAuthenticated;
          showScreen(isAuthenticated ? 'chat' : 'auth');

          // Reset sign-in button
          signInBtn.textContent = 'Sign In to Get Started';
          signInBtn.disabled = false;
          break;
        }

        case 'authRequired': {
          // Session expired mid-conversation
          isAuthenticated = false;
          showScreen('auth');
          signInBtn.textContent = 'Sign In to Continue';
          signInBtn.disabled = false;
          stopStreaming();
          break;
        }

        case 'streamText': {
          if (!currentAssistantEl) {
            currentAssistantEl = addMessage('assistant', '');
            currentAssistantText = '';
          }
          currentAssistantText += msg.text;
          currentAssistantEl.textContent = currentAssistantText;
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
          break;
        }

        case 'toolCall':
          addMessage('tool', '🔧 ' + (msg.toolName || 'Tool') + '...');
          break;

        case 'toolResult':
          if (msg.isError) {
            addMessage('tool', '❌ Error: ' + (msg.result || '').substring(0, 200));
          } else {
            addMessage('tool', '✅ ' + (msg.toolName || 'Done'));
          }
          break;

        case 'fileWrite':
          addMessage('tool', '📄 Wrote: ' + msg.filePath);
          break;

        case 'streamEnd':
          stopStreaming();
          setStatus('Done');
          setTimeout(() => setStatus(''), 2000);
          break;

        case 'error':
          addMessage('tool', '❌ ' + msg.error);
          stopStreaming();
          break;

        case 'chatReset':
          // Clear all messages
          messagesContainer.innerHTML = '';
          messagesContainer.appendChild(emptyState);
          emptyState.style.display = 'flex';
          stopStreaming();
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
