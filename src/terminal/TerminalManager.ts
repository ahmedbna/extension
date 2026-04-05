// src/terminal/TerminalManager.ts

import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { logger } from '../utils/logger';
import { getWorkspaceRoot } from '../utils/workspace';

export interface CommandResult {
  exitCode: number;
  output: string;
}

export interface DeployResult {
  exitCode: number;
  output: string;
  typeErrors?: TypeScriptError[];
}

export interface TypeScriptError {
  file: string;
  line: number;
  column: number;
  message: string;
  raw: string;
}

export class TerminalManager {
  private terminals: Map<string, vscode.Terminal> = new Map();

  // ─── Platform Detection ────────────────────────────────────────────────
  isMac(): boolean {
    return os.platform() === 'darwin';
  }

  getExpoRunCommand(): string {
    return this.isMac() ? 'npx expo run:ios' : 'npx expo run:android';
  }

  // ─── Core Command Execution ────────────────────────────────────────────

  async executeCommand(
    terminalName: string,
    command: string,
    options?: { show?: boolean; cwd?: string; timeout?: number },
  ): Promise<CommandResult> {
    const root = options?.cwd || getWorkspaceRoot();

    return new Promise<CommandResult>((resolve, reject) => {
      const { exec } = require('child_process');

      let output = '';
      const child = exec(command, {
        cwd: root,
        maxBuffer: 1024 * 1024 * 20,
        timeout: options?.timeout || 300_000,
        env: {
          ...process.env,
          PATH: `${root}/node_modules/.bin:${process.env.PATH}`,
          CI: 'true',
          FORCE_COLOR: '0',
          NO_COLOR: '1',
        },
      });

      child.stdout?.on('data', (data: string) => {
        output += data;
      });

      child.stderr?.on('data', (data: string) => {
        output += data;
      });

      child.on('close', (code: number | null) => {
        resolve({ exitCode: code ?? 1, output });
      });

      child.on('error', (err: Error) => {
        reject(err);
      });

      if (options?.show) {
        const terminal = this.getTerminal(terminalName);
        terminal.show();
        terminal.sendText(command);
      }
    });
  }

  // ─── TypeScript Error Parsing ──────────────────────────────────────────

  parseTypeScriptErrors(output: string): TypeScriptError[] {
    const errors: TypeScriptError[] = [];
    const lines = output.split('\n');

    for (const line of lines) {
      const match = line.match(
        /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+:\s+.+)$/,
      );
      if (match) {
        errors.push({
          file: match[1].trim(),
          line: parseInt(match[2]),
          column: parseInt(match[3]),
          message: match[4].trim(),
          raw: line.trim(),
        });
      }
    }

