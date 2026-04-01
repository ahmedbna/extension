import * as vscode from 'vscode';
import { SECRET_KEYS } from '../constants';
import { logger } from '../utils/logger';

/**
 * Manages secure storage of auth tokens and sensitive data
 * using VS Code's built-in SecretStorage API (backed by the OS keychain).
 */
export class TokenStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  // ── Convex Auth Token (user session JWT) ─────────────────────────
  async getConvexAuthToken(): Promise<string | undefined> {
    return this.secrets.get(SECRET_KEYS.CONVEX_AUTH_TOKEN);
  }

  async setConvexAuthToken(token: string): Promise<void> {
    await this.secrets.store(SECRET_KEYS.CONVEX_AUTH_TOKEN, token);
    logger.info('Stored Convex auth token');
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

  async isAuthenticated(): Promise<boolean> {
    const token = await this.getConvexAuthToken();
    return !!token;
  }

  async hasConvexConnection(): Promise<boolean> {
    const token = await this.getConvexAccessToken();
    return !!token;
  }

  async clearAll(): Promise<void> {
    await Promise.all(
      Object.values(SECRET_KEYS).map(key => this.secrets.delete(key))
    );
    logger.info('Cleared all stored tokens');
  }
}
