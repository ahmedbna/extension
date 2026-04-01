import * as vscode from 'vscode';
import { TokenStore } from './TokenStore';
import { BNAUriHandler } from './BNAUriHandler';
import { BNA_API_BASE_URL } from '../constants';
import { logger } from '../utils/logger';
import * as crypto from 'crypto';

/**
 * The redirect URI VS Code handles for this extension.
 * Format: vscode://<publisher>.<extensionName>/<path>
 */
const VSCODE_REDIRECT_URI = 'vscode://bna.bna-ai/auth-callback';

export class AuthManager {
  private _onAuthStateChanged = new vscode.EventEmitter<boolean>();
  readonly onAuthStateChanged = this._onAuthStateChanged.event;

  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private isSigningIn = false;

  constructor(
    private readonly tokenStore: TokenStore,
    private readonly uriHandler: BNAUriHandler,
  ) {
    this.tokenStore.onAuthChanged((isAuth) => {
      this._onAuthStateChanged.fire(isAuth);
    });
  }

  async isAuthenticated(): Promise<boolean> {
    return this.tokenStore.isAuthenticated();
  }

  async validateToken(): Promise<{ userId: string; email?: string } | null> {
    const token = await this.tokenStore.getConvexAuthToken();
    if (!token) return null;

    try {
      const response = await fetch(
        `${BNA_API_BASE_URL}/api/vscode-auth/validate`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        },
      );

      if (response.ok) {
        const data = (await response.json()) as {
          userId?: string;
          email?: string;
          valid?: boolean;
        };
        if (data.valid !== false && data.userId) {
          await this.tokenStore.setUserId(data.userId);
          return { userId: data.userId, email: data.email };
        }
      }

      if (response.status === 404) {
        const isValid = await this.tokenStore.isAuthenticated();
        if (isValid) {
          return { userId: (await this.tokenStore.getUserId()) || 'unknown' };
        }
      }
      return null;
    } catch (err) {
      logger.debug('Token validation failed:', String(err));
      const isValid = await this.tokenStore.isAuthenticated();
      return isValid
        ? { userId: (await this.tokenStore.getUserId()) || 'unknown' }
        : null;
    }
  }

  async initialize(): Promise<boolean> {
    const hasToken = await this.tokenStore.hasStoredToken();
    if (!hasToken) {
      this._onAuthStateChanged.fire(false);
      return false;
    }

    const isValid = await this.tokenStore.isAuthenticated();
    if (isValid) {
      this._onAuthStateChanged.fire(true);
      this.startTokenRefreshTimer();
      return true;
    }

    const refreshed = await this.tryRefreshToken();
    if (refreshed) {
      this._onAuthStateChanged.fire(true);
      this.startTokenRefreshTimer();
      return true;
    }

    this._onAuthStateChanged.fire(false);
    return false;
  }

  /**
   * Sign-in flow:
   * 1. Open browser → https://ai.ahmedbna.com/vscode-login?session_id=XXX&redirect=vscode://bna.bna-ai/auth-callback
   * 2. User authenticates on the web app
   * 3. Web app redirects to vscode://bna.bna-ai/auth-callback?token=...
   * 4. VS Code routes the URI to our registered BNAUriHandler
   * 5. BNAUriHandler resolves the waitForCallback() promise
   * 6. Simultaneously poll /api/vscode-auth as fallback (SSH / WSL / Linux)
   */
  async signIn(): Promise<boolean> {
    if (this.isSigningIn) {
      vscode.window.showInformationMessage('Sign-in already in progress...');
      return false;
    }

    this.isSigningIn = true;
    this.uriHandler.cancelPending();

    try {
      const sessionId = crypto.randomUUID();

      const loginUrl =
        `${BNA_API_BASE_URL}/vscode-login` +
        `?session_id=${encodeURIComponent(sessionId)}` +
        `&redirect=${encodeURIComponent(VSCODE_REDIRECT_URI)}`;

      logger.info(`Opening sign-in URL: ${loginUrl}`);

      const opened = await vscode.env.openExternal(vscode.Uri.parse(loginUrl));
      if (!opened) {
        vscode.window.showErrorMessage(
          'Failed to open browser. Please try again.',
        );
        return false;
      }

      // Race deep-link vs polling — whichever arrives first wins
      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title:
            'Waiting for sign-in… Complete it in your browser then return here.',
          cancellable: true,
        },
        async (_progress, cancellationToken) => {
          cancellationToken.onCancellationRequested(() => {
            this.uriHandler.cancelPending();
          });

          return Promise.race([
            this.uriHandler.waitForCallback(300_000),
            this.pollForToken(sessionId, 300_000),
          ]);
        },
      );

      if (!result?.token) {
        vscode.window.showErrorMessage('Sign-in timed out or was cancelled.');
        return false;
      }

      await this.storeAuthResult(result);
      return true;
    } catch (err: any) {
      if (err?.message?.includes('timed out')) {
        vscode.window.showErrorMessage('Sign-in timed out. Please try again.');
      } else {
        logger.error('Sign-in error:', err);
        vscode.window.showErrorMessage(`Sign-in failed: ${err.message}`);
      }
      return false;
    } finally {
      this.isSigningIn = false;
    }
  }

  private async storeAuthResult(result: {
    token: string;
    userId?: string;
    accessToken?: string;
    teamSlug?: string;
    teamName?: string;
    teamId?: string;
    memberId?: string;
  }): Promise<void> {
    await this.tokenStore.setConvexAuthToken(result.token);

    if (result.userId) {
      await this.tokenStore.setUserId(result.userId);
    }

    if (result.accessToken && result.teamSlug) {
      await this.tokenStore.storeOAuthConnection({
        accessToken: result.accessToken,
        teamSlug: result.teamSlug,
        teamName: result.teamName || result.teamSlug,
        teamId: result.teamId || '',
        memberId: result.memberId || '',
      });
    }

    this._onAuthStateChanged.fire(true);
    this.startTokenRefreshTimer();
    vscode.window.showInformationMessage('Successfully signed in to BNA!');
    logger.info('User signed in successfully');
  }

  /**
   * Fallback polling — resolves if the web app stored the token server-side.
   * Used when deep links are unavailable (SSH remote, WSL, some Linux DEs).
   */
  private async pollForToken(
    sessionId: string,
    timeoutMs = 300_000,
  ): Promise<{ token: string; [key: string]: any }> {
    const url = `${BNA_API_BASE_URL}/api/vscode-auth?session_id=${encodeURIComponent(sessionId)}`;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const res = await fetch(url);
        if (res.ok) {
          const data = (await res.json()) as any;
          if (data?.token) {
            logger.info('pollForToken: token received via polling');
            return data;
          }
        }
      } catch (err) {
        logger.debug('Poll attempt failed:', String(err));
      }
    }

    // Never reject — let the deep-link side win; the Progress cancellation
    // handles the user-cancelled case.
    return new Promise(() => {});
  }

  private async tryRefreshToken(): Promise<boolean> {
    try {
      const rawToken = await this.tokenStore.getRawConvexAuthToken();
      if (!rawToken) return false;

      const res = await fetch(`${BNA_API_BASE_URL}/api/vscode-auth/refresh`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${rawToken}` },
      });

      if (res.ok) {
        const data = (await res.json()) as { token?: string };
        if (data.token) {
          await this.tokenStore.setConvexAuthToken(data.token);
          return true;
        }
      }
      return false;
    } catch (err) {
      logger.debug('Token refresh failed:', String(err));
      return false;
    }
  }

  private startTokenRefreshTimer(): void {
    this.stopTokenRefreshTimer();
    this.refreshTimer = setInterval(
      async () => {
        const isValid = await this.tokenStore.isAuthenticated();
        if (!isValid) {
          const refreshed = await this.tryRefreshToken();
          if (!refreshed) {
            this._onAuthStateChanged.fire(false);
            this.stopTokenRefreshTimer();
            vscode.window
              .showWarningMessage('Your BNA session has expired.', 'Sign In')
              .then((c) => {
                if (c === 'Sign In') this.signIn();
              });
          }
        }
      },
      5 * 60 * 1000,
    );
  }

  private stopTokenRefreshTimer(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  async ensureAuthenticated(): Promise<boolean> {
    if (await this.isAuthenticated()) return true;
    const choice = await vscode.window.showInformationMessage(
      'You need to sign in to BNA to continue.',
      'Sign In',
      'Cancel',
    );
    return choice === 'Sign In' ? this.signIn() : false;
  }

  async signOut(): Promise<void> {
    this.stopTokenRefreshTimer();
    await this.tokenStore.clearAll();
    this._onAuthStateChanged.fire(false);
    vscode.window.showInformationMessage('Signed out of BNA.');
  }

  dispose(): void {
    this.stopTokenRefreshTimer();
    this._onAuthStateChanged.dispose();
  }
}
