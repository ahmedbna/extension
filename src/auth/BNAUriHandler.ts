import * as vscode from 'vscode';
import { logger } from '../utils/logger';

export interface AuthCallbackPayload {
  token: string;
  accessToken?: string;
  teamSlug?: string;
  teamName?: string;
  teamId?: string;
  memberId?: string;
  userId?: string;
}

type AuthCallbackHandler = (payload: AuthCallbackPayload) => void;

/**
 * Handles the bna-vscode://auth-callback URI that the web app redirects to
 * after the user completes authentication.
 *
 * The web app (vscode-login.tsx) redirects to:
 *   bna-vscode://auth-callback?token=XXX&accessToken=YYY&teamSlug=ZZZ&...
 *
 * VS Code intercepts this URI and calls handleUri() here.
 */
export class BNAUriHandler implements vscode.UriHandler {
  private pendingCallbacks: Set<AuthCallbackHandler> = new Set();

  /**
   * Called by VS Code when a bna-vscode:// URI is opened.
   */
  handleUri(uri: vscode.Uri): void {
    logger.info(`BNAUriHandler: received URI: ${uri.toString()}`);

    if (uri.path !== '/auth-callback') {
      logger.warn(`BNAUriHandler: unexpected path: ${uri.path}`);
      return;
    }

    const params = new URLSearchParams(uri.query);

    const token = params.get('token');
    if (!token) {
      logger.error('BNAUriHandler: no token in callback URI');
      vscode.window.showErrorMessage(
        'Sign-in failed: no token received. Please try again.',
      );
      return;
    }

    const payload: AuthCallbackPayload = {
      token,
      accessToken: params.get('accessToken') ?? undefined,
      teamSlug: params.get('teamSlug') ?? undefined,
      teamName: params.get('teamName') ?? undefined,
      teamId: params.get('teamId') ?? undefined,
      memberId: params.get('memberId') ?? undefined,
      userId: params.get('userId') ?? undefined,
    };

    logger.info(
      `BNAUriHandler: auth callback received, teamSlug=${payload.teamSlug}`,
    );

    // Notify all waiting callbacks
    for (const cb of this.pendingCallbacks) {
      try {
        cb(payload);
      } catch (err) {
        logger.error('BNAUriHandler: callback error:', err);
      }
    }
    this.pendingCallbacks.clear();
  }

  /**
   * Wait for the next auth callback.
   * Returns a promise that resolves when the deep link is received,
   * or rejects after the timeout.
   */
  waitForCallback(timeoutMs = 180_000): Promise<AuthCallbackPayload> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCallbacks.delete(handler);
        reject(new Error('Auth callback timed out'));
      }, timeoutMs);

      const handler: AuthCallbackHandler = (payload) => {
        clearTimeout(timer);
        resolve(payload);
      };

      this.pendingCallbacks.add(handler);
    });
  }

  /**
   * Cancel any pending callbacks (e.g. user cancelled sign-in).
   */
  cancelPending(): void {
    this.pendingCallbacks.clear();
  }
}
