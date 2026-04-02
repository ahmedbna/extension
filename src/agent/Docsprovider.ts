/**
 * Provides documentation content for the lookupDocs and lookupConvexDocs tools.
 *
 * This replaces the stub implementations that were returning placeholder text.
 * Content is ported from bna-agent/tools/docs/ and bna-agent/tools/lookupConvexDocsTool.ts
 */

export class DocsProvider {
  /**
   * Look up general docs (presence, dev-build, eas-build).
   */
  static lookupDocs(topic: string): string | null {
    switch (topic) {
      case 'presence':
        return PRESENCE_DOCS;
      case 'dev-build':
        return DEV_BUILD_DOCS;
      case 'eas-build':
        return EAS_BUILD_DOCS;
      default:
        return null;
    }
  }

  /**
   * Look up Convex-specific docs.
   */
  static lookupConvexDocs(topic: string): string | null {
    return CONVEX_DOCS[topic] ?? null;
  }
}

// ─── General Docs ─────────────────────────────────────────────────────────────

const PRESENCE_DOCS = `
# Convex PresenceComponent

Manages live-updating user presence in a "room" without polling.

## Installation
\`\`\`bash
npx expo install @convex-dev/presence expo-crypto
\`\`\`

## Setup

\`convex/convex.config.ts\`
\`\`\`ts
import { defineApp } from "convex/server";
import presence from "@convex-dev/presence/convex.config";
const app = defineApp();
app.use(presence);
export default app;
\`\`\`

\`convex/presence.ts\`
\`\`\`ts
import { mutation, query } from "./_generated/server";
import { components } from "./_generated/api";
import { v } from "convex/values";
import { Presence } from "@convex-dev/presence";
import { getAuthUserId } from "@convex-dev/auth/server";

export const presence = new Presence(components.presence);

export const heartbeat = mutation({
  args: { roomId: v.string(), userId: v.string(), sessionId: v.string(), interval: v.number() },
  handler: async (ctx, args) => {
    const authUserId = await getAuthUserId(ctx);
    if (!authUserId) throw new Error("Not authenticated");
    return presence.heartbeat(ctx, args.roomId, authUserId, args.sessionId, args.interval);
  },
});

export const list = query({
  args: { roomToken: v.string() },
  handler: async (ctx, { roomToken }) => {
    const list = await presence.list(ctx, roomToken);
    return Promise.all(list.map(async (entry) => {
      const user = await ctx.db.get(entry.userId);
      return user ? { ...entry, name: user.name, image: user.image } : entry;
    }));
  },
});

export const disconnect = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => presence.disconnect(ctx, sessionToken),
});
\`\`\`

## Usage
\`\`\`tsx
import { usePresence } from '@convex-dev/presence/react-native';
import { api } from '@/convex/_generated/api';

function PresenceIndicator({ userId }: { userId: string }) {
  const presenceState = usePresence(api.presence, 'my-room', userId);
  return <FacePile presenceState={presenceState ?? []} />;
}
\`\`\`
`;

const DEV_BUILD_DOCS = `
# Expo Dev Build Guide

## What is a Dev Build?
A custom version of Expo Go that includes your project's native dependencies.

## When to rebuild
Rebuild required after:
- \`npx expo install\` of any native package (camera, location, BLE, sensors, etc.)
- Changes to \`app.json\` plugins array

JS/Convex-only changes do NOT need a rebuild.

## Build commands
\`\`\`bash
npx expo run:ios        # iOS simulator
npx expo run:android   # Android emulator or connected device
\`\`\`

## Common native packages requiring rebuild
| Package | Use case |
|---------|----------|
| expo-camera | Camera access |
| expo-location | GPS/location |
| expo-notifications | Push notifications |
| expo-sensors | Accelerometer, gyro |
| expo-media-library | Photo/video library |
| expo-image-picker | Image selection |
| expo-audio | Audio playback |
| expo-video | Video playback |

## Troubleshooting
- "Module not found" or native crash → Rebuild dev client
- Metro bundler errors → JS issue, no rebuild needed
- Convex errors → Backend issue, no rebuild needed
`;

const EAS_BUILD_DOCS = `
# EAS Build (Expo Application Services)

## Setup
\`\`\`bash
npm install -g eas-cli
eas login
eas build:configure
\`\`\`

## eas.json profiles
\`\`\`json
{
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "ios": { "simulator": true }
    },
    "preview": { "distribution": "internal" },
    "production": { "autoIncrement": true }
  }
}
\`\`\`

## Build commands
\`\`\`bash
eas build --platform ios --profile development
eas build --platform android --profile development
eas build --platform all --profile production
\`\`\`

## OTA Updates (JS only)
\`\`\`bash
eas update --branch production --message "Fix typo"
\`\`\`
`;

// ─── Convex Docs ──────────────────────────────────────────────────────────────

