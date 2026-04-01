import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import { TokenStore } from '../auth/TokenStore';
import { ConvexProjectManager } from '../convex/ConvexProjectManager';
import { logger } from '../utils/logger';

const execAsync = promisify(exec);

// The template repo or npm package to use
const TEMPLATE_REPO = 'https://github.com/ahmedbna/bna-template.git';

/**
 * Scaffolds a new BNA project from the template.
 * Creates the directory, installs dependencies, creates a Convex project,
 * and opens the workspace.
 */
export class TemplateScaffolder {
  constructor(
    private readonly tokenStore: TokenStore,
    private readonly projectManager: ConvexProjectManager
  ) {}

  async scaffold(): Promise<void> {
    // Step 1: Get project name
    const projectName = await vscode.window.showInputBox({
      prompt: 'What would you like to name your app?',
      value: 'my-bna-app',
      validateInput: (value) => {
        if (!value.trim()) return 'Name is required';
        if (!/^[a-zA-Z0-9-_]+$/.test(value)) {
          return 'Use only letters, numbers, hyphens, and underscores';
        }
        return null;
      },
    });
    if (!projectName) return;

    // Step 2: Choose location
    const uris = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      title: 'Choose parent directory for your project',
      openLabel: 'Create Here',
    });
    if (!uris || uris.length === 0) return;

    const parentDir = uris[0].fsPath;
    const projectDir = path.join(parentDir, projectName);

    // Check if directory already exists
    try {
      await fs.access(projectDir);
      vscode.window.showErrorMessage(`Directory already exists: ${projectDir}`);
      return;
    } catch {
      // Good — doesn't exist
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Creating BNA project...',
        cancellable: false,
      },
      async (progress) => {
        try {
          // Step 3: Clone or create template
          progress.report({ message: 'Setting up project structure...' });
          await this.createFromTemplate(projectDir, projectName);

          // Step 4: Install dependencies
          progress.report({ message: 'Installing dependencies...' });
          await this.installDeps(projectDir);

          // Step 5: Create Convex project
          progress.report({ message: 'Creating Convex project...' });
          const accessToken = await this.tokenStore.getConvexAccessToken();
          if (accessToken) {
            // We'll set up Convex after opening the workspace
            logger.info('Convex project will be initialized after workspace opens');
          }

          // Step 6: Open the workspace
          progress.report({ message: 'Opening project...' });
          const uri = vscode.Uri.file(projectDir);
          await vscode.commands.executeCommand('vscode.openFolder', uri);

        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to create project: ${err.message}`);
          logger.error('Scaffold failed:', err);
        }
      }
    );
  }

  /**
   * Create project from template.
   * Tries git clone first, falls back to inline template.
   */
  private async createFromTemplate(projectDir: string, projectName: string): Promise<void> {
    try {
      // Try cloning the template repo
      await execAsync(`git clone --depth 1 ${TEMPLATE_REPO} "${projectDir}"`);
      // Remove the .git directory so the user starts fresh
      await fs.rm(path.join(projectDir, '.git'), { recursive: true, force: true });
      logger.info('Cloned template from git');
    } catch {
      // Fallback: create a minimal template inline
      logger.info('Git clone failed, creating inline template');
      await this.createInlineTemplate(projectDir, projectName);
    }

    // Update app.json with the project name
    await this.updateAppJson(projectDir, projectName);
  }

  /**
   * Create a minimal Expo + Convex template if git clone fails.
   */
  private async createInlineTemplate(projectDir: string, projectName: string): Promise<void> {
    await fs.mkdir(projectDir, { recursive: true });

    // package.json
    await fs.writeFile(
      path.join(projectDir, 'package.json'),
      JSON.stringify(
        {
          name: projectName,
          version: '1.0.0',
          main: 'expo-router/entry',
          scripts: {
            start: 'expo start',
            android: 'expo run:android',
            ios: 'expo run:ios',
          },
          dependencies: {
            expo: '~54.0.0',
            'expo-router': '~4.0.0',
            'expo-dev-client': '~5.0.0',
            'expo-haptics': '~14.0.0',
            'expo-secure-store': '~14.0.0',
            react: '18.3.1',
            'react-native': '0.76.0',
            'react-native-reanimated': '~3.16.0',
            'react-native-safe-area-context': '~5.0.0',
            'react-native-screens': '~4.4.0',
            'react-native-gesture-handler': '~2.21.0',
            convex: '^1.27.0',
            'convex-react': '^1.27.0',
            '@convex-dev/auth': '^0.0.90',
            '@expo/vector-icons': '^14.0.0',
            'lucide-react-native': '^0.460.0',
          },
          devDependencies: {
            '@types/react': '~18.3.0',
            typescript: '~5.7.0',
          },
        },
        null,
        2
      )
    );

    // app.json
    const slug = projectName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    await fs.writeFile(
      path.join(projectDir, 'app.json'),
      JSON.stringify(
        {
          expo: {
            name: projectName,
            slug,
            scheme: slug,
            version: '1.0.0',
            orientation: 'portrait',
            newArchEnabled: true,
            ios: { bundleIdentifier: `com.bna.${slug.replace(/-/g, '')}` },
            android: { package: `com.bna.${slug.replace(/-/g, '')}` },
            plugins: ['expo-router', 'expo-secure-store'],
          },
        },
        null,
        2
      )
    );

    // tsconfig.json
    await fs.writeFile(
      path.join(projectDir, 'tsconfig.json'),
      JSON.stringify(
        {
          extends: 'expo/tsconfig.base',
          compilerOptions: {
            strict: true,
            paths: { '@/*': ['./*'] },
          },
        },
        null,
        2
      )
    );

    // Create directory structure
    const dirs = [
      'app',
      'app/(home)',
      'components/auth',
      'components/ui',
      'convex',
      'theme',
    ];
    for (const dir of dirs) {
      await fs.mkdir(path.join(projectDir, dir), { recursive: true });
    }

    // theme/colors.ts
    await fs.writeFile(
      path.join(projectDir, 'theme', 'colors.ts'),
      `export const COLORS = {
  primary: '#FAD40B',
  accent: '#FAD40B',
  background: '#0d0d0f',
  surface: '#1a1a1f',
  surfaceAlt: '#252530',
  text: '#ffffff',
  textMuted: '#8e8e93',
  textInverse: '#000000',
  border: '#2c2c2e',
  error: '#ff453a',
  success: '#30d158',
  warning: '#ffd60a',
};

export const RADIUS = {
  sm: 6,
  md: 10,
  lg: 16,
  xl: 24,
  full: 9999,
};

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};
`
    );

    // convex/schema.ts
    await fs.writeFile(
      path.join(projectDir, 'convex', 'schema.ts'),
      `import { defineSchema, defineTable } from 'convex/server';
import { authTables } from '@convex-dev/auth/server';
import { v } from 'convex/values';

export default defineSchema({
  ...authTables,
  users: defineTable({
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    image: v.optional(v.union(v.string(), v.null())),
    isAnonymous: v.optional(v.boolean()),
  }).index('email', ['email']),
});
`
    );

    // app/(home)/index.tsx
    await fs.writeFile(
      path.join(projectDir, 'app', '(home)', 'index.tsx'),
      `import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, SPACING } from '@/theme/colors';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Text style={styles.title}>Welcome to BNA</Text>
      <Text style={styles.subtitle}>Start building your app!</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.lg,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: SPACING.sm,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.textMuted,
  },
});
`
    );

    // .gitignore
    await fs.writeFile(
      path.join(projectDir, '.gitignore'),
      `node_modules/
