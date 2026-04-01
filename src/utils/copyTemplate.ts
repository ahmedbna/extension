import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Recursively copies a directory
 */
async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });

  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Copies bundled template into user directory
 */
export async function copyTemplate(
  context: vscode.ExtensionContext,
  templateName: string,
  targetDir: string,
): Promise<void> {
  const templateUri = vscode.Uri.joinPath(
    context.extensionUri,
    'templates',
    templateName,
  );

  const templatePath = templateUri.fsPath;

  try {
    await copyDir(templatePath, targetDir);
  } catch (err: any) {
    throw new Error(
      `Failed to copy template "${templateName}": ${err.message}`,
    );
  }
}
