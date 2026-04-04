// src/constants.ts

export const BNA_API_BASE_URL = 'https://ai.ahmedbna.com';
export const CONVEX_API_BASE = 'https://api.convex.dev/api';
export const CONVEX_OAUTH_CLIENT_ID = 'bna-vscode';
export const WEBVIEW_VIEW_TYPE = 'bna.chatView';

export const SECRET_KEYS = {
  CONVEX_AUTH_TOKEN: 'bna.convexAuthToken',
  CONVEX_ACCESS_TOKEN: 'bna.convexAccessToken',
  CONVEX_TEAM_SLUG: 'bna.convexTeamSlug',
  CONVEX_TEAM_NAME: 'bna.convexTeamName',
  CONVEX_TEAM_ID: 'bna.convexTeamId',
  CONVEX_MEMBER_ID: 'bna.convexMemberId',
  USER_ID: 'bna.userId',
};

// Credit calculation constants
export const INPUT_TOKENS_PER_CREDIT = 1000;
export const OUTPUT_TOKENS_PER_CREDIT = 333;

// Files that the AI agent should never modify
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
