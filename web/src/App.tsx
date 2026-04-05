// web/src/App.tsx
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  useVSCodeAPI,
  useExtensionMessages,
  type ExtensionMessage,
  type ChatMsg,
} from './hooks/useVSCodeAPI';
import { ChatHeader } from './components/ChatHeader';
import { MessageList } from './components/MessageList';
import { MessageInput } from './components/MessageInput';
import { AuthScreen } from './components/AuthScreen';

export type StreamStatus =
  | 'idle'
  | 'thinking'
  | 'streaming'
  | 'deploying'
  | 'error';

export interface InitStep {
  id: string;
  label: string;
  status: 'done' | 'active' | 'pending';
}

export type ChatItem =
  | { kind: 'user-msg'; id: string; content: string }
  | { kind: 'assistant-msg'; id: string; content: string }
  | { kind: 'thinking'; id: string; text: string }
  | {
      kind: 'tool-call';
      id: string;
      toolCallId: string;
      toolName: string;
      args?: any;
      status: 'running' | 'done' | 'error';
      result?: string;
    }
  | { kind: 'file-write'; id: string; filePath: string }
  | { kind: 'init-panel'; id: string; steps: InitStep[] }
  | { kind: 'error-msg'; id: string; text: string };

const INIT_STEP_PATTERNS = [
  { pattern: /initializ|project|template/i, stepId: 'init' },
  { pattern: /install|npm|package/i, stepId: 'install' },
  { pattern: /convex/i, stepId: 'convex' },
  { pattern: /auth/i, stepId: 'auth' },
];

const INIT_STEP_DEFS: InitStep[] = [
  { id: 'init', label: 'Initializing project', status: 'pending' },
  { id: 'install', label: 'Installing packages', status: 'pending' },
  { id: 'convex', label: 'Connecting Convex', status: 'pending' },
  { id: 'auth', label: 'Setting up auth', status: 'pending' },
];

const THINKING_ID = '__thinking__';
const INIT_PANEL_ID = '__init__';

