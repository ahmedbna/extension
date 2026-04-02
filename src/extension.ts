// src/extension.ts

import * as vscode from 'vscode';
import { AuthManager } from './auth/AuthManager';
import { TokenStore } from './auth/TokenStore';
import { BNAUriHandler } from './auth/BNAUriHandler';
import { ConvexClient } from './auth/ConvexClient';
import { ConvexOAuth } from './convex/ConvexOAuth';
import { ConvexProjectManager } from './convex/ConvexProjectManager';
import { CreditsManager } from './credits/CreditsManager';
import { TerminalManager } from './terminal/TerminalManager';
import { ToolExecutor } from './agent/ToolExecutor';
import { BNAAgent } from './agent/BNAAgent';
import { ChatWebviewProvider } from './webview/ChatWebviewProvider';
import { BNA_API_BASE_URL, WEBVIEW_VIEW_TYPE } from './constants';
import { logger } from './utils/logger';
import { getWorkspaceRoot, hasConvexProject } from './utils/workspace';
import { TemplateScaffolder } from './scaffold/TemplateScaffolder';

let tokenStore: TokenStore;
let authManager: AuthManager;
let convexClient: ConvexClient;
let convexOAuth: ConvexOAuth;
let projectManager: ConvexProjectManager;
let creditsManager: CreditsManager;
let terminalManager: TerminalManager;
let toolExecutor: ToolExecutor;
let agent: BNAAgent;
let chatProvider: ChatWebviewProvider;
let uriHandler: BNAUriHandler;

