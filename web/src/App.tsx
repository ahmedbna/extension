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
import { StatusIndicator } from './components/StatusIndicator';
import { AuthPrompt } from './components/AuthPrompt';

type StreamStatus = 'ready' | 'streaming' | 'error';

interface ToolEvent {
  id: string;
  type: 'call' | 'result' | 'file';
  toolName?: string;
  filePath?: string;
  result?: string;
  isError?: boolean;
}

export function App() {
  const api = useVSCodeAPI();

  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null); // null = loading
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>('ready');
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const streamingTextRef = useRef('');
  const streamingMsgIdRef = useRef<string | null>(null);

  const handleExtensionMessage = useCallback((msg: ExtensionMessage) => {
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
        if (msg.isAuthenticated) {
          setAuthError(null);
        }
        break;
      }

      case 'authRequired': {
        // Session expired — show auth screen with message
        setIsAuthenticated(false);
        setAuthError(
          msg.error || 'Your session has expired. Please sign in again.',
        );
        setStreamStatus('ready');
        streamingMsgIdRef.current = null;
        streamingTextRef.current = '';
        break;
      }

      case 'streamText': {
        setStreamStatus('streaming');
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
        setToolEvents((prev) => [
          ...prev,
          { id: msg.toolCallId, type: 'call', toolName: msg.toolName },
        ]);
        break;
      }

      case 'toolResult': {
        setToolEvents((prev) => [
          ...prev,
          {
            id: msg.toolCallId,
            type: 'result',
            result: msg.result,
            isError: msg.isError,
          },
        ]);
        break;
      }

      case 'fileWrite': {
        setToolEvents((prev) => [
          ...prev,
          { id: `file-${Date.now()}`, type: 'file', filePath: msg.filePath },
        ]);
        break;
      }

      case 'streamEnd': {
        setStreamStatus('ready');
        streamingMsgIdRef.current = null;
        streamingTextRef.current = '';
        setTimeout(() => setToolEvents([]), 3000);
        break;
      }

      case 'error': {
        setStreamStatus('error');
        setError(msg.error);
        streamingMsgIdRef.current = null;
        streamingTextRef.current = '';
        break;
      }

      case 'chatReset': {
        setMessages([]);
        setToolEvents([]);
        setStreamStatus('ready');
        setError(null);
        streamingMsgIdRef.current = null;
        streamingTextRef.current = '';
        break;
      }
    }
  }, []);

  useExtensionMessages(handleExtensionMessage);

  useEffect(() => {
    api.postMessage({ type: 'ready' });
  }, [api]);

  const handleSend = useCallback(
    (text: string) => {
      const id = `user-${Date.now()}`;
      setMessages((prev) => [...prev, { id, role: 'user', content: text }]);
      setStreamStatus('streaming');
      setError(null);
      setToolEvents([]);
      api.sendMessage(text);
    },
    [api],
  );

  const handleStop = useCallback(() => {
    api.stopGeneration();
    setStreamStatus('ready');
  }, [api]);

  const handleSignIn = useCallback(() => {
    setAuthError(null);
    api.signIn();
  }, [api]);

  // Loading state — show nothing until we know auth status
  if (isAuthenticated === null) {
    return (
      <div style={styles.loading}>
        <span style={{ fontSize: 24 }}>⚡</span>
        <p style={{ opacity: 0.4, fontSize: 12 }}>Loading...</p>
      </div>
    );
  }

  // Not authenticated — show sign in
  if (!isAuthenticated) {
    return <AuthPrompt onSignIn={handleSignIn} authError={authError} />;
  }

  return (
    <div style={styles.container}>
      <ChatHeader
        onNewChat={api.newChat}
        onConnectConvex={api.connectConvex}
        onSignOut={api.signOut}
      />

      <MessageList
        messages={messages}
        toolEvents={toolEvents}
        isStreaming={streamStatus === 'streaming'}
      />

      <div style={styles.bottom}>
        {(streamStatus === 'streaming' || streamStatus === 'error') && (
          <StatusIndicator
            status={streamStatus}
            error={error}
            onRetry={() => {
              const lastUser = [...messages]
                .reverse()
                .find((m) => m.role === 'user');
              if (lastUser) {
                handleSend(lastUser.content);
              }
            }}
          />
        )}

        <MessageInput
          onSend={handleSend}
          onStop={handleStop}
          isStreaming={streamStatus === 'streaming'}
          disabled={false}
        />
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    overflow: 'hidden',
  },
  bottom: {
    flexShrink: 0,
    padding: '8px 12px 12px',
    borderTop: '1px solid var(--vscode-widget-border, rgba(255,255,255,0.1))',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  loading: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    gap: 8,
  },
};
