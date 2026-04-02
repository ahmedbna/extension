import * as vscode from 'vscode';
import { TerminalManager } from '../terminal/TerminalManager';
import { ConvexProjectManager } from '../convex/ConvexProjectManager';
import { logger } from '../utils/logger';
import { DocsProvider } from './Docsprovider';
import { executeEditTool, executeViewTool } from '../tools/FileTools';

// Matches the ToolInvocation type from the web app
export interface ToolCall {
  toolName: string;
  toolCallId: string;
  args: any;
}

export interface ToolResult {
  toolCallId: string;
  result: string;
  isError: boolean;
}

/**
 * Executes tool calls from the AI agent on the real file system and terminal.
 * This replaces the WebContainer-based ActionRunner from the web app.
 */
export class ToolExecutor {
  private previousToolCalls = new Map<string, boolean>();

  constructor(
    private readonly terminalManager: TerminalManager,
    private readonly projectManager: ConvexProjectManager,
  ) {}

  async execute(call: ToolCall): Promise<ToolResult> {
    const callKey = `${call.toolName}:${JSON.stringify(call.args)}`;
    if (this.previousToolCalls.has(callKey)) {
      return {
        toolCallId: call.toolCallId,
        result:
          'Error: This exact action was already executed. Please try a different approach.',
        isError: true,
      };
    }
    this.previousToolCalls.set(callKey, true);

    try {
      const result = await this.dispatchTool(call);
      return {
        toolCallId: call.toolCallId,
        result,
        isError: false,
      };
    } catch (err: any) {
      const message = err.message || String(err);
      logger.error(`Tool ${call.toolName} failed:`, message);
      return {
        toolCallId: call.toolCallId,
        result: `Error: ${message}`,
        isError: true,
      };
    }
  }

  private async dispatchTool(call: ToolCall): Promise<string> {
    switch (call.toolName) {
      case 'view':
        return this.handleView(call.args);
      case 'edit':
        return this.handleEdit(call.args);
      case 'deploy':
        return this.handleDeploy();
      case 'npmInstall':
        return this.handleNpmInstall(call.args);
      case 'lookupDocs':
        return this.handleLookupDocs(call.args);
      case 'lookupConvexDocsTool':
        return this.handleLookupConvexDocs(call.args);
      case 'addEnvironmentVariables':
        return this.handleAddEnvVars(call.args);
      case 'getConvexDeploymentName':
        return this.handleGetDeploymentName();
      default:
        throw new Error(`Unknown tool: ${call.toolName}`);
    }
  }

  private async handleView(args: {
    path: string;
    view_range?: [number, number] | null;
  }): Promise<string> {
    return executeViewTool(args.path, args.view_range);
  }

  private async handleEdit(args: {
    path: string;
    old: string;
    new: string;
  }): Promise<string> {
    return executeEditTool(args.path, args.old, args.new);
  }

  private async handleDeploy(): Promise<string> {
    const result = await this.terminalManager.convexDeploy();

    if (result.exitCode !== 0) {
      throw new Error(result.output);
    }

    // Prompt user to start Expo dev server
    vscode.window
      .showInformationMessage(
        'Convex functions deployed successfully!',
        'Start iOS',
        'Start Android',
      )
      .then((choice) => {
        if (choice === 'Start iOS') {
          this.terminalManager.startExpoDevServer('ios');
        } else if (choice === 'Start Android') {
          this.terminalManager.startExpoDevServer('android');
        }
      });

    return result.output || 'Deployed successfully.';
  }

  private async handleNpmInstall(args: {
    packages: string;
    requiresNativeRebuild?: boolean;
  }): Promise<string> {
    const result = await this.terminalManager.npmInstall(args.packages);

    if (result.exitCode !== 0) {
      throw new Error(`npm install failed: ${result.output}`);
    }

    if (args.requiresNativeRebuild) {
      vscode.window
        .showWarningMessage(
          'This package requires a native rebuild. Run `npx expo run:ios` or `npx expo run:android`.',
          'Rebuild iOS',
          'Rebuild Android',
        )
        .then((choice) => {
          if (choice === 'Rebuild iOS') {
            this.terminalManager.runInTerminal('Expo', 'npx expo run:ios');
          } else if (choice === 'Rebuild Android') {
            this.terminalManager.runInTerminal('Expo', 'npx expo run:android');
          }
        });
    }

    return result.output;
  }

  /**
   * Returns REAL documentation content from bna-agent docs.
   * Previously this was a stub — now it returns the actual content.
   */
  private async handleLookupDocs(args: { docs: string[] }): Promise<string> {
    const results: string[] = [];

    for (const topic of args.docs) {
      const content = DocsProvider.lookupDocs(topic);
      if (content) {
        results.push(content);
      } else {
        results.push(`No documentation found for: ${topic}`);
      }
    }

    return results.join('\n\n---\n\n');
  }

  /**
   * Returns REAL Convex documentation content.
   * Previously this was a stub — now it returns the actual content.
   */
  private async handleLookupConvexDocs(args: {
    topics: string[];
  }): Promise<string> {
    const results: string[] = [];

    for (const topic of args.topics) {
      const content = DocsProvider.lookupConvexDocs(topic);
      if (content) {
        results.push(content);
      } else {
        results.push(`No Convex documentation found for: ${topic}`);
      }
    }

    return results.join('\n\n---\n\n');
  }

  private async handleAddEnvVars(args: {
    envVarNames: string[];
  }): Promise<string> {
    if (args.envVarNames.length === 0) {
      throw new Error('No environment variable names provided');
    }

    const info = this.projectManager.getProjectInfo();
    if (info) {
      const dashboardUrl = `https://dashboard.convex.dev/d/${info.deploymentName}/settings/environment-variables`;

      const choice = await vscode.window.showInformationMessage(
        `Please add these environment variables in the Convex dashboard:\n${args.envVarNames.join(', ')}`,
        'Open Dashboard',
      );

      if (choice === 'Open Dashboard') {
        const url = `${dashboardUrl}?var=${args.envVarNames.join('&var=')}`;
        vscode.env.openExternal(vscode.Uri.parse(url));
      }
    }

    return `Please add these environment variables: ${args.envVarNames.join(', ')}`;
  }

  private async handleGetDeploymentName(): Promise<string> {
    const info = this.projectManager.getProjectInfo();
    if (!info) {
      throw new Error('No Convex project connected');
    }
    return info.deploymentName;
  }

  reset(): void {
    this.previousToolCalls.clear();
  }
}
