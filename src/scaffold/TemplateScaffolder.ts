import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import { TokenStore } from '../auth/TokenStore';
import { ConvexProjectManager } from '../convex/ConvexProjectManager';
import { logger } from '../utils/logger';
import { copyTemplate } from '../utils/copyTemplate';

const execAsync = promisify(exec);

export class TemplateScaffolder {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly tokenStore: TokenStore,
    private readonly projectManager: ConvexProjectManager,
  ) {}

  async scaffold(): Promise<void> {
    // ── Step 1: Project name ─────────────────────────────
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

    // ── Step 2: Description (optional now) ───────────────
    const description = await vscode.window.showInputBox({
      prompt: 'Describe your app (optional)',
      placeHolder: 'Used later by AI features',
      value: '',
    });
    if (description === undefined) return;

    // ── Step 3: Choose directory ─────────────────────────
    const uris = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectMany: false,
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

    // Prevent overwrite
    try {
      await fs.access(projectDir);
      vscode.window.showErrorMessage(`Directory already exists: ${projectDir}`);
      return;
    } catch {}

    // ── Step 4: Scaffold ────────────────────────────────
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Creating "${projectName}"`,
        cancellable: false,
      },
      async (progress) => {
        try {
          // ✅ STEP 4A — COPY TEMPLATE
          progress.report({ message: 'Copying base template...' });

          await copyTemplate(this.context, 'expo-convex', projectDir);

          // ✅ STEP 4B — PERSONALIZE TEMPLATE
          progress.report({ message: 'Configuring project...' });

          await this.personalizeTemplate(projectDir, projectName, slug);

          // ✅ STEP 4C — INSTALL DEPS
          progress.report({
            message: 'Installing dependencies (this may take a minute)...',
          });

          await this.installDeps(projectDir);

          // ✅ STEP 4D — CONVEX SETUP
          const hasConvex = await this.tokenStore.hasConvexConnection();
          if (hasConvex) {
            progress.report({ message: 'Setting up Convex...' });
            await this.projectManager.initializeProject(projectName);
          }

          // ✅ STEP 4E — OPEN PROJECT
          progress.report({ message: 'Opening project...' });

          await vscode.commands.executeCommand(
            'vscode.openFolder',
            vscode.Uri.file(projectDir),
          );
        } catch (err: any) {
          logger.error('Scaffold failed:', err);

          vscode.window.showErrorMessage(
            `Failed to create project: ${err.message || err}`,
          );

          await fs
            .rm(projectDir, { recursive: true, force: true })
            .catch(() => {});
        }
      },
    );
  }

  // ─────────────────────────────────────────────────────

  private async personalizeTemplate(
    projectDir: string,
    projectName: string,
    slug: string,
  ) {
    try {
      // Update package.json
      const pkgPath = path.join(projectDir, 'package.json');
      const pkgRaw = await fs.readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(pkgRaw);

      pkg.name = slug;

      await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2));

      // Update app.json (Expo)
      const appJsonPath = path.join(projectDir, 'app.json');

      try {
        const appRaw = await fs.readFile(appJsonPath, 'utf-8');
        const app = JSON.parse(appRaw);

        if (app.expo) {
          app.expo.name = projectName;
          app.expo.slug = slug;
          app.expo.scheme = slug;

          if (app.expo.ios) {
            app.expo.ios.bundleIdentifier = `com.bna.${slug.replace(/-/g, '')}`;
          }

          if (app.expo.android) {
            app.expo.android.package = `com.bna.${slug.replace(/-/g, '')}`;
          }
        }

        await fs.writeFile(appJsonPath, JSON.stringify(app, null, 2));
      } catch {
        // optional
      }
    } catch (err) {
      logger.warn('Template personalization failed:', err);
    }
  }

  private async installDeps(projectDir: string) {
    try {
      await execAsync('npm install --legacy-peer-deps', {
        cwd: projectDir,
        timeout: 180_000,
      });
      logger.info('npm install completed');
    } catch (err: any) {
      logger.warn('npm install failed:', err.message);

      vscode.window.showWarningMessage(
        'Dependency installation failed. Run `npm install` manually.',
      );
    }
  }
}
