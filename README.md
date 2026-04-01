# BNA — VS Code Extension

Build fullstack Expo React Native + Convex mobile apps with AI, directly from VS Code.

## Overview

This VS Code extension brings the full BNA AI builder experience into your editor. Instead of WebContainers, it uses your **real file system, terminal, and Expo/Convex CLIs** — giving you native performance, proper iOS/Android builds, and full access to your dev environment.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    VS Code Extension                    │
│                                                         │
│  ┌────────────┐  ┌────────────┐  ┌────────────────────┐ │
│  │  Webview   │  │  Terminal  │  │  Real File System  │ │
│  │ (Chat UI)  │  │  Manager   │  │  (fs module)       │ │
│  └─────┬──────┘  └──────┬─────┘  └─────────┬──────────┘ │
│        │                │                  │            │
│  ┌─────┴───────────-────┴──────────────────┴─────────-┐ │
│  │                  Extension Host                    │ │
│  │                                                    │ │
│  │  AuthManager ──► TokenStore (OS Keychain)          │ │
│  │  BNAAgent    ──► BNA API (/api/chat)               │ │
│  │  ToolExecutor ─► FileTools, TerminalManager        │ │
│  │  CreditsManager ► Status Bar                       │ │
│  │  ConvexProjectManager ► .env.local                 │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### Key differences from the web app

| Concern     | Web App                          | VS Code Extension                             |
| ----------- | -------------------------------- | --------------------------------------------- |
| File system | WebContainer (virtual)           | Real local `fs`                               |
| Terminal    | xterm.js + WebContainer          | VS Code integrated terminal + `child_process` |
| Editor      | Embedded Monaco                  | Native VS Code editor                         |
| Auth tokens | Browser `localStorage`           | VS Code `SecretStorage` (OS keychain)         |
| npm install | WebContainer npm                 | Real `npx expo install`                       |
| Deploy      | WebContainer `convex dev --once` | Real `convex` CLI                             |
| Preview     | WebContainer iframe              | Real Expo dev server                          |
| AI backend  | Remix action `/api/chat`         | Same endpoint, called from Node.js            |

---

## Prerequisites

Before using the extension, ensure you have:

1. **Node.js 18+** — [nodejs.org](https://nodejs.org)
2. **VS Code 1.85+**
3. **Expo CLI** — installed via `npx`
4. **Convex CLI** — `npm install -g convex`
5. **Xcode** (macOS, for iOS) or **Android Studio** (for Android)
6. A **BNA account** — [ai.ahmedbna.com](https://ai.ahmedbna.com)

---

## Step-by-Step Setup Guide

### Step 1: Clone and build the extension

```bash
git clone <this-repo>
cd bna-vscode-extension

# Install extension dependencies
npm install

# Install webview UI dependencies
cd webview-ui && npm install && cd ..

# Build everything
npm run build
```

### Step 2: Install in VS Code

Build the extension & the webview UI

```bash
node esbuild.config.mjs
```

```bash
cd webview-ui && npx vite build && cd ..
```

**Option A — Development mode:**

```bash
# Open the extension folder in VS Code
code .

# Press F5 to launch Extension Development Host
```

**Option B — Package and install:**

```bash
npm run package
# This creates bna-ai-0.1.0.vsix

# Install it:
code --install-extension bna-ai-0.1.0.vsix
```

### Step 3: Sign in

1. Click the **BNA** icon in the Activity Bar (left sidebar)
2. Click **"Sign In to Get Started"**
3. Your browser opens to `ai.ahmedbna.com/vscode-login`
4. Sign in with Google or GitHub
5. The extension automatically picks up your auth token

### Step 4: Connect Convex

1. Run command: `BNA: Connect Convex Project` (Ctrl+Shift+P)
2. Authorize in the Convex dashboard (opens in browser)
3. Your team connection is stored securely

### Step 5: Create or open a project

**New project:**

1. Run command: `BNA: New Project from Template`
2. Choose a name and parent folder
3. The template is scaffolded and dependencies installed

**Existing project:**

1. Open any folder with `convex/schema.ts` and `app.json`
2. The extension auto-detects it

### Step 6: Start building

1. Open the BNA chat panel (Activity Bar → BNA)
2. Type your app idea: _"Build a fitness tracker with workout plans"_
3. Watch as the AI:
   - Designs a theme in `theme/colors.ts`
   - Creates UI components in `components/ui/`
   - Writes the Convex schema
   - Builds screens
   - Deploys to Convex
   - Starts the Expo dev server

---

## Extension Commands

| Command                          | Shortcut     | Description                       |
| -------------------------------- | ------------ | --------------------------------- |
| `BNA: Open AI Chat`              | Ctrl+Shift+B | Focus the chat panel              |
| `BNA: Sign In`                   | —            | Authenticate via browser          |
| `BNA: Sign Out`                  | —            | Clear auth tokens                 |
| `BNA: Connect Convex`            | —            | OAuth to connect your Convex team |
| `BNA: New Project from Template` | —            | Scaffold a new BNA project        |
| `BNA: Deploy to Convex`          | —            | Run codegen + typecheck + deploy  |
| `BNA: View Credits`              | —            | Show credit balance               |
| `BNA: Buy Credits`               | —            | Open credits page in browser      |

---

## Project File Structure

```
bna-vscode-extension/
├── package.json                # Extension manifest
├── tsconfig.json               # TypeScript config
├── esbuild.config.mjs          # Extension bundler
│
├── src/                        # Extension host code (Node.js)
│   ├── extension.ts            # activate() / deactivate()
│   ├── constants.ts            # Shared constants
│   │
│   ├── auth/
│   │   ├── AuthManager.ts      # Browser OAuth polling
│   │   ├── ConvexClient.ts     # ConvexHttpClient wrapper
│   │   └── TokenStore.ts       # SecretStorage (OS keychain)
│   │
│   ├── agent/
│   │   ├── BNAAgent.ts         # AI orchestrator (calls /api/chat)
│   │   └── MessageHistory.ts   # Local + remote history sync
│   │
│   ├── tools/
│   │   ├── FileTools.ts        # view / edit / write on real FS
│   │   └── ToolExecutor.ts     # Dispatches all tool calls
│   │
│   ├── terminal/
│   │   └── TerminalManager.ts  # VS Code terminal + child_process
│   │
│   ├── credits/
│   │   └── CreditsManager.ts   # Balance tracking + status bar
│   │
│   ├── convex/
│   │   ├── ConvexOAuth.ts      # Team OAuth flow
│   │   └── ConvexProjectManager.ts  # Create projects + .env.local
│   │
│   ├── scaffold/
│   │   └── TemplateScaffolder.ts  # New project from template
│   │
│   ├── webview/
│   │   └── ChatWebviewProvider.ts # Webview panel + message bridge
│   │
│   └── utils/
│       ├── logger.ts
│       ├── workspace.ts
│       └── FileWatcher.ts
│
├── webview-ui/                 # React chat UI (separate Vite build)
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
│       ├── index.tsx
│       ├── App.tsx
│       ├── styles.css
│       ├── hooks/
│       │   └── useVSCodeAPI.ts # postMessage bridge
│       └── components/
│           ├── AuthPrompt.tsx
│           ├── ChatHeader.tsx
│           ├── MessageInput.tsx
│           ├── MessageList.tsx
│           └── StatusIndicator.tsx
│
└── media/
    └── bna.png
```

---

## How the AI Agent Works

The extension calls the **same BNA API** (`/api/chat`) as the web app. This ensures:

- ✅ Same system prompts (Expo + Convex guidelines)
- ✅ Same tool definitions (deploy, view, edit, npmInstall, etc.)
- ✅ Same credit tracking and deduction
- ✅ Same chat history format (compatible with web app)

### Flow:

```
User types message
    │
    ▼
BNAAgent.sendMessage()
    │
    ├── POST /api/chat (BNA server)
    │     │
    │     ├── System prompts + tools injected server-side
    │     ├── Anthropic API called
    │     └── SSE stream returned
    │
    ▼
processStream()
    │
    ├── Text deltas → Webview (chat bubble)
    ├── Tool calls → ToolExecutor
    │     ├── view  → fs.readFile / fs.readdir
    │     ├── edit  → fs.readFile + replace + fs.writeFile
    │     ├── file  → fs.writeFile (from boltArtifact tags)
    │     ├── deploy → child_process: convex codegen + tsc + convex dev --once
    │     ├── npmInstall → child_process: npx expo install <pkg>
    │     └── addEnvironmentVariables → open Convex dashboard
    │
    └── Finish → Credit deduction (server-side)
```

### Tool execution comparison:

| Tool              | Web App (WebContainer)              | Extension (Real FS)                          |
| ----------------- | ----------------------------------- | -------------------------------------------- |
| `view`            | `webcontainer.fs.readFile`          | `fs.readFile`                                |
| `edit`            | `webcontainer.fs.readFile` + write  | `fs.readFile` + write                        |
| `file` (artifact) | `webcontainer.fs.writeFile`         | `fs.writeFile` + open in editor              |
| `deploy`          | WebContainer `spawn('convex', ...)` | `child_process.exec('npx convex ...')`       |
| `npmInstall`      | WebContainer `spawn('npm', ...)`    | `child_process.exec('npx expo install ...')` |

---

## Authentication Flow

The extension reuses the web app's **vscode auth route** (`/vscode-login`):

```
Extension                        Browser                         BNA Server
   │                                │                                │
   ├── Generate session_id ─────────┤                                │
   ├── Open browser ───────────────►│                                │
   │                                ├── User logs in (Google/GitHub)─►│
   │                                │◄── Auth completed ─────────────┤
   │                                ├── Store token ────────────────►│
   │                                │   (vscodeAuthSessions table)  │
   │                                │                                │
   ├── Poll /api/vscode-auth ─────────────────────────────────────►│
   │◄── Token returned ──────────────────────────────────────────────┤
   ├── Store in SecretStorage       │                                │
   └── Authenticated ✓             │                                │
```

---

## Credits & Payments

Credits work identically to the web app:

1. **Check credits** — stored in Convex `credits` table, shown in status bar
2. **Deduction** — the `/api/chat` endpoint deducts credits server-side after each generation
3. **Purchase** — "Buy Credits" command opens `ai.ahmedbna.com/credits` in browser
4. **Webhook** — Dodo Payments webhook on the server handles credit provisioning

The status bar shows: `⚡ 87 credits`

- Green when > 10
- Yellow when ≤ 10
- Red when ≤ 0

---

## Configuration

VS Code Settings (`Ctrl+,`):

| Setting               | Default                   | Description                |
| --------------------- | ------------------------- | -------------------------- |
| `bna.apiBaseUrl`      | `https://ai.ahmedbna.com` | BNA API URL                |
| `bna.convexUrl`       | (empty)                   | Your Convex deployment URL |
| `bna.anthropicApiKey` | (empty)                   | Optional: your own API key |

---

## Development

### Watch mode (extension + webview):

```bash
npm run dev
# Then press F5 in VS Code to launch Extension Development Host
```

### Build for production:

```bash
npm run build
npm run package
```

### Testing:

```bash
npm test
```

---

## Migration Notes (from Web App)

### What was kept:

- All system prompts (`bna-agent/prompts/`)
- Tool definitions and parameters (`bna-agent/tools/`)
- Credit calculation logic (`app/lib/common/usage.ts`)
- Convex schema and backend functions (`convex/`)
- Auth flow using `vscodeAuthSessions`
- API endpoint (`/api/chat`) — same SSE stream protocol

### What was replaced:

- WebContainer → Real file system + `child_process`
- xterm.js → VS Code integrated terminal
- Monaco editor → Native VS Code editor
- Browser OAuth → External browser + polling
- React SPA → VS Code webview (React)
- Remix routing → VS Code commands
- nanostores → VS Code EventEmitters + React state
- Sonner toasts → `vscode.window.showInformationMessage`

### What was removed:

- WebContainer snapshot loading/saving
- Browser compatibility checks
- iframe preview (replaced by real Expo dev server)
- LaunchDarkly feature flags (not needed in extension)
- Sentry browser SDK (use VS Code telemetry instead)
- Share routes, legal pages, landing page
