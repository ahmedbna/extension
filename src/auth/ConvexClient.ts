import { ConvexHttpClient } from 'convex/browser';
import { TokenStore } from './TokenStore';
import { logger } from '../utils/logger';

/**
 * Wrapper around ConvexHttpClient that handles authentication.
 * Used for server-side mutations/queries (credit checks, chat storage, etc.)
 */
export class ConvexClient {
  private client: ConvexHttpClient | null = null;

  constructor(
    private readonly convexUrl: string,
    private readonly tokenStore: TokenStore
  ) {}

  private getClient(): ConvexHttpClient {
    if (!this.client) {
      this.client = new ConvexHttpClient(this.convexUrl);
    }
    return this.client;
  }

  /**
   * Set the auth token on the client for authenticated requests.
   */
  async authenticate(): Promise<boolean> {
    const token = await this.tokenStore.getConvexAuthToken();
    if (!token) {
      logger.warn('No auth token available for Convex client');
      return false;
    }
    this.getClient().setAuth(token);
    return true;
  }

  /**
   * Run a Convex query.
   */
  async query<T>(functionReference: any, args?: any): Promise<T> {
    await this.authenticate();
    return this.getClient().query(functionReference, args ?? {}) as Promise<T>;
  }

  /**
   * Run a Convex mutation.
   */
  async mutation<T>(functionReference: any, args?: any): Promise<T> {
    await this.authenticate();
    return this.getClient().mutation(functionReference, args ?? {}) as Promise<T>;
  }

  /**
   * Run a Convex action.
   */
  async action<T>(functionReference: any, args?: any): Promise<T> {
    await this.authenticate();
    return this.getClient().action(functionReference, args ?? {}) as Promise<T>;
  }

  dispose() {
    this.client = null;
  }
}