export function activate(context: vscode.ExtensionContext) {
  logger.info('BNA extension activating...');

  // ── URI handler (must be registered FIRST) ────────────────────────────
  uriHandler = new BNAUriHandler();
  context.subscriptions.push(vscode.window.registerUriHandler(uriHandler));

  // ── Core services ─────────────────────────────────────────────────────
  tokenStore = new TokenStore(context.secrets);
  authManager = new AuthManager(tokenStore, uriHandler);

  const config = vscode.workspace.getConfiguration('bna');
  const convexUrl = config.get<string>('convexUrl') || '';
  convexClient = new ConvexClient(convexUrl, tokenStore);

  convexOAuth = new ConvexOAuth(tokenStore, uriHandler);
  projectManager = new ConvexProjectManager(tokenStore, convexOAuth);
  creditsManager = new CreditsManager(tokenStore);
  terminalManager = new TerminalManager();
  toolExecutor = new ToolExecutor(terminalManager, projectManager);

  agent = new BNAAgent(
    tokenStore,
    authManager,
    toolExecutor,
    creditsManager,
    projectManager,
  );

  // ── Chat Webview ──────────────────────────────────────────────────────
  chatProvider = new ChatWebviewProvider(
    context.extensionUri,
    agent,
    authManager,
    creditsManager,
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(WEBVIEW_VIEW_TYPE, chatProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  // ── Commands ──────────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('bna.openChat', () => {
      vscode.commands.executeCommand(`${WEBVIEW_VIEW_TYPE}.focus`);
    }),

    vscode.commands.registerCommand('bna.signIn', async () => {
      const success = await authManager.signIn();
      if (success) {
        creditsManager.updateStatusBar();
        await tryLoadConvexConnection();
      }
    }),

    vscode.commands.registerCommand('bna.signOut', async () => {
      await authManager.signOut();
      agent.reset();
      creditsManager.updateStatusBar();
    }),

    vscode.commands.registerCommand('bna.connectConvex', async () => {
      const isAuth = await authManager.ensureAuthenticated();
      if (!isAuth) return;

      const hasConnection = await tokenStore.hasConvexConnection();
      if (!hasConnection) {
        await convexOAuth.connectTeam();
        return;
      }

      const root = getWorkspaceRoot();
      if (!root) {
        const choice = await vscode.window.showInformationMessage(
          'Convex account already connected. Open a project folder to create a Convex deployment.',
          'Reconnect Convex Account',
        );
        if (choice === 'Reconnect Convex Account') {
          await convexOAuth.connectTeam();
        }
        return;
      }

      const existing = await projectManager.loadExistingProject();
      if (existing) {
        vscode.window.showInformationMessage(
          `Already connected to Convex project: ${existing.deploymentName}`,
        );
        return;
      }

      const name = await vscode.window.showInputBox({
        prompt: 'Project name for your Convex deployment',
        value: 'BNA App',
      });
      if (!name) return;

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Creating Convex project...',
        },
        async () => {
          const info = await projectManager.initializeProject(name);
          if (info) {
            vscode.window.showInformationMessage(
              `Convex project created: ${info.projectSlug}`,
            );
          }
        },
      );
    }),

    vscode.commands.registerCommand('bna.newProject', async () => {
      const isAuth = await authManager.ensureAuthenticated();
      if (!isAuth) return;

      const scaffolder = new TemplateScaffolder(
        context,
        tokenStore,
        projectManager,
      );
      await scaffolder.scaffold();
    }),

    vscode.commands.registerCommand('bna.viewCredits', async () => {
      const isAuth = await authManager.isAuthenticated();
      if (!isAuth) {
        vscode.window.showInformationMessage('Sign in to view your credits.');
        return;
      }

      const info = await creditsManager.fetchCredits();
      if (!info) {
        vscode.window.showInformationMessage('Could not fetch credits.');
        return;
      }

      const choice = await vscode.window.showInformationMessage(
        `BNA Credits: ${info.credits} remaining (${info.totalCreditsUsed} used)`,
        'Buy More',
      );
      if (choice === 'Buy More') {
        vscode.commands.executeCommand('bna.buyCredits');
      }
    }),

    vscode.commands.registerCommand('bna.buyCredits', () => {
      vscode.env.openExternal(vscode.Uri.parse(`${BNA_API_BASE_URL}/credits`));
    }),

    vscode.commands.registerCommand('bna.deploy', async () => {
      const root = getWorkspaceRoot();
      if (!root) {
        vscode.window.showErrorMessage('Open a workspace folder first.');
        return;
      }

      const hasConvex = await hasConvexProject();
      if (!hasConvex) {
        vscode.window.showErrorMessage(
          'No Convex project found in this workspace.',
        );
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Deploying to Convex...',
          cancellable: false,
        },
        async () => {
          const result = await terminalManager.convexDeploy();
          if (result.exitCode === 0) {
            vscode.window.showInformationMessage(
              'Deployed to Convex successfully!',
            );
          } else {
            vscode.window.showErrorMessage(
              'Deploy failed. Check the terminal for details.',
            );
          }
        },
      );
    }),
  );

  // ── Terminal cleanup ──────────────────────────────────────────────────
  context.subscriptions.push(terminalManager.registerTerminalCloseHandler());

  // ── Status bar ────────────────────────────────────────────────────────
  creditsManager.updateStatusBar();

  // ── File watcher ──────────────────────────────────────────────────────
  if (getWorkspaceRoot()) {
    const envWatcher =
      vscode.workspace.createFileSystemWatcher('**/.env.local');
    envWatcher.onDidChange(() =>
      projectManager.loadExistingProject().catch(() => {}),
    );
    envWatcher.onDidCreate(() =>
      projectManager.loadExistingProject().catch(() => {}),
    );
    context.subscriptions.push(envWatcher);
  }

  // ── Disposables ───────────────────────────────────────────────────────
  context.subscriptions.push({
    dispose: () => {
      agent.dispose();
      creditsManager.dispose();
      terminalManager.dispose();
      convexClient.dispose();
      authManager.dispose();
      tokenStore.dispose();
      logger.dispose();
    },
  });

  logger.info('BNA extension activated');

  // ── Initialize auth on startup ────────────────────────────────────────
  initializeOnActivation().catch((err) => {
    logger.error('Initialization error:', err);
  });
}

export function deactivate() {
  logger.info('BNA extension deactivated');
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function initializeOnActivation(): Promise<void> {
  const isAuth = await authManager.initialize();

  if (!isAuth) {
    logger.info('User not authenticated');
    return;
  }

  logger.info('User authenticated');
  await tryLoadConvexConnection();

  const root = getWorkspaceRoot();
  if (root) {
    const existing = await projectManager.loadExistingProject();
    if (existing) {
      logger.info(`Loaded existing Convex project: ${existing.deploymentName}`);
    }
  }

  const credits = await creditsManager.fetchCredits();
  if (credits) {
    creditsManager.setCachedCredits(credits.credits);
  }
}

async function tryLoadConvexConnection(): Promise<void> {
  const hasConn = await tokenStore.hasConvexConnection();
  if (hasConn) {
    logger.info('Convex OAuth connection loaded from storage');
  }
}