const CONVEX_DOCS: Record<string, string> = {
  'file-storage': `
# File Storage
- Store \`storageId\` (not URLs) in DB. Get URL on read: \`await ctx.storage.getUrl(storageId)\`

\`\`\`ts
// Generate upload URL
export const generateUploadUrl = mutation({
  handler: async (ctx) => ctx.storage.generateUploadUrl(),
});

// Save after upload
export const saveFile = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    return ctx.db.insert("files", { userId, storageId });
  },
});

// List with URLs
export const getFiles = query({
  handler: async (ctx) => {
    const files = await ctx.db.query("files").collect();
    return Promise.all(files.map(async (f) => ({
      ...f, url: await ctx.storage.getUrl(f.storageId),
    })));
  },
});
\`\`\`

\`\`\`tsx
// React Native upload
const upload = async (uri: string) => {
  const postUrl = await generateUploadUrl();
  const blob = await (await fetch(uri)).blob();
  const { storageId } = await (await fetch(postUrl, {
    method: "POST", headers: { "Content-Type": "image/jpeg" }, body: blob,
  })).json();
  await saveFile({ storageId });
};
\`\`\`

Schema: \`storageId: v.id("_storage")\`
DO NOT use deprecated \`ctx.storage.getMetadata\`.
`,

  'full-text-search': `
# Full-Text Search

\`\`\`ts
// Schema
messages: defineTable({ body: v.string(), channel: v.string() })
  .searchIndex("search_body", { searchField: "body", filterFields: ["channel"] })

// Query
export const search = query({
  args: { q: v.string(), channel: v.optional(v.string()) },
  handler: async (ctx, { q, channel }) => {
    return ctx.db.query("messages")
      .withSearchIndex("search_body", (s) =>
        channel ? s.search("body", q).eq("channel", channel) : s.search("body", q)
      ).take(10);
  },
});
\`\`\`
`,

  pagination: `
# Pagination

\`\`\`ts
import { paginationOptsValidator } from "convex/server";

export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) =>
    ctx.db.query("messages").order("desc").paginate(paginationOpts),
});
\`\`\`

\`\`\`tsx
const { results, status, loadMore } = usePaginatedQuery(
  api.messages.list, {}, { initialNumItems: 20 }
);
\`\`\`
`,

  'http-actions': `
# HTTP Actions — use convex/router.ts (NOT convex/http.ts)

\`\`\`ts
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

http.route({
  path: "/api/webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const data = await req.json();
    await ctx.runMutation(internal.messages.create, { body: data.text });
    return Response.json({ ok: true });
  }),
});

export default http;
\`\`\`
`,

  'scheduling-cron': `
# Cron Jobs — convex/crons.ts

\`\`\`ts
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("cleanup", { hours: 2 }, internal.cleanup.run, {});
crons.cron("daily report", "0 0 * * *", internal.reports.daily, {});

export default crons;
\`\`\`

ONLY use \`crons.interval\` or \`crons.cron\`. Auth does NOT propagate.
`,

  'scheduling-runtime': `
# Runtime Scheduling

\`\`\`ts
export const scheduleReminder = mutation({
  args: { userId: v.id("users"), msg: v.string(), delayMs: v.number() },
  handler: async (ctx, { userId, msg, delayMs }) => {
    await ctx.scheduler.runAfter(delayMs, internal.reminders.send, { userId, msg });
  },
});
\`\`\`

Auth does NOT propagate — pass userId explicitly. Minimum interval: 10 seconds.
`,

  'actions-nodejs': `
# Node.js Actions

\`\`\`ts
"use node"; // Must be first line

import { action } from "./_generated/server";
import { internal } from "./_generated/api";

export const generate = action({
  args: { prompt: v.string() },
  handler: async (ctx, { prompt }) => {
    // No ctx.db — use ctx.runQuery / ctx.runMutation
    const history = await ctx.runQuery(internal.messages.list, {});
    // ... call external API ...
    await ctx.runMutation(internal.messages.save, { text: result });
    return result;
  },
});
\`\`\`

Files with \`"use node"\` → ONLY actions. Never queries or mutations.
`,

  'typescript-types': `
# TypeScript Types

\`\`\`ts
import { Doc, Id } from "./_generated/dataModel";

type User = Doc<"users">;
type UserId = Id<"users">;

export const get = query({
  args: { id: v.id("users") },
  handler: async (ctx, { id }): Promise<User | null> => ctx.db.get(id),
});
\`\`\`
`,

  'function-calling': `
# Cross-Function Calling

\`\`\`ts
export const process = action({
  handler: async (ctx) => {
    const data = await ctx.runQuery(api.items.list, {});
    await ctx.runMutation(internal.items.save, { data });
    await ctx.runAction(internal.ai.analyze, { data });
  },
});
\`\`\`

Always use \`api\` or \`internal\` references — never pass functions directly.
`,

  'query-advanced': `
# Advanced Queries

\`\`\`ts
const latest = await ctx.db.query("msgs").order("desc").take(10);
const recent = await ctx.db.query("msgs")
  .withIndex("by_time", q => q.gt("_creationTime", Date.now() - 3600_000))
  .collect();

// Compound index
const msgs = await ctx.db.query("msgs")
  .withIndex("by_channel_author", q => q.eq("channelId", cid).eq("authorId", uid))
  .collect();
\`\`\`

NEVER use \`.filter()\` — always define and use indexes.
`,

  'mutation-advanced': `
# Advanced Mutations

\`\`\`ts
// Batch insert
export const createMany = mutation({
  args: { items: v.array(v.object({ text: v.string() })) },
  handler: async (ctx, { items }) => {
    return Promise.all(items.map(i => ctx.db.insert("tasks", i)));
  },
});

// Upsert
export const upsert = mutation({
  args: { userId: v.id("users"), bio: v.string() },
  handler: async (ctx, { userId, bio }) => {
    const existing = await ctx.db.query("profiles")
      .withIndex("by_user", q => q.eq("userId", userId)).unique();
    if (existing) return ctx.db.patch(existing._id, { bio });
    return ctx.db.insert("profiles", { userId, bio });
  },
});
\`\`\`
`,
};