.expo/
dist/
.env.local
ios/
android/
*.jks
*.p8
*.p12
*.key
*.mobileprovision
*.orig.*
web-build/
`
    );

    logger.info(`Created inline template at ${projectDir}`);
  }

  /**
   * Update app.json with the project name.
   */
  private async updateAppJson(projectDir: string, projectName: string): Promise<void> {
    const appJsonPath = path.join(projectDir, 'app.json');
    try {
      const content = await fs.readFile(appJsonPath, 'utf-8');
      const appJson = JSON.parse(content);

      const slug = projectName.toLowerCase().replace(/[^a-z0-9-]/g, '-');

      if (appJson.expo) {
        appJson.expo.name = projectName;
        appJson.expo.slug = slug;
        appJson.expo.scheme = slug;
        if (appJson.expo.ios) {
          appJson.expo.ios.bundleIdentifier = `com.bna.${slug.replace(/-/g, '')}`;
        }
        if (appJson.expo.android) {
          appJson.expo.android.package = `com.bna.${slug.replace(/-/g, '')}`;
        }
      }

      await fs.writeFile(appJsonPath, JSON.stringify(appJson, null, 2));
    } catch (err) {
      logger.warn('Failed to update app.json:', err);
    }
  }

  /**
   * Install npm dependencies.
   */
  private async installDeps(projectDir: string): Promise<void> {
    try {
      await execAsync('npm install', { cwd: projectDir, timeout: 120000 });
      logger.info('Dependencies installed');
    } catch (err: any) {
      logger.warn('npm install had issues:', err.message);
      // Don't fail — user can install manually
    }
  }
}
