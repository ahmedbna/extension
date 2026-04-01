import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { getWorkspaceRoot } from '../utils/workspace';
import { logger } from '../utils/logger';
import type { ChatMessage } from '../agent/BNAAgent';

const HISTORY_DIR = '.bna';
const HISTORY_FILE = 'chat-history.json';

interface StoredChatHistory {
  chatId: string;
  messages: ChatMessage[];
  updatedAt: number;
}

/**
 * Manages chat message history.
 * Stores locally in .bna/chat-history.json and syncs to Convex.
 */
export class MessageHistory {
  /**
   * Save messages to local history file.
   */
  async saveLocal(chatId: string, messages: ChatMessage[]): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) return;

    const dir = path.join(root, HISTORY_DIR);
    await fs.mkdir(dir, { recursive: true });

    const data: StoredChatHistory = {
      chatId,
      messages,
      updatedAt: Date.now(),
    };

    const filePath = path.join(dir, HISTORY_FILE);
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * Load messages from local history file.
   */
  async loadLocal(): Promise<StoredChatHistory | null> {
    const root = getWorkspaceRoot();
    if (!root) return null;

    const filePath = path.join(root, HISTORY_DIR, HISTORY_FILE);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as StoredChatHistory;
    } catch {
      return null;
    }
  }

  /**
   * Clear local history.
   */
  async clearLocal(): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) return;

    const filePath = path.join(root, HISTORY_DIR, HISTORY_FILE);
    try {
      await fs.unlink(filePath);
    } catch {
      // File doesn't exist — ok
    }
  }

  /**
   * Sync messages to the BNA server (Convex).
   * This mirrors the store_chat HTTP endpoint from the web app.
   */
  async syncToServer(args: {
    siteUrl: string;
    userId: string;
    chatId: string;
    messages: ChatMessage[];
    subchatIndex: number;
  }): Promise<boolean> {
    try {
      const { siteUrl, userId, chatId, messages, subchatIndex } = args;

      const serialized = messages.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        parts: m.parts,
        annotations: m.annotations,
      }));

      const compressed = new TextEncoder().encode(JSON.stringify(serialized));

      const url = new URL(`${siteUrl}/store_chat`);
      url.searchParams.set('userId', userId);
      url.searchParams.set('chatId', chatId);
      url.searchParams.set('lastMessageRank', String(messages.length - 1));
      url.searchParams.set('lastSubchatIndex', String(subchatIndex));
      url.searchParams.set('partIndex', '0');

      const formData = new FormData();
      formData.append('messages', new Blob([compressed]));

      const response = await fetch(url.toString(), {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        logger.error('Failed to sync messages:', await response.text());
        return false;
      }

      return true;
    } catch (err) {
      logger.error('Error syncing messages:', err);
      return false;
    }
  }
}
