import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { getWorkspaceRoot } from '../utils/workspace';
import { logger } from '../utils/logger';
import { EXCLUDED_FILE_PATHS } from '../constants';

// ─── File Tool ────────────────────────────────────────────────────────────────
// Writes a complete file to the real file system

export async function executeFileTool(
  filePath: string,
  content: string
): Promise<void> {
  const root = getWorkspaceRoot();
  if (!root) throw new Error('No workspace open');

  // Normalize the path: remove /home/project prefix if present
  let relativePath = filePath;
  if (relativePath.startsWith('/home/project/')) {
    relativePath = relativePath.slice('/home/project/'.length);
  } else if (relativePath.startsWith('/home/project')) {
    relativePath = relativePath.slice('/home/project'.length);
  }

  // Check excluded paths
  if (EXCLUDED_FILE_PATHS.some(ex => relativePath.includes(ex))) {
    throw new Error(`Cannot modify excluded file: ${relativePath}`);
  }

  const fullPath = path.join(root, relativePath);
  const dir = path.dirname(fullPath);

  // Create directories
  await fs.mkdir(dir, { recursive: true });

  // Write file
  await fs.writeFile(fullPath, content, 'utf-8');
  logger.debug(`File written: ${relativePath}`);

  // Open the file in VS Code editor
  try {
    const doc = await vscode.workspace.openTextDocument(fullPath);
    await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });
  } catch {
    // File might not be a text file
  }
}

// ─── View Tool ────────────────────────────────────────────────────────────────
// Reads file contents or lists directory

export async function executeViewTool(
  filePath: string,
  viewRange?: [number, number] | null
): Promise<string> {
  const root = getWorkspaceRoot();
  if (!root) throw new Error('No workspace open');

  let relativePath = filePath;
  if (relativePath.startsWith('/home/project/')) {
    relativePath = relativePath.slice('/home/project/'.length);
  } else if (relativePath.startsWith('/home/project')) {
    relativePath = relativePath.slice('/home/project'.length);
  }

  const fullPath = path.join(root, relativePath || '.');

  try {
    const stat = await fs.stat(fullPath);

    if (stat.isDirectory()) {
      // List directory
      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      const sorted = entries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

      return `Directory:\n${sorted
        .map(e => `- ${e.name} (${e.isDirectory() ? 'dir' : 'file'})`)
        .join('\n')}`;
    }

    // Read file
    const content = await fs.readFile(fullPath, 'utf-8');
    let lines = content.split('\n').map((line, i) => `${i + 1}: ${line}`);

    if (viewRange && viewRange.length === 2) {
      const [start, end] = viewRange;
      if (start < 1) throw new Error('Invalid range: start must be greater than 0');
      if (end === -1) {
        lines = lines.slice(start - 1);
      } else {
        lines = lines.slice(start - 1, end);
      }
    }

    return lines.join('\n');
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      throw new Error(`File not found: ${relativePath}`);
    }
    throw err;
  }
}

// ─── Edit Tool ────────────────────────────────────────────────────────────────
// Replace a unique string in a file

export async function executeEditTool(
  filePath: string,
  oldText: string,
  newText: string
): Promise<string> {
  const root = getWorkspaceRoot();
  if (!root) throw new Error('No workspace open');

  let relativePath = filePath;
  if (relativePath.startsWith('/home/project/')) {
    relativePath = relativePath.slice('/home/project/'.length);
  } else if (relativePath.startsWith('/home/project')) {
    relativePath = relativePath.slice('/home/project'.length);
  }

  if (EXCLUDED_FILE_PATHS.some(ex => relativePath.includes(ex))) {
    throw new Error(`Cannot modify excluded file: ${relativePath}`);
  }

  if (oldText.length > 1024) {
    throw new Error('Old text must be less than 1024 characters');
  }
  if (newText.length > 1024) {
    throw new Error('New text must be less than 1024 characters');
  }

  const fullPath = path.join(root, relativePath);
  let content = await fs.readFile(fullPath, 'utf-8');

  const matchPos = content.indexOf(oldText);
  if (matchPos === -1) {
    throw new Error(`Old text not found in ${relativePath}`);
  }

  const secondMatch = content.indexOf(oldText, matchPos + oldText.length);
  if (secondMatch !== -1) {
    throw new Error(`Old text found multiple times in ${relativePath}`);
  }

  content = content.replace(oldText, newText);
  await fs.writeFile(fullPath, content, 'utf-8');

  // Refresh the editor if the file is open
  const uri = vscode.Uri.file(fullPath);
  const openEditor = vscode.window.visibleTextEditors.find(
    e => e.document.uri.fsPath === fullPath
  );
  if (openEditor) {
    // The file watcher will pick up the change, but force a reload
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });
  }

  logger.debug(`File edited: ${relativePath}`);
  return `Successfully edited ${relativePath}`;
}
