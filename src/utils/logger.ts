import * as vscode from 'vscode';

const outputChannel = vscode.window.createOutputChannel('BNA', { log: true });

export const logger = {
  info: (...args: any[]) => {
    const msg = args.map(String).join(' ');
    outputChannel.appendLine(`[INFO] ${msg}`);
  },
  warn: (...args: any[]) => {
    const msg = args.map(String).join(' ');
    outputChannel.appendLine(`[WARN] ${msg}`);
  },
  error: (...args: any[]) => {
    const msg = args.map(String).join(' ');
    outputChannel.appendLine(`[ERROR] ${msg}`);
    console.error('[BNA]', ...args);
  },
  debug: (...args: any[]) => {
    const msg = args.map(String).join(' ');
    outputChannel.appendLine(`[DEBUG] ${msg}`);
  },
  show: () => outputChannel.show(),
  dispose: () => outputChannel.dispose(),
};
