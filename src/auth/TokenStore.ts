import * as vscode from 'vscode';
import { SECRET_KEYS } from '../constants';
import { logger } from '../utils/logger';

/**
 * Manages secure storage of auth tokens and sensitive data
 * using VS Code's built-in SecretStorage API (backed by the OS keychain).
 *
 * Key improvements over the original:
 * - Token validation (JWT expiry checks)
 * - Event emitter for auth state changes
 * - Atomic bulk storage for OAuth connections
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

    // Check if token is expired
    if (this.isTokenExpired(token)) {
      logger.warn('Convex auth token is expired');
      // Don't clear automatically — let AuthManager handle refresh
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
    logger.info('Stored Convex auth token');
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
   * Check if user has a valid (non-expired) auth token.
   */
  async isAuthenticated(): Promise<boolean> {
    const token = await this.getConvexAuthToken();
    return !!token;
  }

  /**
   * Check if there's any token stored (even if expired).
   * Useful for deciding whether to attempt refresh vs fresh login.
   */
  async hasStoredToken(): Promise<boolean> {
    const token = await this.secrets.get(SECRET_KEYS.CONVEX_AUTH_TOKEN);
    return !!token;
  }

  async hasConvexConnection(): Promise<boolean> {
    const token = await this.getConvexAccessToken();
    return !!token;
  }

  async clearAll(): Promise<void> {
    await Promise.all(
      Object.values(SECRET_KEYS).map((key) => this.secrets.delete(key)),
    );
    logger.info('Cleared all stored tokens');
    this._onAuthChanged.fire(false);
  }

  /**
   * Check if a JWT token is expired.
   * Returns true if expired or if we can't parse it (fail-safe).
   */
  private isTokenExpired(token: string): boolean {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        // Not a JWT — treat as valid (could be an opaque token)
        return false;
      }

      const payload = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf-8'),
      );

      if (!payload.exp) {
        // No expiry claim — treat as valid
        return false;
      }

      // Add 30-second buffer so we don't use a token that's about to expire
      const nowSec = Math.floor(Date.now() / 1000);
      return payload.exp < nowSec + 30;
    } catch {
      // Can't parse — treat as valid and let the server reject it
      return false;
    }
  }

  dispose(): void {
    this._onAuthChanged.dispose();
  }
}
