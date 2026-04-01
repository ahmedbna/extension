import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import { TokenStore } from '../auth/TokenStore';
import { ConvexProjectManager } from '../convex/ConvexProjectManager';
import { ScaffoldAgent } from './ScaffoldAgent';
import { logger } from '../utils/logger';

const execAsync = promisify(exec);

/**
 * Scaffolds a new BNA project by having the AI generate all source files
 * from scratch — no template repo required.
 */
export class TemplateScaffolder {
  private scaffoldAgent: ScaffoldAgent;

  constructor(
    private readonly tokenStore: TokenStore,
    private readonly projectManager: ConvexProjectManager,
  ) {
    this.scaffoldAgent = new ScaffoldAgent(tokenStore, projectManager);
  }

  async scaffold(): Promise<void> {
    // ── Step 1: Project name ────────────────────────────────────────────────
    const projectName = await vscode.window.showInputBox({
      prompt: 'What would you like to name your app?',
      value: 'my-bna-app',
      validateInput: (value) => {
        if (!value.trim()) return 'Name is required';
        if (!/^[a-zA-Z0-9-_ ]+$/.test(value)) {
          return 'Use only letters, numbers, spaces, hyphens, and underscores';
        }
        return null;
      },
    });
    if (!projectName) return;

    // ── Step 2: App description (guides AI generation) ─────────────────────
    const description = await vscode.window.showInputBox({
      prompt:
        'Briefly describe what your app does (helps the AI generate better code)',
      placeHolder:
        'e.g. A fitness tracker that lets users log workouts and track progress',
      value: '',
    });
    if (description === undefined) return; // user pressed Escape

    // ── Step 3: Choose parent directory ────────────────────────────────────
    const uris = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      title: 'Choose where to create your project',
      openLabel: 'Create Here',
    });
    if (!uris || uris.length === 0) return;

    const parentDir = uris[0].fsPath;
    const slug = projectName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const projectDir = path.join(parentDir, slug);

    // Guard: don't overwrite an existing directory
    try {
      await fs.access(projectDir);
      vscode.window.showErrorMessage(
        `Directory already exists: ${projectDir}. Please choose a different name or location.`,
      );
      return;
    } catch {
      // Good — directory doesn't exist yet
    }

    // ── Step 4: Run scaffolding ─────────────────────────────────────────────
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Creating "${projectName}"`,
        cancellable: true,
      },
      async (progress, cancellationToken) => {
        cancellationToken.onCancellationRequested(() => {
          this.scaffoldAgent.abort();
        });

        try {
          // 4a. Generate all source files with AI
          progress.report({ message: 'Generating project files with AI...' });

          await this.scaffoldAgent.scaffold(
            projectDir,
            projectName.trim(),
            description.trim(),
            (p) => {
              progress.report({
                message: p.message,
                increment:
                  p.filesWritten > 0
                    ? 100 / Math.max(p.totalEstimated, 1)
                    : undefined,
              });
            },
          );

          // 4b. Install npm dependencies
          progress.report({
            message: 'Installing dependencies (this may take a minute)...',
          });
          await this.installDeps(projectDir);

          // 4c. Set up Convex project (if connected)
          const hasConvexToken = await this.tokenStore.hasConvexConnection();
          if (hasConvexToken) {
            progress.report({ message: 'Creating Convex project...' });
            await this.initConvexProject(projectDir, projectName.trim()).catch(
              (err) => {
                logger.warn(
                  'Convex project creation failed (will retry on first deploy):',
                  err,
                );
              },
            );
          }

          // 4d. Open the project in VS Code
          progress.report({ message: 'Opening project...' });
          await vscode.commands.executeCommand(
            'vscode.openFolder',
            vscode.Uri.file(projectDir),
          );
        } catch (err: any) {
          if (err?.name === 'AbortError') {
            vscode.window.showWarningMessage('Project creation was cancelled.');
            // Clean up partial directory
            await fs
              .rm(projectDir, { recursive: true, force: true })
              .catch(() => {});
            return;
          }

          logger.error('Scaffold failed:', err);
          vscode.window.showErrorMessage(
            `Failed to create project: ${err.message || String(err)}`,
          );
          // Clean up on failure
          await fs
            .rm(projectDir, { recursive: true, force: true })
            .catch(() => {});
        }
      },
    );
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async installDeps(projectDir: string): Promise<void> {
    try {
      await execAsync('npm install --legacy-peer-deps', {
        cwd: projectDir,
        timeout: 180_000, // 3 minutes
      });
      logger.info('npm install completed');
    } catch (err: any) {
      // Non-fatal — warn and let the user run it manually
      logger.warn('npm install had issues:', err.message);
      vscode.window.showWarningMessage(
        'Dependency installation had issues. Run `npm install` in the project directory.',
      );
    }
  }

  private async initConvexProject(
    projectDir: string,
    projectName: string,
  ): Promise<void> {
    // Only initialise if we opened this folder as the workspace root
    // (projectManager needs getWorkspaceRoot() to write .env.local)
    const info = await this.projectManager.initializeProject(projectName);
    if (info) {
      logger.info(
        `Convex project created: ${info.projectSlug} (${info.deploymentName})`,
      );
    }
  }
}
