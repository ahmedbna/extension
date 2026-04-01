import * as vscode from 'vscode';
import { TokenStore } from './TokenStore';
import { BNAUriHandler } from './BNAUriHandler';
import { BNA_API_BASE_URL } from '../constants';
import { logger } from '../utils/logger';
import * as crypto from 'crypto';

/**
 * Manages authentication for BNA.
 *
 * Sign-in flow:
 * 1. Generate a unique session_id
 * 2. Open the BNA web app at /vscode-login?session_id=XXX&redirect=bna-vscode://auth-callback
 * 3. User logs in with Google/GitHub on the web app
 * 4. Web app redirects to bna-vscode://auth-callback?token=XXX&accessToken=YYY&teamSlug=ZZZ...
 * 5. VS Code intercepts the URI via BNAUriHandler and resolves the promise
 * 6. Fallback: simultaneously poll /api/vscode-auth?session_id=XXX (for environments
 *    where deep links may not work, e.g. remote SSH, WSL)
 * 7. Token is stored in VS Code SecretStorage (OS keychain)
 */
export class AuthManager {
  private _onAuthStateChanged = new vscode.EventEmitter<boolean>();
  readonly onAuthStateChanged = this._onAuthStateChanged.event;

  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private isSigningIn = false;

  constructor(
    private readonly tokenStore: TokenStore,
    private readonly uriHandler: BNAUriHandler,
  ) {
    // Forward token store auth events
    this.tokenStore.onAuthChanged((isAuth) => {
      this._onAuthStateChanged.fire(isAuth);
    });
  }

  /**
   * Check if user is authenticated with a valid token.
   */
  async isAuthenticated(): Promise<boolean> {
    return this.tokenStore.isAuthenticated();
  }

