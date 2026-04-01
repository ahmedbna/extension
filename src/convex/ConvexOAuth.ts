import * as vscode from 'vscode';
import { TokenStore } from '../auth/TokenStore';
import { CONVEX_OAUTH_CLIENT_ID, CONVEX_API_BASE, BNA_API_BASE_URL } from '../constants';
import { logger } from '../utils/logger';

/**
 * Manages the Convex OAuth flow for connecting a team.
 * Reuses the same flow as the web app (convexOAuth.ts).
 */
export class ConvexOAuth {
  constructor(private readonly tokenStore: TokenStore) {}

  /**
   * Initiates the Convex OAuth flow to connect a team.
   * Opens the Convex dashboard in the browser for authorization.
   */
  async connectTeam(): Promise<boolean> {
    const redirectUri = `${BNA_API_BASE_URL}/convex/callback`;

    const params = new URLSearchParams({
      client_id: CONVEX_OAUTH_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
    });

    const authUrl = `https://dashboard.convex.dev/oauth/authorize/team?${params.toString()}`;

    // Open browser for OAuth
    const opened = await vscode.env.openExternal(vscode.Uri.parse(authUrl));
    if (!opened) {
      vscode.window.showErrorMessage('Failed to open browser for Convex authorization.');
      return false;
    }

    // We need the user to complete the OAuth flow on the web app,
    // which will store the connection in Convex.
    // The extension picks it up via the Convex query on next operation.
    vscode.window.showInformationMessage(
      'Complete the Convex authorization in your browser, then return here.',
      'Done'
    );

    return true;
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
        }
      );

      if (!createResp.ok) {
        const text = await createResp.text();
        logger.error('Failed to create project:', text);
        return null;
      }

      const createData = await createResp.json() as {
        projectId: number;
        deploymentName: string;
        deploymentUrl: string;
      };

      // List projects to get slug
      const listResp = await fetch(
        `${CONVEX_API_BASE}/teams/${args.teamId}/list_projects`,
        {
          headers: { Authorization: `Bearer ${args.accessToken}` },
        }
      );

      if (!listResp.ok) return null;

      const projects = await listResp.json() as Array<{ id: number; slug: string }>;
      const project = projects.find(p => p.id === createData.projectId);
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
        }
      );

      if (!keyResp.ok) return null;

      const keyData = await keyResp.json() as { deployKey: string };

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
