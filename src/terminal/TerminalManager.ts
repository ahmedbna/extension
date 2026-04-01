import * as vscode from 'vscode';
import { logger } from '../utils/logger';
import { getWorkspaceRoot } from '../utils/workspace';

/**
 * Manages VS Code integrated terminals for BNA operations.
 * Replaces the WebContainer terminal from the web app.
 */
export class TerminalManager {
  private terminals: Map<string, vscode.Terminal> = new Map();
  private outputBuffers: Map<string, string> = new Map();

  /**
   * Get or create a named terminal.
   */
  getTerminal(name: string): vscode.Terminal {
    const existing = this.terminals.get(name);
    if (existing && !this.isTerminalClosed(existing)) {
      return existing;
    }

    const root = getWorkspaceRoot();
    const terminal = vscode.window.createTerminal({
      name: `BNA: ${name}`,
      cwd: root,
      iconPath: new vscode.ThemeIcon('zap'),
    });

    this.terminals.set(name, terminal);
    return terminal;
  }

  /**
   * Execute a command in a terminal and capture output.
   * Uses a temporary file to capture exit code since VS Code terminals
   * don't provide direct output access.
   */
  async executeCommand(
    terminalName: string,
    command: string,
    options?: {
      show?: boolean;
      cwd?: string;
    }
  ): Promise<{ exitCode: number; output: string }> {
    const root = options?.cwd || getWorkspaceRoot();

    return new Promise<{ exitCode: number; output: string }>((resolve, reject) => {
      // Use child_process for commands where we need output capture
      const { exec } = require('child_process');
      
      let output = '';
      const child = exec(command, {
        cwd: root,
        maxBuffer: 1024 * 1024 * 10, // 10MB
        env: {
          ...process.env,
          // Ensure we use the project's node_modules
          PATH: `${root}/node_modules/.bin:${process.env.PATH}`,
        },
      });

      child.stdout?.on('data', (data: string) => {
        output += data;
      });

      child.stderr?.on('data', (data: string) => {
        output += data;
      });

      child.on('close', (code: number | null) => {
        resolve({
          exitCode: code ?? 1,
          output,
        });
      });

      child.on('error', (err: Error) => {
        reject(err);
      });

      // Show terminal output in VS Code
      if (options?.show) {
        const terminal = this.getTerminal(terminalName);
        terminal.show();
        terminal.sendText(command);
      }
    });
  }

  /**
   * Run a command in a visible terminal (fire-and-forget, user can see output).
   */
  runInTerminal(terminalName: string, command: string): void {
    const terminal = this.getTerminal(terminalName);
    terminal.show();
    terminal.sendText(command);
  }

  /**
   * Run npm install with output capture.
   */
  async npmInstall(packages: string): Promise<{ exitCode: number; output: string }> {
    const command = `npx expo install ${packages}`;
    logger.info(`Running: ${command}`);
    return this.executeCommand('npm', command, { show: true });
  }

  /**
   * Run convex codegen + typecheck + deploy.
   */
  async convexDeploy(): Promise<{ exitCode: number; output: string }> {
    logger.info('Running Convex deploy...');

    // Step 1: Codegen
    const codegen = await this.executeCommand('deploy', 'npx convex codegen');
    if (codegen.exitCode !== 0) {
      return { exitCode: codegen.exitCode, output: `[ConvexTypecheck] ${codegen.output}` };
    }

    // Step 2: TypeScript check
    const tsc = await this.executeCommand('deploy', 'npx tsc --noEmit');
    if (tsc.exitCode !== 0) {
      return { exitCode: tsc.exitCode, output: `[FrontendTypecheck] ${tsc.output}` };
    }

    // Step 3: Deploy
    const deploy = await this.executeCommand('deploy', 'npx convex dev --once --typecheck=disable');
    if (deploy.exitCode !== 0) {
      return { exitCode: deploy.exitCode, output: `[ConvexDeploy] ${deploy.output}` };
    }

    const totalOutput = [codegen.output, tsc.output, deploy.output].filter(Boolean).join('\n');
    return { exitCode: 0, output: totalOutput };
  }

  /**
   * Start Expo dev server.
   */
  startExpoDevServer(platform: 'ios' | 'android' = 'ios'): void {
    const terminal = this.getTerminal('Expo');
    terminal.show();
    terminal.sendText(`npx expo run:${platform}`);
  }

  private isTerminalClosed(terminal: vscode.Terminal): boolean {
    // VS Code doesn't have a direct API to check if a terminal is closed.
    // We rely on the onDidCloseTerminal event to clean up.
    return terminal.exitStatus !== undefined;
  }

  /**
   * Register cleanup when terminals close.
   */
  registerTerminalCloseHandler(): vscode.Disposable {
    return vscode.window.onDidCloseTerminal(terminal => {
      for (const [name, t] of this.terminals.entries()) {
        if (t === terminal) {
          this.terminals.delete(name);
          this.outputBuffers.delete(name);
          break;
        }
      }
    });
  }

  dispose() {
    for (const terminal of this.terminals.values()) {
      terminal.dispose();
    }
    this.terminals.clear();
    this.outputBuffers.clear();
  }
}
