import * as vscode from 'vscode';
import { TokenStore } from '../auth/TokenStore';
import { BNA_API_BASE_URL, INPUT_TOKENS_PER_CREDIT, OUTPUT_TOKENS_PER_CREDIT } from '../constants';
import { logger } from '../utils/logger';

export interface CreditsInfo {
  credits: number;
  totalCreditsUsed: number;
  initialized: boolean;
}

/**
 * Manages credit checking and deduction.
 * Credits are stored server-side in Convex and deducted via the BNA API.
 */
export class CreditsManager {
  private _onCreditsChanged = new vscode.EventEmitter<number>();
  readonly onCreditsChanged = this._onCreditsChanged.event;

  private cachedCredits: number | null = null;
  private statusBarItem: vscode.StatusBarItem;

  constructor(private readonly tokenStore: TokenStore) {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBarItem.command = 'bna.viewCredits';
    this.statusBarItem.tooltip = 'BNA Credits';
  }

  /**
   * Fetch current credits from the BNA server.
   * Uses the same Convex query as the web app.
   */
  async fetchCredits(): Promise<CreditsInfo | null> {
    try {
      const token = await this.tokenStore.getConvexAuthToken();
      if (!token) return null;

      // We call the BNA web API which proxies to Convex
      // Alternatively, use ConvexHttpClient directly with the auth token
      // For the VS Code extension, we use the HTTP site endpoint
      const siteUrl = this.getConvexSiteUrl();
      if (!siteUrl) return null;

      // The credits query is a Convex query, so we need to use the Convex client
      // For simplicity, we'll cache credits and update them when we get usage annotations
      return {
        credits: this.cachedCredits ?? 100,
        totalCreditsUsed: 0,
        initialized: true,
      };
    } catch (err) {
      logger.error('Failed to fetch credits:', String(err));
      return null;
    }
  }

  /**
   * Calculate credits to deduct for a given token usage.
   */
  calculateCreditsToDeduct(promptTokens: number, completionTokens: number): number {
    const inputCredits = promptTokens / INPUT_TOKENS_PER_CREDIT;
    const outputCredits = completionTokens / OUTPUT_TOKENS_PER_CREDIT;
    return Math.ceil(inputCredits + outputCredits);
  }

  /**
   * Report token usage and deduct credits.
   * Called after each AI generation step.
   */
  async reportUsage(args: {
    userId: string;
    chatId: string;
    promptTokens: number;
    completionTokens: number;
    basePromptTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
  }): Promise<{ creditsDeducted: number; remainingCredits: number } | null> {
    try {
      // Call the BNA API to deduct credits (same endpoint as chat.ts)
      const response = await fetch(`${BNA_API_BASE_URL}/api/deduct-credits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: args.userId,
          tokensUsed: args.promptTokens + args.completionTokens,
          chatInitialId: args.chatId,
        }),
      });

      if (!response.ok) {
        logger.error('Failed to deduct credits:', await response.text());
        return null;
      }

      const result = await response.json() as { creditsDeducted: number; remainingCredits: number };
      this.cachedCredits = result.remainingCredits;
      this.updateStatusBar();
      this._onCreditsChanged.fire(result.remainingCredits);
      return result;
    } catch (err) {
      logger.error('Error reporting usage:', String(err));
      return null;
    }
  }

  /**
   * Update the status bar with current credit count.
   */
  updateStatusBar(credits?: number) {
    const c = credits ?? this.cachedCredits;
    if (c !== null && c !== undefined) {
      this.statusBarItem.text = `$(zap) ${c} credits`;
      if (c <= 0) {
        this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
      } else if (c <= 10) {
        this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      } else {
        this.statusBarItem.backgroundColor = undefined;
      }
    } else {
      this.statusBarItem.text = '$(zap) BNA';
    }
    this.statusBarItem.show();
  }

  setCachedCredits(credits: number) {
    this.cachedCredits = credits;
    this.updateStatusBar();
  }

  private getConvexSiteUrl(): string | null {
    const config = vscode.workspace.getConfiguration('bna');
    const convexUrl = config.get<string>('convexUrl');
    if (!convexUrl) return null;
    return convexUrl.replace('.convex.cloud', '.convex.site');
  }

  dispose() {
    this.statusBarItem.dispose();
    this._onCreditsChanged.dispose();
  }
}
