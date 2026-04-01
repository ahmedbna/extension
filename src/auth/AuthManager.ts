import * as vscode from 'vscode';
import { TokenStore } from './TokenStore';
import { BNA_API_BASE_URL } from '../constants';
import { logger } from '../utils/logger';
import * as crypto from 'crypto';

/**
 * Manages authentication for BNA.
 *
 * Flow:
 * 1. Opens BNA web app in browser with a unique session ID
 * 2. User logs in with Google/GitHub on the web app
 * 3. Web app stores the token in vscodeAuthSessions (Convex table)
 * 4. Extension polls /api/vscode-auth?session_id=XXX to retrieve the token
 * 5. Token is stored in VS Code SecretStorage
 *
 * Improvements:
 * - Token refresh support
 * - Validates token on startup
 * - Fires auth state events for UI updates
 * - Graceful handling of expired tokens
 */
export class AuthManager {
  private _onAuthStateChanged = new vscode.EventEmitter<boolean>();
  readonly onAuthStateChanged = this._onAuthStateChanged.event;

  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private isSigningIn = false;

  constructor(private readonly tokenStore: TokenStore) {
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
   * Returns the user info if valid, null if invalid.
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

      // If the validate endpoint doesn't exist (404), try a simple approach:
      // just check if we can decode the JWT and it's not expired
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
    // Check if we have a stored token at all
    const hasToken = await this.tokenStore.hasStoredToken();
    if (!hasToken) {
      logger.info('No stored auth token — user needs to sign in');
      this._onAuthStateChanged.fire(false);
      return false;
    }

    // Check if the stored token is still valid
    const isValid = await this.tokenStore.isAuthenticated();
    if (isValid) {
      logger.info('Auth token is valid');
      this._onAuthStateChanged.fire(true);
      this.startTokenRefreshTimer();
      return true;
    }

    // Token is stored but expired — try to refresh
    logger.info('Auth token expired, attempting refresh...');
    const refreshed = await this.tryRefreshToken();
    if (refreshed) {
      logger.info('Token refreshed successfully');
      this._onAuthStateChanged.fire(true);
      this.startTokenRefreshTimer();
      return true;
    }

    // Refresh failed — user needs to sign in again
    logger.info('Token refresh failed — user needs to re-authenticate');
    this._onAuthStateChanged.fire(false);
    return false;
  }

  /**
   * Initiates the sign-in flow.
   * Opens the BNA web app in the user's browser, polls for the auth token.
   */
  async signIn(): Promise<boolean> {
    if (this.isSigningIn) {
      vscode.window.showInformationMessage('Sign-in already in progress...');
      return false;
    }

    this.isSigningIn = true;

    try {
      const sessionId = crypto.randomUUID();

      const loginUrl = `${BNA_API_BASE_URL}/vscode-login?session_id=${encodeURIComponent(sessionId)}`;

      // Open browser
      const opened = await vscode.env.openExternal(vscode.Uri.parse(loginUrl));
      if (!opened) {
        vscode.window.showErrorMessage('Failed to open browser for sign-in.');
        return false;
      }

      // Poll for the token
      const result = await this.pollForToken(sessionId);
      if (!result) {
        vscode.window.showErrorMessage('Sign-in timed out or was cancelled.');
        return false;
      }

      // Store the token
      await this.tokenStore.setConvexAuthToken(result.token);

      // Store user info if provided
      if (result.userId) {
        await this.tokenStore.setUserId(result.userId);
      }

      // Store Convex OAuth connection if provided
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
      return true;
    } catch (err: any) {
      logger.error('Sign-in error:', err);
      vscode.window.showErrorMessage(`Sign-in failed: ${err.message}`);
      return false;
    } finally {
      this.isSigningIn = false;
    }
  }

  /**
   * Poll the BNA API for the vscode auth token.
   */
  private async pollForToken(
    sessionId: string,
    timeoutMs = 180000,
  ): Promise<AuthPollResult | null> {
    const pollUrl = `${BNA_API_BASE_URL}/api/vscode-auth?session_id=${encodeURIComponent(sessionId)}`;
    const startTime = Date.now();
    const pollInterval = 2000;

    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Waiting for sign-in to complete in browser...',
        cancellable: true,
      },
      async (_progress, cancellationToken) => {
        while (Date.now() - startTime < timeoutMs) {
          if (cancellationToken.isCancellationRequested) {
            return null;
          }

          try {
            const response = await fetch(pollUrl);

            if (response.ok) {
              const data = (await response.json()) as AuthPollResult;

              if (data.token) {
                return data;
              }
            } else if (response.status === 404) {
              // Session not found — might not be created yet, keep polling
            } else if (response.status >= 500) {
              logger.warn('Server error during auth poll:', response.status);
            }
          } catch (err) {
            logger.debug('Poll attempt failed:', String(err));
          }

          // Wait before polling again
          await new Promise((resolve) => setTimeout(resolve, pollInterval));
        }

        return null;
      },
    );
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

      // If refresh endpoint doesn't exist (404), that's fine —
      // the user just needs to sign in again
      if (response.status === 404) {
        logger.debug('Token refresh endpoint not available');
      }

      return false;
    } catch (err) {
      logger.debug('Token refresh failed:', String(err));
      return false;
    }
  }

  /**
   * Periodically check token validity and attempt refresh.
   * Checks every 5 minutes.
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
    ); // Every 5 minutes
  }

  private stopTokenRefreshTimer(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /**
   * Ensure user is authenticated. If not, prompt to sign in.
   * Returns true if authenticated (or just signed in), false if user declined.
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

    if (choice === 'Sign In') {
      return this.signIn();
    }

    return false;
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

interface AuthPollResult {
  token: string;
  userId?: string;
  accessToken?: string;
  teamSlug?: string;
  teamName?: string;
  teamId?: string;
  memberId?: string;
}