export function App() {
  const api = useVSCodeAPI();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>('idle');
  const [items, setItems] = useState<ChatItem[]>([]);
  const streamingMsgId = useRef<string | null>(null);
  const streamingText = useRef('');

  const upsertItem = useCallback((item: ChatItem) => {
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.id === item.id);
      if (idx === -1) return [...prev, item];
      const next = [...prev];
      next[idx] = item;
      return next;
    });
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const patchToolCall = useCallback(
    (
      toolCallId: string,
      patch: Partial<Extract<ChatItem, { kind: 'tool-call' }>>,
    ) => {
      setItems((prev) =>
        prev.map((item) =>
          item.kind === 'tool-call' && item.toolCallId === toolCallId
            ? { ...item, ...patch }
            : item,
        ),
      );
    },
    [],
  );

  const patchInitSteps = useCallback(
    (updater: (steps: InitStep[]) => InitStep[]) => {
      setItems((prev) =>
        prev.map((item) =>
          item.kind === 'init-panel'
            ? { ...item, steps: updater(item.steps) }
            : item,
        ),
      );
    },
    [],
  );

  const handleExtensionMessage = useCallback(
    (msg: ExtensionMessage) => {
      switch (msg.type) {
        case 'init': {
          setIsAuthenticated(msg.isAuthenticated);
          setAuthError(null);
          if (msg.isAuthenticated && msg.messages?.length) {
            setItems(
              (msg.messages as ChatMsg[]).map(
                (m) =>
                  ({
                    kind:
                      m.role === 'user'
                        ? 'user-msg'
                        : ('assistant-msg' as ChatItem['kind']),
                    id: m.id,
                    content: m.content,
                  }) as ChatItem,
              ),
            );
          }
          break;
        }
        case 'authState': {
          setIsAuthenticated(msg.isAuthenticated);
          if (msg.isAuthenticated) setAuthError(null);
          break;
        }
        case 'authRequired': {
          setIsAuthenticated(false);
          setAuthError(msg.error || 'Session expired. Please sign in again.');
          setStreamStatus('idle');
          removeItem(THINKING_ID);
          streamingMsgId.current = null;
          streamingText.current = '';
          break;
        }
        case 'streamText': {
          setStreamStatus('streaming');
          if (!streamingMsgId.current) {
            const id = `assistant-${Date.now()}`;
            streamingMsgId.current = id;
            streamingText.current = '';
            // Atomically: remove thinking + insert new assistant message
            setItems((prev) => [
              ...prev.filter((i) => i.id !== THINKING_ID),
              { kind: 'assistant-msg', id, content: '' },
            ]);
          }
          streamingText.current += msg.text;
          const cid = streamingMsgId.current;
          const ct = streamingText.current;
          setItems((prev) =>
            prev.map((item) =>
              item.kind === 'assistant-msg' && item.id === cid
                ? { ...item, content: ct }
                : item,
            ),
          );
          break;
        }
        case 'toolCall': {
          if (msg.toolName === 'deploy') setStreamStatus('deploying');
          // Atomically: remove thinking row + insert tool call in same state update
          setItems((prev) => [
            ...prev.filter((i) => i.id !== THINKING_ID),
            {
              kind: 'tool-call',
              id: `tc-${msg.toolCallId}`,
              toolCallId: msg.toolCallId,
              toolName: msg.toolName,
              args: msg.args,
              status: 'running',
            } as ChatItem,
          ]);
          break;
        }
        case 'toolResult': {
          patchToolCall(msg.toolCallId, {
            status: msg.isError ? 'error' : 'done',
            result: msg.result,
          });
          upsertItem({
            kind: 'thinking',
            id: THINKING_ID,
            text: 'Thinking...',
          });
          break;
        }
        case 'fileWrite': {
          // Atomically: remove thinking row + insert file-write in same state update
          setItems((prev) => [
            ...prev.filter((i) => i.id !== THINKING_ID),
            {
              kind: 'file-write',
              id: `fw-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              filePath: msg.filePath || '',
            } as ChatItem,
          ]);
          break;
        }
        case 'status': {
          const text = msg.text || '';
          setStreamStatus((s) => (s === 'idle' ? 'thinking' : s));
          upsertItem({ kind: 'thinking', id: THINKING_ID, text });
          const matched = INIT_STEP_PATTERNS.find((p) => p.pattern.test(text));
          if (matched) {
            setItems((prev) => {
              if (prev.some((i) => i.id === INIT_PANEL_ID)) return prev;
              const thinkIdx = prev.findIndex((i) => i.id === THINKING_ID);
              const panel: ChatItem = {
                kind: 'init-panel',
                id: INIT_PANEL_ID,
                steps: INIT_STEP_DEFS.map((s) => ({ ...s })),
              };
              if (thinkIdx === -1) return [...prev, panel];
              const next = [...prev];
              next.splice(thinkIdx, 0, panel);
              return next;
            });
            patchInitSteps((steps) => {
              const idx = steps.findIndex((s) => s.id === matched.stepId);
              if (idx === -1) return steps;
              return steps.map((s, i) => ({
                ...s,
                status: (i < idx
                  ? 'done'
                  : i === idx
                    ? 'active'
                    : 'pending') as InitStep['status'],
              }));
            });
          }
          break;
        }
        case 'streamEnd': {
          setStreamStatus('idle');
          removeItem(THINKING_ID);
          streamingMsgId.current = null;
          streamingText.current = '';
          patchInitSteps((steps) =>
            steps.map((s) => ({ ...s, status: 'done' as const })),
          );
          setTimeout(() => removeItem(INIT_PANEL_ID), 5000);
          break;
        }
        case 'error': {
          setStreamStatus('error');
          removeItem(THINKING_ID);
          streamingMsgId.current = null;
          streamingText.current = '';
          setItems((prev) => [
            ...prev,
            {
              kind: 'error-msg',
              id: `err-${Date.now()}`,
              text: msg.error || 'Something went wrong',
            } as ChatItem,
          ]);
          break;
        }
        case 'chatReset': {
          setItems([]);
          setStreamStatus('idle');
          streamingMsgId.current = null;
          streamingText.current = '';
          break;
        }
      }
    },
    [upsertItem, removeItem, patchToolCall, patchInitSteps],
  );

  useExtensionMessages(handleExtensionMessage);

  useEffect(() => {
    api.postMessage({ type: 'ready' });
  }, []);

  const handleSend = useCallback(
    (text: string) => {
      setItems((prev) => [
        ...prev,
        { kind: 'user-msg', id: `user-${Date.now()}`, content: text },
        { kind: 'thinking', id: THINKING_ID, text: 'Thinking...' },
      ]);
      setStreamStatus('thinking');
      api.sendMessage(text);
    },
    [api],
  );

  const handleStop = useCallback(() => {
    api.stopGeneration();
    setStreamStatus('idle');
    removeItem(THINKING_ID);
  }, [api, removeItem]);

  if (isAuthenticated === null)
    return (
      <div className='loading-screen'>
        <div className='loading-mark' />
      </div>
    );
  if (!isAuthenticated)
    return <AuthScreen onSignIn={api.signIn} authError={authError} />;

  const isGenerating = streamStatus !== 'idle' && streamStatus !== 'error';

  return (
    <div className='app'>
      <ChatHeader
        onNewChat={() => {
          setItems([]);
          setStreamStatus('idle');
          api.newChat();
        }}
        onConnectConvex={api.connectConvex}
        onSignOut={api.signOut}
      />
      <MessageList
        items={items}
        onOpenFile={api.openFile}
        onSuggest={handleSend}
      />
      <MessageInput
        value={isGenerating ? 'Build Todo App' : ''}
        onChange={() => {}}
        onSend={handleSend}
        onStop={handleStop}
        isStreaming={isGenerating}
        disabled={false}
      />
    </div>
  );
}
