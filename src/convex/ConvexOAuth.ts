import * as vscode from 'vscode';
import { TokenStore } from '../auth/TokenStore';
import { BNAUriHandler } from '../auth/BNAUriHandler';
import {
  CONVEX_OAUTH_CLIENT_ID,
  CONVEX_API_BASE,
  BNA_API_BASE_URL,
} from '../constants';
import { logger } from '../utils/logger';

/**
 * Manages the Convex OAuth flow for connecting a team to the VS Code extension.
 *
 * Fixed flow:
 *   1. Extension generates a session_id and opens the Convex OAuth URL with:
 *      - redirect_uri  = https://ai.ahmedbna.com/vscode-convex-callback
 *      - state         = "<session_id>|vscode://bna.bna-ai/auth-callback"
 *   2. User authorizes on Convex dashboard
 *   3. Convex redirects to /vscode-convex-callback with ?code=XXX&state=...
 *   4. That page exchanges the code, stores the payload in vscodeAuthSessions,
 *      and deep-links back to VS Code with vscode://bna.bna-ai/auth-callback?...
 *   5. Extension's BNAUriHandler receives the deep-link OR the polling fallback
 *      (/api/vscode-auth?session_id=XXX) delivers the payload.
 */
export class ConvexOAuth {
  constructor(
    private readonly tokenStore: TokenStore,
    private readonly uriHandler: BNAUriHandler,
  ) {}

  /**
   * Initiates the Convex OAuth flow to connect a team.
   * Returns true when the connection was successfully stored in the TokenStore.
   */
  async connectTeam(): Promise<boolean> {
    const sessionId = crypto.randomUUID();
    const vsCodeRedirect = 'vscode://bna.bna-ai/auth-callback';

    // state encodes both the session_id and where to redirect after the callback
    const state = `${sessionId}|${vsCodeRedirect}`;

    // The redirect_uri must be pre-registered with the OAuth app on the web server
    const redirectUri = `${BNA_API_BASE_URL}/vscode-convex-callback`;

    const params = new URLSearchParams({
      client_id: CONVEX_OAUTH_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      state,
    });

    const authUrl = `https://dashboard.convex.dev/oauth/authorize/team?${params.toString()}`;

    logger.info(`Opening Convex OAuth URL: ${authUrl}`);

    const opened = await vscode.env.openExternal(vscode.Uri.parse(authUrl));
    if (!opened) {
      vscode.window.showErrorMessage(
        'Failed to open browser for Convex authorization.',
      );
      return false;
    }

    // Race: deep-link callback vs polling (same infrastructure used by sign-in)
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title:
          'Waiting for Convex authorization… Complete it in your browser then return here.',
        cancellable: true,
      },
      async (_progress, cancellationToken) => {
        cancellationToken.onCancellationRequested(() => {
          this.uriHandler.cancelPending();
        });

        return Promise.race([
          // Deep-link: vscode://bna.bna-ai/auth-callback?convexOnly=true&accessToken=...
          this.uriHandler.waitForCallback(300_000),
          // Polling fallback (SSH / WSL / Linux where deep-links don't work)
          this.pollForConvexToken(sessionId, 300_000),
        ]);
      },
    );

    if (!result) {
      vscode.window.showErrorMessage(
        'Convex authorization timed out or was cancelled.',
      );
      return false;
    }

    // The callback payload uses "convexOnly=true" to distinguish this flow
    // from a full sign-in. We only update the Convex connection tokens.
    if (!result.accessToken) {
      vscode.window.showErrorMessage(
        'No Convex access token received. Please try again.',
      );
      return false;
    }

    await this.tokenStore.storeOAuthConnection({
      accessToken: result.accessToken,
      teamSlug: result.teamSlug ?? '',
      teamName: result.teamName ?? result.teamSlug ?? '',
      teamId: result.teamId ?? '',
      memberId: result.memberId ?? '',
    });

    vscode.window.showInformationMessage(
      `Convex connected${result.teamSlug ? `: ${result.teamSlug}` : ''}!`,
    );
    logger.info(
      `Convex OAuth connected — teamSlug: ${result.teamSlug ?? '(unknown)'}`,
    );
    return true;
  }

  /**
   * Poll /api/vscode-auth?session_id=XXX for the Convex token.
   * The web app stores the payload there after the OAuth callback.
   * This is the same polling endpoint used by the sign-in flow.
   */
  private async pollForConvexToken(
    sessionId: string,
    timeoutMs = 300_000,
  ): Promise<{
    accessToken?: string;
    teamSlug?: string;
    [key: string]: any;
  } | null> {
    const url = `${BNA_API_BASE_URL}/api/vscode-auth?session_id=${encodeURIComponent(sessionId)}`;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const res = await fetch(url);
        if (res.ok) {
          const data = (await res.json()) as any;
          // The Convex-only payload has convexOnly=true and accessToken
          if (data?.accessToken && data?.convexOnly === 'true') {
            logger.info(
              'pollForConvexToken: received Convex OAuth token via polling',
            );
            return data;
          }
        }
      } catch (err) {
        logger.debug('Convex token poll attempt failed:', String(err));
      }
    }

    return null;
  }

  /**
   * Fetch token details from Convex API.
   */
  async getTokenDetails(accessToken: string): Promise<{
    type: string;
    teamId: number;
    name: string;
  } | null> {
    try {
      const response = await fetch(`${CONVEX_API_BASE}/token_details`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        logger.error('Failed to fetch token details:', response.statusText);
        return null;
      }

      return response.json() as any;
    } catch (err) {
      logger.error('Error fetching token details:', String(err));
      return null;
    }
  }

  /**
   * Create a new Convex project for a chat.
   */
  async createProject(args: {
    accessToken: string;
    teamId: number;
    projectName: string;
  }): Promise<{
    projectSlug: string;
    deploymentName: string;
    deploymentUrl: string;
    deployKey: string;
  } | null> {
    try {
      // Create project
      const createResp = await fetch(
        `${CONVEX_API_BASE}/teams/${args.teamId}/create_project`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${args.accessToken}`,
          },
          body: JSON.stringify({
            projectName: args.projectName,
            deploymentType: 'dev',
          }),
        },
      );

      if (!createResp.ok) {
        const text = await createResp.text();
        logger.error('Failed to create project:', text);
        return null;
      }

      const createData = (await createResp.json()) as {
        projectId: number;
        deploymentName: string;
        deploymentUrl: string;
      };

      // List projects to get slug
      const listResp = await fetch(
        `${CONVEX_API_BASE}/teams/${args.teamId}/list_projects`,
        {
          headers: { Authorization: `Bearer ${args.accessToken}` },
        },
      );

      if (!listResp.ok) return null;

      const projects = (await listResp.json()) as Array<{
        id: number;
        slug: string;
      }>;
      const project = projects.find((p) => p.id === createData.projectId);
      if (!project) return null;

      // Create deploy key
      const keyResp = await fetch(
        `${CONVEX_API_BASE}/deployments/${createData.deploymentName}/create_deploy_key`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${args.accessToken}`,
          },
          body: JSON.stringify({ name: 'BNA Deploy Key' }),
        },
      );

      if (!keyResp.ok) return null;

      const keyData = (await keyResp.json()) as { deployKey: string };

      return {
        projectSlug: project.slug,
        deploymentName: createData.deploymentName,
        deploymentUrl: createData.deploymentUrl,
        deployKey: keyData.deployKey,
      };
    } catch (err) {
      logger.error('Error creating project:', String(err));
      return null;
    }
  }
}
