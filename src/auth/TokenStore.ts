import * as vscode from 'vscode';
import { SECRET_KEYS } from '../constants';
import { logger } from '../utils/logger';

// 30 days in milliseconds
const TOKEN_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;
const TOKEN_STORED_AT_KEY = 'bna.tokenStoredAt';

/**
 * Manages secure storage of auth tokens and sensitive data
 * using VS Code's built-in SecretStorage API (backed by the OS keychain).
 * Tokens persist for 30 days.
 */
export class TokenStore {
  private _onAuthChanged = new vscode.EventEmitter<boolean>();
  readonly onAuthChanged = this._onAuthChanged.event;

  constructor(private readonly secrets: vscode.SecretStorage) {}

  // ── Convex Auth Token (user session JWT) ─────────────────────────
  async getConvexAuthToken(): Promise<string | undefined> {
    const token = await this.secrets.get(SECRET_KEYS.CONVEX_AUTH_TOKEN);
    if (!token) {
      return undefined;
    }

    // Check 30-day wall-clock expiry (extension-managed)
    const storedAtStr = await this.secrets.get(TOKEN_STORED_AT_KEY);
    if (storedAtStr) {
      const storedAt = parseInt(storedAtStr, 10);
      if (!isNaN(storedAt) && Date.now() - storedAt > TOKEN_EXPIRY_MS) {
        logger.warn('BNA auth token expired (30-day limit)');
        return undefined;
      }
    }

    // Also check JWT expiry if it's a JWT
    if (this.isJwtExpired(token)) {
      logger.warn('BNA auth JWT is expired');
      return undefined;
    }

    return token;
  }

  /**
   * Get the raw token even if expired (for refresh flows).
   */
  async getRawConvexAuthToken(): Promise<string | undefined> {
    return this.secrets.get(SECRET_KEYS.CONVEX_AUTH_TOKEN);
  }

  async setConvexAuthToken(token: string): Promise<void> {
    await this.secrets.store(SECRET_KEYS.CONVEX_AUTH_TOKEN, token);
    // Record when we stored it so we can enforce 30-day expiry
    await this.secrets.store(TOKEN_STORED_AT_KEY, String(Date.now()));
    logger.info('Stored Convex auth token (30-day expiry)');
    this._onAuthChanged.fire(true);
  }

  // ── Convex OAuth Access Token (team-scoped) ──────────────────────
  async getConvexAccessToken(): Promise<string | undefined> {
    return this.secrets.get(SECRET_KEYS.CONVEX_ACCESS_TOKEN);
  }

  async setConvexAccessToken(token: string): Promise<void> {
    await this.secrets.store(SECRET_KEYS.CONVEX_ACCESS_TOKEN, token);
  }

  // ── Team info ────────────────────────────────────────────────────
  async getTeamSlug(): Promise<string | undefined> {
    return this.secrets.get(SECRET_KEYS.CONVEX_TEAM_SLUG);
  }

  async setTeamSlug(slug: string): Promise<void> {
    await this.secrets.store(SECRET_KEYS.CONVEX_TEAM_SLUG, slug);
  }

  async getTeamName(): Promise<string | undefined> {
    return this.secrets.get(SECRET_KEYS.CONVEX_TEAM_NAME);
  }

  async setTeamName(name: string): Promise<void> {
    await this.secrets.store(SECRET_KEYS.CONVEX_TEAM_NAME, name);
  }

  async getTeamId(): Promise<string | undefined> {
    return this.secrets.get(SECRET_KEYS.CONVEX_TEAM_ID);
  }

  async setTeamId(id: string): Promise<void> {
    await this.secrets.store(SECRET_KEYS.CONVEX_TEAM_ID, id);
  }

  // ── User ID ──────────────────────────────────────────────────────
  async getUserId(): Promise<string | undefined> {
    return this.secrets.get(SECRET_KEYS.USER_ID);
  }

  async setUserId(id: string): Promise<void> {
    await this.secrets.store(SECRET_KEYS.USER_ID, id);
  }

  // ── Bulk operations ──────────────────────────────────────────────
  async storeOAuthConnection(data: {
    accessToken: string;
    teamSlug: string;
    teamName: string;
    teamId: string;
    memberId: string;
  }): Promise<void> {
    await Promise.all([
      this.setConvexAccessToken(data.accessToken),
      this.setTeamSlug(data.teamSlug),
      this.setTeamName(data.teamName),
      this.setTeamId(data.teamId),
      this.secrets.store(SECRET_KEYS.CONVEX_MEMBER_ID, data.memberId),
    ]);
    logger.info(`Stored OAuth connection for team: ${data.teamName}`);
  }

  /**
   * Check if user has a valid auth token.
   * Checks both JWT expiry and the 30-day wall-clock limit.
   */
  async isAuthenticated(): Promise<boolean> {
    const token = await this.getConvexAuthToken();
    return !!token;
  }

  /**
   * Check if there's any token stored (even if expired).
   */
  async hasStoredToken(): Promise<boolean> {
    const token = await this.secrets.get(SECRET_KEYS.CONVEX_AUTH_TOKEN);
    return !!token;
  }

  async hasConvexConnection(): Promise<boolean> {
    const token = await this.getConvexAccessToken();
    return !!token;
  }

  /**
   * Refresh the 30-day clock — call this when the user actively uses the extension.
   */
  async refreshTokenExpiry(): Promise<void> {
    const token = await this.secrets.get(SECRET_KEYS.CONVEX_AUTH_TOKEN);
    if (token) {
      await this.secrets.store(TOKEN_STORED_AT_KEY, String(Date.now()));
    }
  }

  async clearAll(): Promise<void> {
    await Promise.all([
      ...Object.values(SECRET_KEYS).map((key) => this.secrets.delete(key)),
      this.secrets.delete(TOKEN_STORED_AT_KEY),
    ]);
    logger.info('Cleared all stored tokens');
    this._onAuthChanged.fire(false);
  }

  /**
   * Check if a JWT token is expired.
   * Returns false (not expired) for non-JWT tokens — let the 30-day clock handle them.
   */
  private isJwtExpired(token: string): boolean {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        // Not a JWT — trust the 30-day clock instead
        return false;
      }

      const payload = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf-8'),
      );

      if (!payload.exp) {
        // No expiry claim — treat as valid
        return false;
      }

      // Add 60-second buffer to avoid racing
      const nowSec = Math.floor(Date.now() / 1000);
      return payload.exp < nowSec + 60;
    } catch {
      return false;
    }
  }

  dispose(): void {
    this._onAuthChanged.dispose();
  }
}
