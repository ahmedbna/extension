// web/src/App.tsx
// Modern Cursor-like chat UI with shimmer effects and file update dropdowns

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

export interface FileWriteEvent {
  id: string;
  filePath: string;
  timestamp: number;
}

export interface ToolCallEvent {
  id: string;
  toolCallId: string;
  toolName: string;
  status: 'running' | 'done' | 'error';
  result?: string;
  timestamp: number;
}

export function App() {
  const api = useVSCodeAPI();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>('idle');
  const [statusText, setStatusText] = useState('');
  const [fileWrites, setFileWrites] = useState<FileWriteEvent[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCallEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const streamingMsgIdRef = useRef<string | null>(null);
  const streamingTextRef = useRef('');

  const handleExtensionMessage = useCallback(
    (msg: ExtensionMessage) => {
      switch (msg.type) {
        case 'init': {
          setIsAuthenticated(msg.isAuthenticated);
          setAuthError(null);
          if (msg.isAuthenticated && msg.messages?.length) {
            setMessages(msg.messages);
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
          streamingMsgIdRef.current = null;
          streamingTextRef.current = '';
          break;
        }

        case 'streamText': {
          if (streamStatus !== 'streaming') setStreamStatus('streaming');
          setError(null);

          if (!streamingMsgIdRef.current) {
            const id = `assistant-${Date.now()}`;
            streamingMsgIdRef.current = id;
            streamingTextRef.current = '';
            setMessages((prev) => [
              ...prev,
              { id, role: 'assistant', content: '' },
            ]);
          }

          streamingTextRef.current += msg.text;
          const currentId = streamingMsgIdRef.current;
          const currentText = streamingTextRef.current;

          setMessages((prev) =>
            prev.map((m) =>
              m.id === currentId ? { ...m, content: currentText } : m,
            ),
          );
          break;
        }

        case 'toolCall': {
          if (msg.toolName === 'deploy') setStreamStatus('deploying');
          setStatusText(formatToolStatus(msg.toolName));
          setToolCalls((prev) => [
            ...prev,
            {
              id: `tc-${Date.now()}`,
              toolCallId: msg.toolCallId,
              toolName: msg.toolName,
              status: 'running',
              timestamp: Date.now(),
            },
          ]);
          break;
        }

        case 'toolResult': {
          setToolCalls((prev) =>
            prev.map((tc) =>
              tc.toolCallId === msg.toolCallId
                ? {
                    ...tc,
                    status: msg.isError ? 'error' : 'done',
                    result: msg.result,
                  }
                : tc,
            ),
          );
          break;
        }

        case 'fileWrite': {
          setFileWrites((prev) => [
            ...prev,
            {
              id: `fw-${Date.now()}`,
              filePath: msg.filePath || '',
              timestamp: Date.now(),
            },
          ]);
          break;
        }

        case 'status': {
          setStatusText(msg.text || '');
          if (msg.text && streamStatus === 'idle') setStreamStatus('thinking');
          break;
        }

        case 'streamEnd': {
          setStreamStatus('idle');
          setStatusText('');
          streamingMsgIdRef.current = null;
          streamingTextRef.current = '';
          // Clear tool events after a delay
          setTimeout(() => {
            setFileWrites([]);
            setToolCalls([]);
          }, 5000);
          break;
        }

        case 'error': {
          setStreamStatus('error');
          setError(msg.error || 'Something went wrong');
          streamingMsgIdRef.current = null;
          streamingTextRef.current = '';
          break;
        }

        case 'chatReset': {
          setMessages([]);
          setFileWrites([]);
          setToolCalls([]);
          setStreamStatus('idle');
          setStatusText('');
          setError(null);
          streamingMsgIdRef.current = null;
          streamingTextRef.current = '';
          break;
        }
      }
    },
    [streamStatus],
  );

  useExtensionMessages(handleExtensionMessage);

  useEffect(() => {
    api.postMessage({ type: 'ready' });
  }, []);

  const handleSend = useCallback(
    (text: string) => {
      const id = `user-${Date.now()}`;
      setMessages((prev) => [...prev, { id, role: 'user', content: text }]);
      setStreamStatus('thinking');
      setStatusText('Thinking...');
      setError(null);
      setFileWrites([]);
      setToolCalls([]);
      api.sendMessage(text);
    },
    [api],
  );

  const handleStop = useCallback(() => {
    api.stopGeneration();
    setStreamStatus('idle');
    setStatusText('');
  }, [api]);

  if (isAuthenticated === null) {
    return (
      <div className='loading-screen'>
        <div className='loading-logo'>⚡</div>
        <div className='loading-dots'>
          <span />
          <span />
          <span />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <AuthScreen onSignIn={api.signIn} authError={authError} />;
  }

  return (
    <div className='app'>
      <ChatHeader
        onNewChat={api.newChat}
        onConnectConvex={api.connectConvex}
        onSignOut={api.signOut}
      />

      <MessageList
        messages={messages}
        toolCalls={toolCalls}
        fileWrites={fileWrites}
        streamStatus={streamStatus}
        statusText={statusText}
        error={error}
      />

      <MessageInput
        onSend={handleSend}
        onStop={handleStop}
        isStreaming={streamStatus !== 'idle' && streamStatus !== 'error'}
        disabled={false}
      />
    </div>
  );
}

function formatToolStatus(toolName: string): string {
  switch (toolName) {
    case 'deploy':
      return 'Deploying to Convex...';
    case 'npmInstall':
      return 'Installing packages...';
    case 'view':
      return 'Reading file...';
    case 'edit':
      return 'Editing file...';
    case 'lookupDocs':
      return 'Looking up docs...';
    case 'lookupConvexDocsTool':
      return 'Looking up Convex docs...';
    case 'addEnvironmentVariables':
      return 'Setting env vars...';
    case 'getConvexDeploymentName':
      return 'Getting deployment name...';
    default:
      return `Running ${toolName}...`;
  }
}
