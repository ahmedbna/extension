# BNA VS Code Extension — Architecture & Implementation Guide

## Overview

Transform the BNA web-based AI builder into a VS Code extension that uses the **real file system and terminal** instead of WebContainers, while preserving authentication, Convex integration, credit management, and the AI agent workflow.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────┐
│                   VS Code Extension                 │
│                                                     │
│  ┌──────────-┐  ┌──────────-┐  ┌────────────────┐   │
│  │ Webview   │  │ Terminal  │  │ File System    │   │
│  │ (Chat UI) │  │ Provider  │  │ Watcher        │   │
│  └─────┬─────┘  └─────┬────-┘  └───────┬────────┘   │
│        │              │                │            │
│  ┌─────┴──────────────┴────────────────┴──────────┐ │
│  │              Extension Host (Node.js)          │ │
│  │                                                │ │
│  │  ┌──────────────┐  ┌──────────────────────────┐│ │
│  │  │ Auth Manager │  │ AI Agent (bna-agent)     ││ │
│  │  │ (Convex Auth)│  │ - Anthropic API          ││ │
│  │  └──────┬───────┘  │ - Tool execution         ││ │
│  │         │          │ - File/Edit/View/Deploy  ││ │
│  │         │          └──────────┬───────────────┘│ │
│  │         │                     │                │ │
│  │  ┌──────┴─────────────────────┴───────────────┐│ │
│  │  │           Convex Client                    ││ │
│  │  │ - Credits, Payments, Chat History          ││ │
│  │  │ - OAuth Connections, Project Management    ││ │
│  │  └────────────────────────────────────────────┘│ │
│  └────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

## Key Differences from Web Version

| Feature     | Web (Current)                 | VS Code Extension           |
| ----------- | ----------------------------- | --------------------------- |
| File System | WebContainer virtual FS       | Real local file system      |
| Terminal    | xterm.js + WebContainer shell | VS Code integrated terminal |
| Editor      | Monaco (embedded)             | VS Code editor (native)     |
| Auth        | Browser OAuth flow            | OAuth via external browser  |
| Preview     | WebContainer iframe           | Expo dev server (real)      |
| npm install | WebContainer npm              | Real npm/npx                |
| Deploy      | WebContainer convex CLI       | Real convex CLI             |

## Project Structure

```
bna-vscode-extension/
├── package.json              # Extension manifest
├── tsconfig.json
├── esbuild.config.mjs        # Build configuration
├── src/
│   ├── extension.ts          # Extension entry point
│   ├── constants.ts          # Shared constants
│   │
│   ├── auth/
│   │   ├── AuthManager.ts    # OAuth flow management
│   │   ├── ConvexClient.ts   # Convex connection wrapper
│   │   └── TokenStore.ts     # Secure token storage
│   │
│   ├── agent/
│   │   ├── BNAAgent.ts       # Main AI agent orchestrator
│   │   ├── StreamHandler.ts  # SSE stream processing
│   │   ├── ToolExecutor.ts   # Execute tools on real FS
│   │   └── MessageHistory.ts # Chat history management
│   │
│   ├── tools/
│   │   ├── FileTool.ts       # Write files to real FS
│   │   ├── EditTool.ts       # Edit files on real FS
│   │   ├── ViewTool.ts       # Read files from real FS
│   │   ├── DeployTool.ts     # Run convex deploy + expo
│   │   ├── NpmInstallTool.ts # Run npm install
│   │   ├── LookupDocsTool.ts # Documentation lookup
│   │   └── EnvVarsTool.ts    # Environment variables
│   │
│   ├── terminal/
│   │   ├── TerminalManager.ts # VS Code terminal management
│   │   └── OutputCapture.ts   # Capture terminal output
│   │
│   ├── credits/
│   │   ├── CreditsManager.ts  # Credit checking & deduction
│   │   └── StatusBar.ts       # Credits status bar item
│   │
│   ├── webview/
│   │   ├── ChatWebviewProvider.ts  # Webview panel provider
│   │   ├── getWebviewContent.ts    # HTML template
│   │   └── webview/               # Frontend (bundled separately)
│   │       ├── index.tsx
│   │       ├── App.tsx
│   │       ├── components/
│   │       │   ├── ChatPanel.tsx
│   │       │   ├── MessageInput.tsx
│   │       │   ├── Messages.tsx
│   │       │   └── StreamingIndicator.tsx
│   │       └── hooks/
│   │           └── useVSCodeAPI.ts
│   │
│   ├── convex/
│   │   ├── ConvexProjectManager.ts # Project provisioning
│   │   └── ConvexOAuth.ts          # Convex OAuth flow
│   │
│   └── utils/
│       ├── logger.ts
│       └── workspace.ts     # Workspace utilities
│
├── media/                    # Icons and assets
│   ├── bricks.png
│   └── bna.png
│
└── webview-ui/              # React webview (separate build)
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    └── src/
        ├── index.tsx
        └── ...
```

## Step-by-Step Implementation

### Phase 1: Extension Scaffold & Auth

### Phase 2: Convex Integration & Credits

### Phase 3: AI Agent & Tool Execution

### Phase 4: Chat Webview UI

### Phase 5: Testing & Polish
