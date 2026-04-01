import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';

/**
 * Get the current workspace root folder path.
 * Returns undefined if no workspace is open.
 */
export function getWorkspaceRoot(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return undefined;
  }
  return folders[0].uri.fsPath;
}

/**
 * Ensure a workspace is open. Prompts user to open one if not.
 */
export async function ensureWorkspace(): Promise<string> {
  const root = getWorkspaceRoot();
  if (root) {
    return root;
  }

  const choice = await vscode.window.showInformationMessage(
    'BNA requires an open workspace folder. Would you like to open or create one?',
    'Open Folder',
    'New Folder'
  );

  if (choice === 'Open Folder') {
    const uris = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      title: 'Select Project Folder',
    });
    if (uris && uris.length > 0) {
      await vscode.commands.executeCommand('vscode.openFolder', uris[0]);
    }
  } else if (choice === 'New Folder') {
    const uri = await vscode.window.showSaveDialog({
      title: 'Create New Project Folder',
    });
    if (uri) {
      await fs.mkdir(uri.fsPath, { recursive: true });
      await vscode.commands.executeCommand('vscode.openFolder', uri);
    }
  }

  throw new Error('No workspace open');
}

/**
 * Resolve a relative path against the workspace root.
 */
export function resolveWorkspacePath(relativePath: string): string | undefined {
  const root = getWorkspaceRoot();
  if (!root) return undefined;
  return path.join(root, relativePath);
}

/**
 * Write a file to the workspace, creating directories as needed.
 */
export async function writeWorkspaceFile(relativePath: string, content: string): Promise<void> {
  const root = getWorkspaceRoot();
  if (!root) throw new Error('No workspace open');

  const fullPath = path.join(root, relativePath);
  const dir = path.dirname(fullPath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(fullPath, content, 'utf-8');
}

/**
 * Read a file from the workspace.
 */
export async function readWorkspaceFile(relativePath: string): Promise<string> {
  const root = getWorkspaceRoot();
  if (!root) throw new Error('No workspace open');

  const fullPath = path.join(root, relativePath);
  return fs.readFile(fullPath, 'utf-8');
}

/**
 * Check if a file exists in the workspace.
 */
export async function workspaceFileExists(relativePath: string): Promise<boolean> {
  const root = getWorkspaceRoot();
  if (!root) return false;

  try {
    await fs.access(path.join(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

/**
 * List directory contents in workspace.
 */
export async function listWorkspaceDir(relativePath: string): Promise<{ name: string; isDir: boolean }[]> {
  const root = getWorkspaceRoot();
  if (!root) throw new Error('No workspace open');

  const fullPath = path.join(root, relativePath);
  const entries = await fs.readdir(fullPath, { withFileTypes: true });
  return entries.map(e => ({
    name: e.name,
    isDir: e.isDirectory(),
  }));
}

/**
 * Check if the workspace has a Convex project (convex/ folder).
 */
export async function hasConvexProject(): Promise<boolean> {
  return workspaceFileExists('convex/schema.ts');
}

/**
 * Check if the workspace is an Expo project.
 */
export async function isExpoProject(): Promise<boolean> {
  return workspaceFileExists('app.json');
}
