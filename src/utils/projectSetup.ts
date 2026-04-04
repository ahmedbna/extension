// src/utils/projectSetup.ts
//
// Ensures the workspace has a project ready for the AI to work with.
// Full setup: copy template → npm install → npx convex dev → npx @convex-dev/auth

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getWorkspaceRoot } from './workspace';
import { logger } from './logger';

const execAsync = promisify(exec);

export async function ensureProjectReady(): Promise<void> {
  const root = getWorkspaceRoot();
  if (!root) {
    throw new Error(
      'No workspace folder is open. Please open or create a project folder first.',
    );
  }

  const packageJsonPath = path.join(root, 'package.json');

  try {
    await fs.access(packageJsonPath);
    // Package.json exists — check node_modules
    const nodeModulesPath = path.join(root, 'node_modules');
    try {
      await fs.access(nodeModulesPath);
      return; // Both exist, we're good
    } catch {
      logger.info('node_modules missing, running npm install...');
      await runNpmInstall(root);
      return;
    }
  } catch {
    // package.json doesn't exist
  }

  // Copy template from the extension's bundled templates
  logger.info('No package.json found, copying template...');

  const extensionPath = findExtensionPath();
  if (!extensionPath) {
    throw new Error(
      'Could not find BNA extension templates. Try using "BNA: New Project from Template" command instead.',
    );
  }

  const templatePath = path.join(extensionPath, 'templates', 'expo-convex');
  try {
    await fs.access(templatePath);
  } catch {
    throw new Error(
      'Template files not found in extension. Try using "BNA: New Project from Template" command instead.',
    );
  }

  await copyDir(templatePath, root);
  logger.info('Template copied successfully');

  // Full setup: install + convex init + auth setup
  await runFullSetup(root);
}

async function runFullSetup(cwd: string): Promise<void> {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Setting up BNA project...',
      cancellable: false,
    },
    async (progress) => {
      // Step 1: npm install
      progress.report({ message: 'Installing dependencies...' });
      await runNpmInstall(cwd);

      // Step 2: npx convex dev (init, run briefly)
      progress.report({ message: 'Initializing Convex...' });
      await runConvexInit(cwd);

      // Step 3: npx @convex-dev/auth -y
      progress.report({ message: 'Setting up Convex Auth...' });
      await runConvexAuth(cwd);

      logger.info('Full project setup complete');
    },
  );
}

async function runNpmInstall(cwd: string): Promise<void> {
  try {
    logger.info('Running npm install...');
    await execAsync('npm install --legacy-peer-deps', {
      cwd,
      timeout: 300_000,
      env: {
        ...process.env,
        npm_config_registry: 'https://registry.npmjs.org/',
      },
    });
    logger.info('npm install completed');
  } catch (err: any) {
    logger.warn('npm install failed:', err.message);
    vscode.window.showWarningMessage(
      'Dependency installation failed. You may need to run `npm install` manually.',
    );
  }
}

async function runConvexInit(cwd: string): Promise<void> {
  return new Promise((resolve) => {
    const { spawn } = require('child_process');

    const child = spawn('npx', ['convex', 'dev'], {
      cwd,
      env: {
        ...process.env,
        CI: 'true',
        FORCE_COLOR: '0',
      },
    });

    // Kill after 30 seconds (enough to initialize)
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      logger.info('Convex init completed (timeout)');
      resolve();
    }, 30_000);

    child.on('close', () => {
      clearTimeout(timer);
      resolve();
    });

    child.on('error', (err: Error) => {
      clearTimeout(timer);
      logger.warn('Convex init error (non-fatal):', err.message);
      resolve();
    });
  });
}

async function runConvexAuth(cwd: string): Promise<void> {
  try {
    logger.info('Running Convex Auth setup...');
    // Pipe yes to accept all prompts
    await execAsync('echo "y\ny\ny\ny\ny" | npx @convex-dev/auth', {
      cwd,
      timeout: 120_000,
      env: { ...process.env, CI: 'true' },
      shell: '/bin/sh',
    });
    logger.info('Convex Auth setup completed');
  } catch (err: any) {
    logger.warn('Convex Auth setup failed (non-fatal):', err.message);
    // Non-fatal — user can run manually
  }
}

function findExtensionPath(): string | null {
  const ext = vscode.extensions.getExtension('bna.bna-ai');
  if (ext) {
    return ext.extensionPath;
  }

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders) {
    for (const folder of workspaceFolders) {
      const templatesPath = path.join(
        folder.uri.fsPath,
        'templates',
        'expo-convex',
      );
      try {
        require('fs').accessSync(templatesPath);
        return folder.uri.fsPath;
      } catch {
        // Not this folder
      }
    }
  }

  return null;
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.name === 'node_modules' || entry.name === '.git') continue;

    try {
      await fs.access(destPath);
      continue; // File exists, skip
    } catch {
      // File doesn't exist, copy it
    }

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}
