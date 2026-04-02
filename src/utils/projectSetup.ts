import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getWorkspaceRoot } from './workspace';
import { logger } from './logger';

const execAsync = promisify(exec);

/**
 * Ensures the workspace has a project ready for the AI to work with.
 * 
 * If package.json exists → assumes project is set up.
 * If not → copies the bundled template AND runs npm install.
 * 
 * This replaces the old `ensureTemplateCopied` which didn't install deps.
 */
export async function ensureProjectReady(): Promise<void> {
  const root = getWorkspaceRoot();
  if (!root) {
    throw new Error('No workspace folder is open. Please open or create a project folder first.');
  }

  const packageJsonPath = path.join(root, 'package.json');

  // If package.json already exists, project is already set up
  try {
    await fs.access(packageJsonPath);

    // Also check if node_modules exists - if not, run npm install
    const nodeModulesPath = path.join(root, 'node_modules');
    try {
      await fs.access(nodeModulesPath);
      return; // Both exist, we're good
    } catch {
      // node_modules missing - need to install
      logger.info('node_modules missing, running npm install...');
      await runNpmInstall(root);
      return;
    }
  } catch {
    // package.json doesn't exist - need to copy template
  }

  // Copy template from the extension's bundled templates
  logger.info('No package.json found, copying template...');

  // Find the extension path - we need to search for the templates directory
  // The extension bundles templates in the 'templates' directory at the extension root
  const extensionPath = findExtensionPath();
  if (!extensionPath) {
    throw new Error(
      'Could not find BNA extension templates. Try using "BNA: New Project from Template" command instead.'
    );
  }

  const templatePath = path.join(extensionPath, 'templates', 'expo-convex');
  
  try {
    await fs.access(templatePath);
  } catch {
    throw new Error(
      'Template files not found in extension. Try using "BNA: New Project from Template" command instead.'
    );
  }

  await copyDir(templatePath, root);
  logger.info('Template copied successfully');

  // Install dependencies
  await runNpmInstall(root);
}

async function runNpmInstall(cwd: string): Promise<void> {
  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Installing dependencies...',
        cancellable: false,
      },
      async () => {
        await execAsync('npm install --legacy-peer-deps', {
          cwd,
          timeout: 300_000, // 5 minutes
          env: {
            ...process.env,
            // Ensure npm uses the right registry
            npm_config_registry: 'https://registry.npmjs.org/',
          },
        });
        logger.info('npm install completed');
      },
    );
  } catch (err: any) {
    logger.warn('npm install failed:', err.message);
    vscode.window.showWarningMessage(
      'Dependency installation failed. You may need to run `npm install` manually in the terminal.',
    );
    // Don't throw - let the AI proceed even if install failed
    // The deploy step will catch missing deps
  }
}

function findExtensionPath(): string | null {
  // Try to find the extension from VS Code's extension API
  const ext = vscode.extensions.getExtension('bna.bna-ai');
  if (ext) {
    return ext.extensionPath;
  }

  // Fallback: try common extension development paths
  // In dev mode, the extension runs from the workspace
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders) {
    for (const folder of workspaceFolders) {
      const templatesPath = path.join(folder.uri.fsPath, 'templates', 'expo-convex');
      try {
        // Synchronous check during initialization is acceptable
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

    // Skip node_modules and .git from template
    if (entry.name === 'node_modules' || entry.name === '.git') continue;

    // Don't overwrite existing files
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
