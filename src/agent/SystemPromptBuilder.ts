/**
 * Builds system prompts and Anthropic tool definitions for the VS Code extension.
 *
 * Adapts the bna-agent prompts for direct Anthropic API calls.
 * The key difference from the web app: tools execute on the REAL file system,
 * not WebContainers.
 */

import { getWorkspaceRoot } from '../utils/workspace';

export class SystemPromptBuilder {
  /**
   * Build the complete system prompt for the Anthropic API.
   */
  static build(): string {
    const workDir = getWorkspaceRoot() || '/home/project';

    return [
      this.rolePrompt(),
      this.generalGuidelines(workDir),
      this.convexGuidelines(),
      this.templateGuidelines(workDir),
      this.outputInstructions(),
    ].join('\n\n');
  }

  /**
   * Get Anthropic-format tool definitions.
   */
  static getToolDefinitions(): any[] {
    return [
      {
        name: 'view',
        description:
          'Read the contents of a file or list a directory. Use this to inspect files before editing. Returns line-numbered content for files, or a directory listing.',
        input_schema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description:
                'The path to the file or directory to read (relative to project root).',
            },
            view_range: {
              type: 'array',
              items: { type: 'number' },
              description:
                'Optional [start, end] line range (1-indexed). Use -1 for end to read to EOF.',
              nullable: true,
            },
          },
          required: ['path'],
        },
      },
      {
        name: 'edit',
        description:
          'Replace a unique string in a file with new text. The old text must appear exactly once. Always use `view` first to verify file contents. Both old and new must be < 1024 chars.',
        input_schema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'The path to the file to edit.',
            },
            old: {
              type: 'string',
              description:
                'The exact text to replace. Must appear exactly once in the file. Max 1024 chars.',
            },
            new: {
              type: 'string',
              description: 'The replacement text. Max 1024 chars.',
            },
          },
          required: ['path', 'old', 'new'],
        },
      },
      {
        name: 'deploy',
        description:
          'Deploy the Convex backend (codegen + typecheck + deploy). Call after writing or editing files. Fix all deploy errors before ending your turn.',
        input_schema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'npmInstall',
        description:
          'Install npm packages using `npx expo install` to ensure Expo/React Native compatibility. Set requiresNativeRebuild=true if any package includes native code.',
        input_schema: {
          type: 'object',
          properties: {
            packages: {
              type: 'string',
              description:
                'Space-separated list of packages to install via `npx expo install`.',
            },
            requiresNativeRebuild: {
              type: 'boolean',
              description:
                'Set true if any package includes native code requiring a dev client rebuild.',
            },
          },
          required: ['packages', 'requiresNativeRebuild'],
        },
      },
      {
        name: 'lookupDocs',
        description:
          'Look up documentation for component features. Valid topics: presence, dev-build, eas-build',
        input_schema: {
          type: 'object',
          properties: {
            docs: {
              type: 'array',
              items: {
                type: 'string',
                enum: ['presence', 'dev-build', 'eas-build'],
              },
              description: 'Features to look up.',
            },
          },
          required: ['docs'],
        },
      },
      {
        name: 'lookupConvexDocsTool',
        description:
          'Look up Convex docs for advanced features like file-storage, full-text-search, pagination, http-actions, scheduling-cron, scheduling-runtime, actions-nodejs, typescript-types, function-calling, query-advanced, mutation-advanced.',
        input_schema: {
          type: 'object',
          properties: {
            topics: {
              type: 'array',
              items: {
                type: 'string',
                enum: [
                  'file-storage',
                  'full-text-search',
                  'pagination',
                  'http-actions',
                  'scheduling-cron',
                  'scheduling-runtime',
                  'actions-nodejs',
                  'typescript-types',
                  'function-calling',
                  'query-advanced',
                  'mutation-advanced',
                ],
              },
              description: 'Advanced Convex topics to look up.',
            },
          },
          required: ['topics'],
        },
      },
      {
        name: 'addEnvironmentVariables',
        description:
          'Add environment variables to the Convex deployment. Opens the Convex dashboard for the user to set values.',
        input_schema: {
          type: 'object',
          properties: {
            envVarNames: {
              type: 'array',
              items: { type: 'string' },
              description:
                'List of environment variable names to add to the project.',
            },
          },
          required: ['envVarNames'],
        },
      },
      {
        name: 'getConvexDeploymentName',
        description:
          'Get the name of the Convex deployment this project is using.',
        input_schema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
    ];
  }

  private static rolePrompt(): string {
    return `You are BNA, an expert AI assistant and senior software engineer specializing in full-stack mobile development with Expo (development builds), React Native, TypeScript, and Convex backend.
You build production-ready iOS/Android apps using Expo dev builds (NOT Expo Go) to support native modules.

Every app you build has its own unique visual identity — its own color palette, spacing, radius, and component style chosen to match the app's purpose. You never copy the template's yellow/black scheme into a new app.

You always work design-first: theme → reusable ui components → schema → functions → screens.
Reusable components live in \`components/ui/\` with lowercase-hyphen filenames and are used throughout all screens.

IMPORTANT: You are running inside a VS Code extension. Files are written to the REAL file system. Terminal commands execute via real child_process. There are no WebContainers.

Be concise. Do not over-explain. Deploy after every change.`;
  }

  private static generalGuidelines(workDir: string): string {
    return `<environment>
  Working directory: ${workDir}
  Platform: VS Code Extension (real file system, real terminal)
  File operations: Use the view/edit tools OR write files via boltArtifact tags
  Terminal: Commands execute via child_process (real npm, real convex CLI)
  Preview: Real Expo dev server (npx expo run:ios / run:android)
</environment>`;
  }

  private static convexGuidelines(): string {
    return `<convex_guidelines>
  Convex = database + realtime + functions + auth + storage. Realtime is automatic.
  Call \`lookupConvexDocsTool\` before writing code for: file storage, full-text search, pagination, HTTP actions, scheduling, crons.

  ## Functions
  \`\`\`ts
  import { query, mutation, action } from "./_generated/server";
  import { v } from "convex/values";
  export const fn = query({ args: { x: v.string() }, handler: async (ctx, args) => { /* ... */ } });
  \`\`\`
  - Public: \`query\`, \`mutation\`, \`action\` | Internal: prefix with \`internal\`
  - ALWAYS include arg validators. NEVER use return validators.
  - Actions: add \`"use node";\` for Node built-ins. NEVER use \`ctx.db\` in actions.

  ## Validators
  \`v.string()\`, \`v.number()\`, \`v.boolean()\`, \`v.id(table)\`, \`v.null()\`, \`v.array(v)\`,
  \`v.object({...})\`, \`v.optional(v)\`, \`v.union(v1, v2)\`
  NEVER use \`v.map()\` or \`v.set()\`

  ## Schema
  \`\`\`ts
  import { defineSchema, defineTable } from "convex/server";
  import { authTables } from "@convex-dev/auth/server";
  import { v } from "convex/values";
  export default defineSchema({
    ...authTables,
    users: defineTable({
      email: v.optional(v.string()),
      name: v.optional(v.string()),
      image: v.optional(v.union(v.string(), v.null())),
      isAnonymous: v.optional(v.boolean()),
    }).index('email', ['email']),
  });
  \`\`\`

  ## DB Operations
  NEVER use \`.filter()\` — always use \`.withIndex()\`.

  ## Auth
  \`\`\`ts
  import { getAuthUserId } from "@convex-dev/auth/server";
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  \`\`\`

  ## React Hooks
  \`\`\`tsx
  import { useQuery, useMutation } from "convex/react";
  const data = useQuery(api.mod.fn);
  const mut = useMutation(api.mod.fn);
  const item = useQuery(api.mod.get, id ? { id } : "skip");
  if (data === undefined) return <Spinner />;
  \`\`\`
</convex_guidelines>`;
  }

  private static templateGuidelines(workDir: string): string {
    return `<solution_constraints>
  ## Stack
  Expo development build + React Native + Convex + TypeScript at \`${workDir}\`.
  File-based routing via Expo Router. Inline styles ONLY — no Tailwind, no \`className\`.

  ## App Identity & Theme — ALWAYS DO THIS FIRST
  Every app must have its own unique visual identity.
  Before writing any screen, design a theme in \`theme/colors.ts\` with:
  \`COLORS\` (primary, accent, background, surface, surfaceAlt, text, textMuted, textInverse, border, error, success, warning)
  \`RADIUS\` and \`SPACING\` objects.

  ## Reusable UI Components — Build BEFORE screens
  Every app gets its own component library in \`components/ui/\`.
  Required: \`button.tsx\` (spring animation + haptics), \`text.tsx\` (typography variants)

  ## Critical Rules
  1. Colors — ALWAYS use \`COLORS\` from \`@/theme/colors\`. NEVER hardcode hex/rgb.
  2. Locked files — NEVER modify: \`components/auth/\`, \`convex/auth.config.ts\`.
  3. Animations — ALWAYS use \`react-native-reanimated\`. NEVER use built-in Animated API.
  4. Keyboard — ALWAYS use \`react-native-keyboard-controller\`. NEVER use KeyboardAvoidingView.
  5. Deploy — call \`deploy\` after every change.
  6. Safe area — use \`useSafeAreaInsets\` with \`paddingTop: insets.top\` on screen containers.

  ## Artifacts
  Use artifacts for: new files, large multi-file changes, full rewrites.
  Use \`edit\` tool for: bug fixes, small changes.

  \`\`\`xml
  <boltArtifact id="kebab-id" title="Title">
    <boltAction type="file" filePath="relative/path.ts">...full file content...</boltAction>
  </boltArtifact>
  \`\`\`
</solution_constraints>`;
  }

  private static outputInstructions(): string {
    return `<output_instructions>
  ## Communication
  Before implementing, BRIEFLY outline steps (3-5 lines max). Then build.
  Be concise — no verbose explanations unless asked.

  ## Planning Order
  1. Theme → 2. UI components → 3. Schema → 4. Functions → 5. Screens → 6. Deploy

  ## Deployment — CRITICAL
  - NEVER end a turn without deploying via the deploy tool.
  - ALWAYS fix deploy errors and redeploy.
  - After schema changes: if deploy fails due to data mismatch, either make the field optional or ask user to clear the table.

  ## Tools
  Never reference tool names in responses (say "we installed X" not "used npmInstall tool").
</output_instructions>`;
  }
}
