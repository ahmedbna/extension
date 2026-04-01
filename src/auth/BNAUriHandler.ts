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
 * Handles the vscode://bna.bna-ai/auth-callback URI.
 *
 * VS Code's URI scheme is always:  vscode://<publisher>.<extensionName>/<path>
 * For this extension: vscode://bna.bna-ai/auth-callback
 *
 * The web app redirects to:
 *   vscode://bna.bna-ai/auth-callback?token=XXX&accessToken=YYY&teamSlug=ZZZ...
 *
 * VS Code intercepts this URI and calls handleUri() here.
 */
export class BNAUriHandler implements vscode.UriHandler {
  private pendingCallbacks: Set<AuthCallbackHandler> = new Set();

  handleUri(uri: vscode.Uri): void {
    logger.info(`BNAUriHandler.handleUri called: ${uri.toString()}`);

    // Normalise path — VS Code may include or omit the leading slash
    const path = uri.path.replace(/^\//, '');

    if (path !== 'auth-callback') {
      logger.warn(`BNAUriHandler: unexpected path "${uri.path}", ignoring`);
      return;
    }

    const params = new URLSearchParams(uri.query);
    const token = params.get('token');

    if (!token) {
      logger.error('BNAUriHandler: no token in callback URI');
      vscode.window.showErrorMessage(
        'BNA sign-in failed: no token received. Please try again.',
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
      `BNAUriHandler: auth callback received` +
        ` teamSlug=${payload.teamSlug ?? '(none)'}` +
        ` hasAccessToken=${!!payload.accessToken}`,
    );

    for (const cb of this.pendingCallbacks) {
      try {
        cb(payload);
      } catch (err) {
        logger.error('BNAUriHandler: callback threw:', err);
      }
    }
    this.pendingCallbacks.clear();
  }

  /** Register a one-shot listener that resolves on the next callback. */
  waitForCallback(timeoutMs = 300_000): Promise<AuthCallbackPayload> {
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

  cancelPending(): void {
    this.pendingCallbacks.clear();
  }
}