    return errors;
  }

  /**
   * Run TypeScript check on a specific file and return errors.
   */
  async checkFileTypeScript(filePath: string): Promise<TypeScriptError[]> {
    const root = getWorkspaceRoot();
    if (!root) return [];

    // Get relative path from workspace root
    const relPath = path.relative(root, filePath);

    const result = await this.executeCommand(
      'ts-check',
      `npx tsc --noEmit --pretty false 2>&1 | grep "${relPath.replace(/\\/g, '/')}"`,
      { timeout: 60_000 },
    );

    return this.parseTypeScriptErrors(result.output);
  }

  /**
   * Run TypeScript check on all project files and return errors.
   */
  async checkAllTypeScript(): Promise<TypeScriptError[]> {
    const result = await this.executeCommand(
      'ts-check',
      'npx tsc --noEmit --pretty false 2>&1',
      { timeout: 120_000 },
    );

    return this.parseTypeScriptErrors(result.output);
  }

  // ─── Template Setup ────────────────────────────────────────────────────

  async setupTemplate(): Promise<{ success: boolean; output: string }> {
    const outputs: string[] = [];

    logger.info('Template setup: running npm install...');
    const install = await this.executeCommand(
      'setup',
      'npm install --legacy-peer-deps',
      { show: true, timeout: 300_000 },
    );
    outputs.push('[npm install]\n' + install.output);
    if (install.exitCode !== 0) {
      return { success: false, output: outputs.join('\n\n') };
    }

    logger.info('Template setup: initializing Convex...');
    const convexInit = await this.executeCommandWithTimeout(
      'npx convex dev',
      30_000,
    );
    outputs.push('[convex init]\n' + convexInit.output);

    logger.info('Template setup: setting up Convex Auth...');
    const authSetup = await this.executeCommand(
      'setup',
      'echo "y\ny\ny\ny\ny" | npx @convex-dev/auth',
      { timeout: 120_000 },
    );
    outputs.push('[convex auth setup]\n' + authSetup.output);

    return {
      success: true,
      output: outputs.join('\n\n'),
    };
  }

  private async executeCommandWithTimeout(
    command: string,
    timeoutMs: number,
  ): Promise<CommandResult> {
    return new Promise((resolve) => {
      const { spawn } = require('child_process');
      const root = getWorkspaceRoot();
      let output = '';

      const child = spawn('sh', ['-c', command], {
        cwd: root,
        env: {
          ...process.env,
          CI: 'true',
          FORCE_COLOR: '0',
          NO_COLOR: '1',
        },
      });

      child.stdout?.on('data', (data: Buffer) => {
        output += data.toString();
      });
      child.stderr?.on('data', (data: Buffer) => {
        output += data.toString();
      });

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        resolve({ exitCode: 0, output });
      }, timeoutMs);

      child.on('close', (code: number | null) => {
        clearTimeout(timer);
        resolve({ exitCode: code ?? 0, output });
      });
    });
  }

  // ─── Smart Deploy ──────────────────────────────────────────────────────

  /**
   * Smart deploy:
   * 1. npx convex dev --once (deploy backend)
   * 2. npx tsc --noEmit (check TypeScript)
   * 3. If errors → return for agent to fix
   * 4. If clean → start Expo dev server
   */
  async smartDeploy(): Promise<DeployResult> {
    logger.info('Smart deploy: starting Convex deploy...');

    const convexResult = await this.executeCommand(
      'deploy',
      'npx convex dev --once --typecheck=disable',
      { timeout: 180_000 },
    );

    if (convexResult.exitCode !== 0) {
      return {
        exitCode: convexResult.exitCode,
        output: `[ConvexDeploy Error]\n${convexResult.output}`,
      };
    }

    logger.info('Smart deploy: running TypeScript check...');
    const tscResult = await this.executeCommand(
      'deploy',
      'npx tsc --noEmit --pretty false 2>&1',
      { timeout: 120_000 },
    );

    const typeErrors = this.parseTypeScriptErrors(tscResult.output);

    if (typeErrors.length > 0 || tscResult.exitCode !== 0) {
      return {
        exitCode: tscResult.exitCode || 1,
        output: `[TypeScript Errors]\n${tscResult.output}`,
        typeErrors,
      };
    }

    // All good — start Expo dev server
    const platform = this.isMac() ? 'ios' : 'android';
    logger.info(`Smart deploy: starting Expo on ${platform}...`);

    vscode.window
      .showInformationMessage(
        `Deployed successfully. Starting Expo on ${platform}...`,
        'Open Terminal',
      )
      .then((choice) => {
        if (choice === 'Open Terminal') {
          this.getTerminal('Expo').show();
        }
      });

    this.startExpoDevServer(platform);

    const totalOutput = [convexResult.output, tscResult.output]
      .filter(Boolean)
      .join('\n');

    return { exitCode: 0, output: totalOutput || 'Deployed successfully.' };
  }

  async convexDeploy(): Promise<CommandResult> {
    logger.info('Running Convex deploy...');

    const codegen = await this.executeCommand('deploy', 'npx convex codegen', {
      timeout: 60_000,
    });
    if (codegen.exitCode !== 0) {
      return {
        exitCode: codegen.exitCode,
        output: `[Codegen]\n${codegen.output}`,
      };
    }

    const deploy = await this.executeCommand(
      'deploy',
      'npx convex dev --once --typecheck=disable',
      { timeout: 180_000 },
    );

    return {
      exitCode: deploy.exitCode,
      output: [codegen.output, deploy.output].filter(Boolean).join('\n'),
    };
  }

  // ─── npm install ───────────────────────────────────────────────────────

  async npmInstall(packages: string): Promise<CommandResult> {
    const command = `npx expo install ${packages}`;
    logger.info(`Running: ${command}`);
    return this.executeCommand('npm', command, {
      show: true,
      timeout: 180_000,
    });
  }

  // ─── Expo Dev Server ───────────────────────────────────────────────────

  startExpoDevServer(platform: 'ios' | 'android' = 'ios'): void {
    const terminal = this.getTerminal('Expo');
    terminal.show();
    terminal.sendText(`npx expo run:${platform}`);
  }

  // ─── Terminal Management ───────────────────────────────────────────────

  getTerminal(name: string): vscode.Terminal {
    const existing = this.terminals.get(name);
    if (existing && existing.exitStatus === undefined) {
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

  runInTerminal(terminalName: string, command: string): void {
    const terminal = this.getTerminal(terminalName);
    terminal.show();
    terminal.sendText(command);
  }

  registerTerminalCloseHandler(): vscode.Disposable {
    return vscode.window.onDidCloseTerminal((terminal) => {
      for (const [name, t] of this.terminals.entries()) {
        if (t === terminal) {
          this.terminals.delete(name);
          break;
        }
      }
    });
  }

  dispose(): void {
    for (const terminal of this.terminals.values()) {
      terminal.dispose();
    }
    this.terminals.clear();
  }
}
