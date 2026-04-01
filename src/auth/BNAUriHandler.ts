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
  convexOnly?: string;
}

type AuthCallbackHandler = (payload: AuthCallbackPayload) => void;

/**
 * Handles the vscode://bna.bna-ai/auth-callback URI.
 *
 * This single handler covers two flows:
 *
 *   1. Full sign-in  (vscode-login.tsx)
 *      ?token=BNA_JWT&accessToken=CONVEX_TOKEN&teamSlug=...
 *
 *   2. Convex-only OAuth reconnect  (vscode-convex-callback.tsx)
 *      ?convexOnly=true&accessToken=CONVEX_TOKEN&teamSlug=...&session_id=...
 *      (no BNA JWT — token field will be empty / absent)
 *
 * For case 2 we synthesise a dummy token so the existing AuthCallbackPayload
 * shape is satisfied, but callers that care about convexOnly will check the
 * flag and ignore the token field.
 */
export class BNAUriHandler implements vscode.UriHandler {
  private pendingCallbacks: Set<AuthCallbackHandler> = new Set();

  handleUri(uri: vscode.Uri): void {
    logger.info(`BNAUriHandler.handleUri called: ${uri.toString()}`);

    const path = uri.path.replace(/^\//, '');

    if (path !== 'auth-callback') {
      logger.warn(`BNAUriHandler: unexpected path "${uri.path}", ignoring`);
      return;
    }

    const params = new URLSearchParams(uri.query);
    const token = params.get('token');
    const accessToken = params.get('accessToken') ?? undefined;
    const convexOnly = params.get('convexOnly') ?? undefined;

    // For the Convex-only flow there is no BNA token — that's fine.
    if (!token && convexOnly !== 'true') {
      logger.error(
        'BNAUriHandler: no token in callback URI and not a convexOnly callback',
      );
      vscode.window.showErrorMessage(
        'BNA sign-in failed: no token received. Please try again.',
      );
      return;
    }

    if (convexOnly === 'true' && !accessToken) {
      logger.error('BNAUriHandler: convexOnly callback missing accessToken');
      vscode.window.showErrorMessage(
        'Convex connection failed: no access token received. Please try again.',
      );
      return;
    }

    const payload: AuthCallbackPayload = {
      // Use a sentinel string so the type is satisfied; callers check convexOnly
      token: token ?? '__convex_only__',
      accessToken,
      teamSlug: params.get('teamSlug') ?? undefined,
      teamName: params.get('teamName') ?? undefined,
      teamId: params.get('teamId') ?? undefined,
      memberId: params.get('memberId') ?? undefined,
      userId: params.get('userId') ?? undefined,
      convexOnly,
    };

    logger.info(
      `BNAUriHandler: callback received` +
        ` convexOnly=${convexOnly ?? 'false'}` +
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
