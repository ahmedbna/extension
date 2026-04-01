import * as vscode from 'vscode';
import { logger } from '../utils/logger';

/**
 * Watches workspace files for changes.
 * Tracks which files were modified by the user (vs by the AI agent),
 * so the agent can include user modifications in its next prompt.
 */
export class FileWatcher {
  private watcher: vscode.FileSystemWatcher | undefined;
  private modifiedFiles = new Map<string, { originalContent: string; modifiedAt: number }>();
  private agentWrittenFiles = new Set<string>();

  private _onUserFileModified = new vscode.EventEmitter<string>();
  readonly onUserFileModified = this._onUserFileModified.event;

  start(): void {
    if (this.watcher) return;

    this.watcher = vscode.workspace.createFileSystemWatcher(
      '**/*.{ts,tsx,js,jsx,json,css,md}',
      false, // create
      false, // change
      false  // delete
    );

    this.watcher.onDidChange(uri => {
      const path = uri.fsPath;
      // If the agent just wrote this file, ignore it
      if (this.agentWrittenFiles.has(path)) {
        this.agentWrittenFiles.delete(path);
        return;
      }
      this._onUserFileModified.fire(path);
    });

    this.watcher.onDidCreate(uri => {
      if (this.agentWrittenFiles.has(uri.fsPath)) {
        this.agentWrittenFiles.delete(uri.fsPath);
        return;
      }
      this._onUserFileModified.fire(uri.fsPath);
    });

    logger.debug('File watcher started');
  }

  /**
   * Mark a file as being written by the agent (so we don't treat it as a user edit).
   */
  markAgentWrite(filePath: string): void {
    this.agentWrittenFiles.add(filePath);
    // Clear after a short delay in case the FS event is delayed
    setTimeout(() => {
      this.agentWrittenFiles.delete(filePath);
    }, 2000);
  }

  /**
   * Get all files modified by the user since the last reset.
   */
  getModifiedFiles(): Map<string, { originalContent: string; modifiedAt: number }> {
    return new Map(this.modifiedFiles);
  }

  /**
   * Reset the modified files tracking.
   */
  resetModifiedFiles(): void {
    this.modifiedFiles.clear();
  }

  stop(): void {
    this.watcher?.dispose();
    this.watcher = undefined;
  }

  dispose(): void {
    this.stop();
    this._onUserFileModified.dispose();
  }
}
