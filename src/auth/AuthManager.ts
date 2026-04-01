import * as vscode from 'vscode';
import { TokenStore } from './TokenStore';
import { BNA_API_BASE_URL, CONVEX_PROVISION_HOST } from '../constants';
import { logger } from '../utils/logger';
import * as http from 'http';
import * as crypto from 'crypto';

/**
 * Manages authentication for BNA.
 *
 * Auth flow:
 * 1. Opens the BNA web app in the browser with a unique session ID
 * 2. User logs in with Google/GitHub on the web app
 * 3. Web app stores the token in desktopAuthSessions (Convex table)
 * 4. Extension polls /api/desktop-auth?session_id=XXX to retrieve the token
 * 5. Token is stored in VS Code SecretStorage
 *
 * This reuses the existing desktop auth flow from the web app (routes/desktop-login.tsx).
 */
export class AuthManager {
  private _onAuthStateChanged = new vscode.EventEmitter<boolean>();
  readonly onAuthStateChanged = this._onAuthStateChanged.event;

  constructor(private readonly tokenStore: TokenStore) {}

  async isAuthenticated(): Promise<boolean> {
    return this.tokenStore.isAuthenticated();
  }

  /**
   * Initiates the sign-in flow.
   * Opens the BNA web app in the user's browser, polls for the auth token.
   */
  async signIn(): Promise<boolean> {
    const sessionId = crypto.randomUUID();
    const redirectUri = 'bna-desktop://auth-callback'; // Not actually used for polling, but needed by the web route

    const loginUrl = `${BNA_API_BASE_URL}/desktop-login?session_id=${encodeURIComponent(sessionId)}&redirect=${encodeURIComponent(redirectUri)}`;

    // Open browser
    const opened = await vscode.env.openExternal(vscode.Uri.parse(loginUrl));
    if (!opened) {
      vscode.window.showErrorMessage('Failed to open browser for sign-in.');
      return false;
    }

    // Poll for the token
    const token = await this.pollForToken(sessionId);
    if (!token) {
      vscode.window.showErrorMessage('Sign-in timed out or was cancelled.');
      return false;
    }

    // Store the token
    await this.tokenStore.setConvexAuthToken(token);
    this._onAuthStateChanged.fire(true);

    vscode.window.showInformationMessage('Successfully signed in to BNA!');
    logger.info('User signed in successfully');
    return true;
  }

  /**
   * Poll the BNA API for the desktop auth token.
   * The web app stores it after the user completes login.
   */
  private async pollForToken(sessionId: string, timeoutMs = 120000): Promise<string | null> {
    const pollUrl = `${BNA_API_BASE_URL}/api/desktop-auth?session_id=${encodeURIComponent(sessionId)}`;
    const startTime = Date.now();
    const pollInterval = 2000;

    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Waiting for sign-in to complete in browser...',
        cancellable: true,
      },
      async (progress, cancellationToken) => {
        while (Date.now() - startTime < timeoutMs) {
          if (cancellationToken.isCancellationRequested) {
            return null;
          }

          try {
            const response = await fetch(pollUrl);
            if (response.ok) {
              const data = await response.json() as { token?: string | null };
              if (data.token) {
                return data.token;
              }
            }
          } catch (err) {
            logger.debug('Poll attempt failed:', String(err));
          }

          // Wait before polling again
          await new Promise(resolve => setTimeout(resolve, pollInterval));
        }

        return null;
      }
    );
  }

  /**
   * Sign out and clear all stored tokens.
   */
  async signOut(): Promise<void> {
    await this.tokenStore.clearAll();
    this._onAuthStateChanged.fire(false);
    vscode.window.showInformationMessage('Signed out of BNA.');
    logger.info('User signed out');
  }

  dispose() {
    this._onAuthStateChanged.dispose();
  }
}
