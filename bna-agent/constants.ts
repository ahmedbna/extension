export const WORK_DIR_NAME = 'project';
export const WORK_DIR = `/home/${WORK_DIR_NAME}`;

export const PREWARM_PATHS = [
  `${WORK_DIR}/package.json`,
  `${WORK_DIR}/app.json`,
  `${WORK_DIR}/convex/schema.ts`,
  `${WORK_DIR}/app/(home)/_layout.tsx`,
  `${WORK_DIR}/theme/colors.ts`,
];

// Files blocked from LLM modification
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
