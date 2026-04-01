export const EXTENSION_ID = 'bna.bna-ai';
export const EXTENSION_NAME = 'BNA';

export const BNA_API_BASE_URL = 'https://ai.ahmedbna.com';
export const CONVEX_PROVISION_HOST = 'https://api.convex.dev';
export const CONVEX_API_BASE = 'https://api.convex.dev/v1';

export const CONVEX_OAUTH_CLIENT_ID = 'd6b4f505398d44c6';

export const WORK_DIR_NAME = 'project';

export const INITIAL_FREE_CREDITS = 100;
export const INPUT_TOKENS_PER_CREDIT = 1000;
export const OUTPUT_TOKENS_PER_CREDIT = 1000;

export const MAX_RETRIES = 4;
export const MAX_CONSECUTIVE_DEPLOY_ERRORS = 5;

// Files the AI agent should never modify
export const EXCLUDED_FILE_PATHS = [
  'app/_layout.tsx',
  'app/+not-found.tsx',
  'app.json',
  'eas.json',
  'tsconfig.json',
  'convex/auth.ts',
  'convex/auth.config.ts',
  'convex/http.ts',
  'eslint.config.js',
  'expo-env.d.ts',
];

export const WEBVIEW_VIEW_TYPE = 'bna.chatView';

// Secret storage keys
export const SECRET_KEYS = {
  CONVEX_AUTH_TOKEN: 'bna.convex.authToken',
  CONVEX_ACCESS_TOKEN: 'bna.convex.accessToken',
  CONVEX_TEAM_SLUG: 'bna.convex.teamSlug',
  CONVEX_TEAM_NAME: 'bna.convex.teamName',
  CONVEX_TEAM_ID: 'bna.convex.teamId',
  CONVEX_MEMBER_ID: 'bna.convex.memberId',
  USER_ID: 'bna.userId',
} as const;