  /**
   * Validate the current token against the server.
   * Returns user info if valid, null otherwise.
   */
  async validateToken(): Promise<{ userId: string; email?: string } | null> {
    const token = await this.tokenStore.getConvexAuthToken();
    if (!token) {
      return null;
    }

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

      // 404 → validate endpoint doesn't exist, fall back to local JWT check
      if (response.status === 404) {
        const isValid = await this.tokenStore.isAuthenticated();
        if (isValid) {
          return { userId: (await this.tokenStore.getUserId()) || 'unknown' };
        }
      }

      return null;
    } catch (err) {
      logger.debug('Token validation request failed:', String(err));
      // Network error — fall back to local JWT check
      const isValid = await this.tokenStore.isAuthenticated();
      return isValid
        ? { userId: (await this.tokenStore.getUserId()) || 'unknown' }
        : null;
    }
  }

  /**
   * Initialize auth on extension startup.
   * Validates stored token and attempts refresh if needed.
   */
  async initialize(): Promise<boolean> {
    const hasToken = await this.tokenStore.hasStoredToken();
    if (!hasToken) {
      logger.info('No stored auth token — user needs to sign in');
      this._onAuthStateChanged.fire(false);
      return false;
    }

    const isValid = await this.tokenStore.isAuthenticated();
    if (isValid) {
      logger.info('Auth token is valid');
      this._onAuthStateChanged.fire(true);
      this.startTokenRefreshTimer();
      return true;
    }

    // Token stored but expired — try refresh
    logger.info('Auth token expired, attempting refresh...');
    const refreshed = await this.tryRefreshToken();
    if (refreshed) {
      logger.info('Token refreshed successfully');
      this._onAuthStateChanged.fire(true);
      this.startTokenRefreshTimer();
      return true;
    }

    logger.info('Token refresh failed — user needs to re-authenticate');
    this._onAuthStateChanged.fire(false);
    return false;
  }

  /**
   * Initiates the sign-in flow.
   *
   * Opens the BNA web app in the browser. VS Code intercepts the
   * bna-vscode://auth-callback deep link when the web app redirects back.
   * We also poll as a fallback (for SSH/WSL environments).
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
      const redirectUri = 'bna-vscode://auth-callback';

      const loginUrl =
        `${BNA_API_BASE_URL}/vscode-login` +
        `?session_id=${encodeURIComponent(sessionId)}` +
        `&redirect=${encodeURIComponent(redirectUri)}`;

      logger.info(`Opening sign-in URL: ${loginUrl}`);

      const opened = await vscode.env.openExternal(vscode.Uri.parse(loginUrl));
      if (!opened) {
        vscode.window.showErrorMessage('Failed to open browser for sign-in.');
        return false;
      }

      // Race: deep-link callback vs. polling fallback
      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Waiting for sign-in to complete in browser...',
          cancellable: true,
        },
        async (_progress, cancellationToken) => {
          cancellationToken.onCancellationRequested(() => {
            this.uriHandler.cancelPending();
          });

          return Promise.race([
            // Primary: deep-link from the browser
            this.uriHandler.waitForCallback(180_000),
            // Fallback: polling (for SSH/WSL/remote environments)
            this.pollForToken(sessionId, 180_000),
          ]);
        },
      );

      if (!result || !result.token) {
        vscode.window.showErrorMessage('Sign-in timed out or was cancelled.');
        return false;
      }

      await this.storeAuthResult(result);
      return true;
    } catch (err: any) {
      if (
        err.message?.includes('timed out') ||
        err.message?.includes('cancelled')
      ) {
        vscode.window.showErrorMessage('Sign-in timed out or was cancelled.');
      } else {
        logger.error('Sign-in error:', err);
        vscode.window.showErrorMessage(`Sign-in failed: ${err.message}`);
      }
      return false;
    } finally {
      this.isSigningIn = false;
    }
  }

  /**
   * Store the result of a successful auth (deep link or poll).
   */
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
   * Fallback: poll the BNA API for the token.
   * Used when deep links are unavailable (SSH, WSL, remote).
   */
  private async pollForToken(
    sessionId: string,
    timeoutMs = 180_000,
  ): Promise<
    | {
        token: string;
        userId?: string;
        accessToken?: string;
        teamSlug?: string;
        teamName?: string;
        teamId?: string;
        memberId?: string;
      }
    | never
  > {
    const pollUrl = `${BNA_API_BASE_URL}/api/vscode-auth?session_id=${encodeURIComponent(sessionId)}`;
    const startTime = Date.now();
    const pollInterval = 2000;

    while (Date.now() - startTime < timeoutMs) {
      try {
        const response = await fetch(pollUrl);

        if (response.ok) {
          const data = (await response.json()) as any;
          if (data?.token) {
            logger.info('pollForToken: token received via polling');
            return data;
          }
        } else if (response.status >= 500) {
          logger.warn('Server error during auth poll:', response.status);
        }
      } catch (err) {
        logger.debug('Poll attempt failed:', String(err));
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    // Let the deep-link win the race by never resolving (timeout handled by Promise.race)
    return new Promise(() => {}); // never resolves — let the race timeout naturally
  }

  /**
   * Try to refresh an expired token.
   */
  private async tryRefreshToken(): Promise<boolean> {
    try {
      const rawToken = await this.tokenStore.getRawConvexAuthToken();
      if (!rawToken) {
        return false;
      }

      const response = await fetch(
        `${BNA_API_BASE_URL}/api/vscode-auth/refresh`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${rawToken}`,
          },
        },
      );

      if (response.ok) {
        const data = (await response.json()) as { token?: string };
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

  /**
   * Periodically verify token validity and attempt refresh.
   */
  private startTokenRefreshTimer(): void {
    this.stopTokenRefreshTimer();

    this.refreshTimer = setInterval(
      async () => {
        const isValid = await this.tokenStore.isAuthenticated();
        if (!isValid) {
          logger.info('Token expired during session, attempting refresh...');
          const refreshed = await this.tryRefreshToken();
          if (!refreshed) {
            logger.warn('Token refresh failed — user needs to re-authenticate');
            this._onAuthStateChanged.fire(false);
            this.stopTokenRefreshTimer();

            vscode.window
              .showWarningMessage(
                'Your BNA session has expired. Please sign in again.',
                'Sign In',
              )
              .then((choice) => {
                if (choice === 'Sign In') {
                  this.signIn();
                }
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

  /**
   * Ensure user is authenticated, prompting to sign in if not.
   */
  async ensureAuthenticated(): Promise<boolean> {
    const isAuth = await this.isAuthenticated();
    if (isAuth) {
      return true;
    }

    const choice = await vscode.window.showInformationMessage(
      'You need to sign in to BNA to continue.',
      'Sign In',
      'Cancel',
    );

    return choice === 'Sign In' ? this.signIn() : false;
  }

  /**
   * Sign out and clear all stored tokens.
   */
  async signOut(): Promise<void> {
    this.stopTokenRefreshTimer();
    await this.tokenStore.clearAll();
    this._onAuthStateChanged.fire(false);
    vscode.window.showInformationMessage('Signed out of BNA.');
    logger.info('User signed out');
  }

  dispose(): void {
    this.stopTokenRefreshTimer();
    this._onAuthStateChanged.dispose();
  }
}
