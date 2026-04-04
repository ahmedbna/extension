// src/webview/ChatWebviewProvider.ts
//
// Provides the chat webview using the separately-built React app (web/dist/).
// Bridges stream events from BNAAgent to the webview.

import * as vscode from 'vscode';
import { BNAAgent, type StreamEvent } from '../agent/BNAAgent';
import { AuthManager } from '../auth/AuthManager';
import { CreditsManager } from '../credits/CreditsManager';
import { logger } from '../utils/logger';
import { ensureProjectReady } from '../utils/projectSetup';

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

    webviewView.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      try {
        await this.handleMessage(message);
      } catch (err) {
        logger.error('Error handling webview message:', err);
        this.postMessage({ type: 'error', error: String(err) });
      }
    });

    this.streamDisposable = this.agent.onStreamEvent((event) => {
      this.handleStreamEvent(event);
    });

    this.authDisposable = this.authManager.onAuthStateChanged(
      (isAuthenticated) => {
        this.postMessage({ type: 'authState', isAuthenticated });
      },
    );

    webviewView.onDidDispose(() => {
      this.streamDisposable?.dispose();
      this.authDisposable?.dispose();
    });

    this.sendInitialState();
  }

  private postMessage(message: any): void {
    this.view?.webview.postMessage(message);
  }

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

        // Ensure project template exists before AI runs
        try {
          await ensureProjectReady();
        } catch (err: any) {
          this.postMessage({
            type: 'error',
            error: err.message || 'Failed to initialize project',
          });
          return;
        }

        // Run the AI agent
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

      case 'status':
        this.postMessage({ type: 'status', text: event.content });
        break;

      case 'finish':
        this.postMessage({ type: 'streamEnd' });
        break;

      case 'error':
        this.postMessage({ type: 'error', error: event.error });
        break;

      case 'auth-required':
        this.postMessage({ type: 'authState', isAuthenticated: false });
        this.postMessage({ type: 'authRequired', error: event.error });
        this.postMessage({ type: 'streamEnd' });
        break;
    }
  }

  /**
   * Returns HTML that loads the React webview build.
   * Falls back to a minimal inline UI if the build isn't available.
   */
  private getHtmlContent(webview: vscode.Webview): string {
    const nonce = getNonce();

    // Try to load the built React app
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'web', 'dist', 'index.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'web', 'dist', 'index.css'),
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    style-src ${webview.cspSource} 'unsafe-inline';
    script-src 'nonce-${nonce}';
    img-src ${webview.cspSource} https: data:;
    font-src ${webview.cspSource};
  ">
  <link rel="stylesheet" href="${styleUri}">
  <title>BNA</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
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
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
