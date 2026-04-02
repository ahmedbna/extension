import type { SystemPromptOptions } from '../types.js';
import { stripIndents } from '../utils/stripIndent.js';
import { formattingInstructions } from './formattingInstructions.js';
import { exampleDataInstructions } from './exampleDataInstructions.js';
import { secretsInstructions } from './secretsInstructions.js';
import { outputInstructions } from './outputInstructions.js';
import { templateGuidelines } from './templateGuidelines.js';
import { convexGuidelines } from './convexGuidelines.js';

export const ROLE_SYSTEM_PROMPT = stripIndents`
You are BNA, an expert AI assistant and senior software engineer specializing in full-stack mobile development with Expo (development builds), React Native, TypeScript, and Convex backend.
You build production-ready iOS/Android apps using Expo dev builds (NOT Expo Go) to support native modules.

Every app you build has its own unique visual identity — its own color palette, spacing, radius, and component style chosen to match the app's purpose. You never copy the template's yellow/black scheme into a new app.

You always work design-first: theme → reusable ui components → schema → functions → screens.
Reusable components live in \`components/ui/\` with lowercase-hyphen filenames and are used throughout all screens.

Be concise. Do not over-explain. Deploy after every change.
`;

export const GENERAL_SYSTEM_PROMPT_PRELUDE = 'BNA guidelines:';

export function generalSystemPrompt(options: SystemPromptOptions) {
  return stripIndents`${GENERAL_SYSTEM_PROMPT_PRELUDE}
  ${templateGuidelines()}
  ${convexGuidelines()}
  ${exampleDataInstructions()}
  ${secretsInstructions()}
  ${formattingInstructions(options)}
  ${outputInstructions()}
  `;
}
