// src/credits/CreditsManager.ts
//
// Manages credit checking, deduction, and status bar display.
// Credits are stored in Convex and deducted via the BNA server API
// after each AI generation completes.

import * as vscode from 'vscode';
import { TokenStore } from '../auth/TokenStore';
import {
  BNA_API_BASE_URL,
  INPUT_TOKENS_PER_CREDIT,
  OUTPUT_TOKENS_PER_CREDIT,
} from '../constants';
import { logger } from '../utils/logger';

export interface CreditsInfo {
  credits: number;
  totalCreditsUsed: number;
  initialized: boolean;
}

export class CreditsManager {
  private _onCreditsChanged = new vscode.EventEmitter<number>();
  readonly onCreditsChanged = this._onCreditsChanged.event;

  private cachedCredits: number | null = null;
  private statusBarItem: vscode.StatusBarItem;

  constructor(private readonly tokenStore: TokenStore) {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.statusBarItem.command = 'bna.viewCredits';
    this.statusBarItem.tooltip = 'BNA Credits';
  }

  async hasConnection(): Promise<boolean> {
    return this.tokenStore.hasConvexConnection();
  }

  // ─── Fetch credits ────────────────────────────────────────────────────

  async fetchCredits(): Promise<CreditsInfo | null> {
    try {
      const token = await this.tokenStore.getConvexAuthToken();
      if (!token) return null;

      const response = await fetch(`${BNA_API_BASE_URL}/api/credits`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const data = (await response.json()) as CreditsInfo;
        this.cachedCredits = data.credits;
        this.updateStatusBar();
        return data;
      }

      // Fallback
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

  // ─── Report usage & deduct ────────────────────────────────────────────

  /**
   * Report token usage to the BNA server for credit deduction.
   * Calls the deductCreditsForTokensPublic Convex mutation via the API.
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
      const token = await this.tokenStore.getConvexAuthToken();
      if (!token) return null;

      const response = await fetch(
        `${BNA_API_BASE_URL}/api/extension-deduct-credits`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            userId: args.userId,
            chatId: args.chatId,
            promptTokens: args.promptTokens,
            completionTokens: args.completionTokens,
            basePromptTokens: args.basePromptTokens,
            cacheCreationTokens: args.cacheCreationTokens,
            cacheReadTokens: args.cacheReadTokens,
          }),
        },
      );

      if (!response.ok) {
        const text = await response.text();
        logger.error('Credit deduction API error:', text);

        // Try the legacy endpoint as fallback
        return this.reportUsageLegacy(args);
      }

      const result = (await response.json()) as {
        creditsDeducted: number;
        remainingCredits: number;
      };

      this.cachedCredits = result.remainingCredits;
      this.updateStatusBar();
      this._onCreditsChanged.fire(result.remainingCredits);

      return result;
    } catch (err) {
      logger.error('Error reporting usage:', String(err));
      return this.reportUsageLegacy(args);
    }
  }

  /**
   * Legacy fallback — calls the simpler deduct-credits endpoint.
   */
  private async reportUsageLegacy(args: {
    userId: string;
    chatId: string;
    promptTokens: number;
    completionTokens: number;
  }): Promise<{ creditsDeducted: number; remainingCredits: number } | null> {
    try {
      const token = await this.tokenStore.getConvexAuthToken();

      const response = await fetch(`${BNA_API_BASE_URL}/api/deduct-credits`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          userId: args.userId,
          tokensUsed: args.promptTokens + args.completionTokens,
          chatInitialId: args.chatId,
        }),
      });

      if (!response.ok) {
        logger.error('Legacy credit deduction failed:', await response.text());
        return null;
      }

      const result = (await response.json()) as {
        creditsDeducted: number;
        remainingCredits: number;
      };

      this.cachedCredits = result.remainingCredits;
      this.updateStatusBar();
      this._onCreditsChanged.fire(result.remainingCredits);
      return result;
    } catch (err) {
      logger.error('Legacy credit report failed:', String(err));
      return null;
    }
  }

  // ─── Status bar ───────────────────────────────────────────────────────

  updateStatusBar(credits?: number) {
    const c = credits ?? this.cachedCredits;
    if (c !== null && c !== undefined) {
      this.statusBarItem.text = `$(zap) ${c} credits`;
      if (c <= 0) {
        this.statusBarItem.backgroundColor = new vscode.ThemeColor(
          'statusBarItem.errorBackground',
        );
      } else if (c <= 10) {
        this.statusBarItem.backgroundColor = new vscode.ThemeColor(
          'statusBarItem.warningBackground',
        );
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

  calculateCreditsToDeduct(
    promptTokens: number,
    completionTokens: number,
  ): number {
    const inputCredits = promptTokens / INPUT_TOKENS_PER_CREDIT;
    const outputCredits = completionTokens / OUTPUT_TOKENS_PER_CREDIT;
    return Math.ceil(inputCredits + outputCredits);
  }

  dispose() {
    this.statusBarItem.dispose();
    this._onCreditsChanged.dispose();
  }
}
