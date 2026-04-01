// src/utils/template.ts

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';

export async function ensureTemplateCopied(
  extensionUri: vscode.Uri,
): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    throw new Error('Open a folder before starting.');
  }

  const root = folders[0].uri.fsPath;

  const packageJsonPath = path.join(root, 'package.json');

  // ✅ If project already initialized → skip
  try {
    await fs.access(packageJsonPath);
    return;
  } catch {}

  const templateUri = vscode.Uri.joinPath(
    extensionUri,
    'templates',
    'expo-convex',
  );

  const templatePath = templateUri.fsPath;

  await copyDir(templatePath, root);
}

async function copyDir(src: string, dest: string) {
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await fs.mkdir(destPath, { recursive: true });
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}
