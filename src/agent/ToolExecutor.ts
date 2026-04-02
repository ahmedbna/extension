// src/agent/ToolExecutor.ts
//
// Executes tool calls from the AI agent on the real file system and terminal.
// This replaces the WebContainer-based ActionRunner from the web app.

import * as vscode from 'vscode';
import { TerminalManager } from '../terminal/TerminalManager';
import { ConvexProjectManager } from '../convex/ConvexProjectManager';
import { logger } from '../utils/logger';
import { DocsProvider } from './Docsprovider';
import { executeEditTool, executeViewTool } from '../tools/FileTools';

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

export class ToolExecutor {
  private previousToolCalls = new Map<string, boolean>();
  private deployErrorCount = 0;
  private static readonly MAX_DEPLOY_ERRORS = 5;

  constructor(
    private readonly terminalManager: TerminalManager,
    private readonly projectManager: ConvexProjectManager,
  ) {}

  async execute(call: ToolCall): Promise<ToolResult> {
    // Deduplicate non-view, non-deploy calls
    if (call.toolName !== 'view' && call.toolName !== 'deploy') {
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
    }

    try {
      const result = await this.dispatchTool(call);
      return { toolCallId: call.toolCallId, result, isError: false };
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

  // ─── View ──────────────────────────────────────────────────────────────

  private async handleView(args: {
    path: string;
    view_range?: [number, number] | null;
  }): Promise<string> {
    return executeViewTool(args.path, args.view_range);
  }

  // ─── Edit ──────────────────────────────────────────────────────────────

  private async handleEdit(args: {
    path: string;
    old: string;
    new: string;
  }): Promise<string> {
    return executeEditTool(args.path, args.old, args.new);
  }

  // ─── Deploy ────────────────────────────────────────────────────────────

  private async handleDeploy(): Promise<string> {
    if (this.deployErrorCount >= ToolExecutor.MAX_DEPLOY_ERRORS) {
      return (
        'Error: Too many consecutive deploy failures. ' +
        'Please fix the underlying issues manually and retry.'
      );
    }

    const result = await this.terminalManager.convexDeploy();

    if (result.exitCode !== 0) {
      this.deployErrorCount++;
      // Return the error output so the agent can fix and retry
      return `Deploy failed (attempt ${this.deployErrorCount}/${ToolExecutor.MAX_DEPLOY_ERRORS}):\n${result.output}`;
    }

    this.deployErrorCount = 0;

    // Offer to start Expo dev server (non-blocking)
    vscode.window
      .showInformationMessage(
        'Convex deployed! Start the dev server?',
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

  // ─── npm install ───────────────────────────────────────────────────────

  private async handleNpmInstall(args: {
    packages: string;
    requiresNativeRebuild?: boolean;
  }): Promise<string> {
    const result = await this.terminalManager.npmInstall(args.packages);

    if (result.exitCode !== 0) {
      throw new Error(`npm install failed:\n${result.output}`);
    }

    let output = result.output;

    if (args.requiresNativeRebuild) {
      output +=
        '\n\n⚠️ Native rebuild required. Run `npx expo run:ios` or `npx expo run:android`.';

      vscode.window
        .showWarningMessage(
          'Native rebuild required after installing native module.',
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

    return output;
  }

  // ─── Documentation lookups ─────────────────────────────────────────────

  private async handleLookupDocs(args: { docs: string[] }): Promise<string> {
    const results: string[] = [];
    for (const topic of args.docs) {
      const content = DocsProvider.lookupDocs(topic);
      results.push(content ?? `No documentation found for: ${topic}`);
    }
    return results.join('\n\n---\n\n');
  }

  private async handleLookupConvexDocs(args: {
    topics: string[];
  }): Promise<string> {
    const results: string[] = [];
    for (const topic of args.topics) {
      const content = DocsProvider.lookupConvexDocs(topic);
      results.push(content ?? `No Convex documentation found for: ${topic}`);
    }
    return results.join('\n\n---\n\n');
  }

  // ─── Environment variables ─────────────────────────────────────────────

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
        `Set these env vars in the Convex dashboard:\n${args.envVarNames.join(', ')}`,
        'Open Dashboard',
      );

      if (choice === 'Open Dashboard') {
        const url = `${dashboardUrl}?var=${args.envVarNames.join('&var=')}`;
        vscode.env.openExternal(vscode.Uri.parse(url));
      }
    } else {
      vscode.window.showInformationMessage(
        `Please set these environment variables in your Convex dashboard: ${args.envVarNames.join(', ')}`,
      );
    }

    return `Please add these environment variables in the Convex dashboard: ${args.envVarNames.join(', ')}. Let me know once they are set.`;
  }

  // ─── Deployment name ───────────────────────────────────────────────────

  private async handleGetDeploymentName(): Promise<string> {
    const info = this.projectManager.getProjectInfo();
    if (!info) {
      throw new Error(
        'No Convex project connected. Use "BNA: Connect Convex" to connect your project.',
      );
    }
    return info.deploymentName;
  }

  // ─── Reset ─────────────────────────────────────────────────────────────

  reset(): void {
    this.previousToolCalls.clear();
    this.deployErrorCount = 0;
  }
}
