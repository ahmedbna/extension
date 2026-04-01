import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { TokenStore } from '../auth/TokenStore';
import { ConvexOAuth } from './ConvexOAuth';
import { logger } from '../utils/logger';
import { getWorkspaceRoot, writeWorkspaceFile, readWorkspaceFile } from '../utils/workspace';

export interface ConvexProjectInfo {
  projectSlug: string;
  teamSlug: string;
  deploymentName: string;
  deploymentUrl: string;
  deployKey: string;
}

/**
 * Manages Convex project lifecycle:
 * - Creating new projects
 * - Connecting existing projects
 * - Managing .env.local with deploy keys
 */
export class ConvexProjectManager {
  private projectInfo: ConvexProjectInfo | null = null;

  constructor(
    private readonly tokenStore: TokenStore,
    private readonly oauth: ConvexOAuth
  ) {}

  getProjectInfo(): ConvexProjectInfo | null {
    return this.projectInfo;
  }

  /**
   * Initialize or connect a Convex project for the current workspace.
   */
  async initializeProject(projectName?: string): Promise<ConvexProjectInfo | null> {
    const accessToken = await this.tokenStore.getConvexAccessToken();
    if (!accessToken) {
      vscode.window.showErrorMessage('Please connect your Convex account first.');
      return null;
    }

    const tokenDetails = await this.oauth.getTokenDetails(accessToken);
    if (!tokenDetails) {
      vscode.window.showErrorMessage('Failed to get Convex token details. Try reconnecting.');
      return null;
    }

    const teamSlug = await this.tokenStore.getTeamSlug();
    const name = projectName || 'BNA App';

    const result = await this.oauth.createProject({
      accessToken,
      teamId: tokenDetails.teamId,
      projectName: name,
    });

    if (!result) {
      vscode.window.showErrorMessage('Failed to create Convex project.');
      return null;
    }

    this.projectInfo = {
      ...result,
      teamSlug: teamSlug || 'unknown',
    };

    // Write .env.local
    await this.writeEnvFile(this.projectInfo);

    logger.info(`Convex project created: ${result.projectSlug} (${result.deploymentName})`);
    return this.projectInfo;
  }

  /**
   * Load project info from .env.local if it exists.
   */
  async loadExistingProject(): Promise<ConvexProjectInfo | null> {
    try {
      const envContent = await readWorkspaceFile('.env.local');
      const lines = envContent.split('\n');

      let deployKey = '';
      let deploymentUrl = '';
      let deploymentName = '';

      for (const line of lines) {
        if (line.startsWith('CONVEX_DEPLOY_KEY=')) {
          deployKey = line.split('=')[1].trim();
        }
        if (line.startsWith('EXPO_PUBLIC_CONVEX_URL=')) {
          deploymentUrl = line.split('=')[1].trim();
        }
        if (line.startsWith('CONVEX_DEPLOYMENT=')) {
          const value = line.split('=')[1].trim();
          // Format: dev:deployment-name # team: slug project: slug
          const match = value.match(/^dev:(\S+)/);
          if (match) {
            deploymentName = match[1];
          }
        }
      }

      if (deployKey && deploymentUrl) {
        this.projectInfo = {
          projectSlug: 'existing',
          teamSlug: (await this.tokenStore.getTeamSlug()) || 'unknown',
          deploymentName,
          deploymentUrl,
          deployKey,
        };
        return this.projectInfo;
      }
    } catch {
      // .env.local doesn't exist
    }
    return null;
  }

  /**
   * Write Convex environment variables to .env.local
   */
  private async writeEnvFile(info: ConvexProjectInfo): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) return;

    const envPath = path.join(root, '.env.local');
    let content = '';

    try {
      content = await fs.readFile(envPath, 'utf-8');
    } catch {
      // File doesn't exist, start fresh
    }

    const vars: Record<string, string> = {
      CONVEX_DEPLOY_KEY: info.deployKey,
      EXPO_PUBLIC_CONVEX_URL: info.deploymentUrl,
      CONVEX_DEPLOYMENT: `dev:${info.deploymentName} # team: ${info.teamSlug} project: ${info.projectSlug}`,
    };

    const lines = content.split('\n');

    for (const [key, value] of Object.entries(vars)) {
      const existingIdx = lines.findIndex(l => l.startsWith(`${key}=`));
      if (existingIdx >= 0) {
        lines[existingIdx] = `${key}=${value}`;
      } else {
        lines.push(`${key}=${value}`);
      }
    }

    await fs.writeFile(envPath, lines.join('\n').trim() + '\n', 'utf-8');
    logger.info('Updated .env.local with Convex credentials');
  }
}
