import React, { useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatMsg } from '../hooks/useVSCodeAPI';

interface ToolEvent {
  id: string;
  type: 'call' | 'result' | 'file';
  toolName?: string;
  filePath?: string;
  result?: string;
  isError?: boolean;
}

interface Props {
  messages: ChatMsg[];
  toolEvents: ToolEvent[];
  isStreaming: boolean;
}

export function MessageList({ messages, toolEvents, isStreaming }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, toolEvents]);

  if (messages.length === 0) {
    return (
      <div style={styles.emptyContainer}>
        <div style={styles.emptyIcon}>⚡</div>
        <p style={styles.emptyTitle}>Build fullstack mobile apps with AI</p>
        <p style={styles.emptySubtitle}>Describe what you want to build below</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}

      {toolEvents.length > 0 && (
        <div style={styles.toolSection}>
          {toolEvents.map((evt) => (
            <ToolEventBubble key={evt.id + evt.type} event={evt} />
          ))}
        </div>
      )}

      {isStreaming && (
        <div style={styles.streamingDots}>
          <span style={styles.dot} />
          <span style={{ ...styles.dot, animationDelay: '0.15s' }} />
          <span style={{ ...styles.dot, animationDelay: '0.3s' }} />
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMsg }) {
  const isUser = message.role === 'user';

  // Strip boltArtifact tags from displayed content
  const displayContent = message.content
    .replace(/<boltArtifact[^>]*>[\s\S]*?<\/boltArtifact>/g, '')
    .replace(/<boltAction[^>]*>[\s\S]*?<\/boltAction>/g, '')
    .trim();

  if (!displayContent) return null;

  return (
    <div style={isUser ? styles.userRow : styles.assistantRow}>
      {!isUser && <div style={styles.avatar}>⚡</div>}
      <div style={isUser ? styles.userBubble : styles.assistantBubble}>
        {isUser ? (
          <span>{displayContent}</span>
        ) : (
          <div className="markdown-content">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayContent}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

function ToolEventBubble({ event }: { event: ToolEvent }) {
  let icon = '🔧';
  let text = '';

  switch (event.type) {
    case 'call':
      text = `Running ${formatToolName(event.toolName)}...`;
      break;
    case 'result':
      if (event.isError) {
        icon = '❌';
        text = `Error: ${(event.result || '').substring(0, 120)}`;
      } else {
        icon = '✅';
        text = `${formatToolName(event.toolName)} completed`;
      }
      break;
    case 'file':
      icon = '📄';
      text = event.filePath || 'File written';
      break;
  }

  return (
    <div style={styles.toolBubble}>
      <span>{icon}</span>
      <span style={styles.toolText}>{text}</span>
    </div>
  );
}

function formatToolName(name?: string): string {
  switch (name) {
    case 'deploy': return 'Deploy';
    case 'npmInstall': return 'npm install';
    case 'view': return 'View file';
    case 'edit': return 'Edit file';
    case 'lookupDocs': return 'Looking up docs';
    case 'addEnvironmentVariables': return 'Environment variables';
    case 'getConvexDeploymentName': return 'Get deployment name';
    default: return name || 'Tool';
  }
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    flex: 1,
    overflowY: 'auto',
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  emptyContainer: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    padding: 32,
    opacity: 0.6,
  },
  emptyIcon: {
    fontSize: 40,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: 600,
    marginBottom: 4,
  },
  emptySubtitle: {
    fontSize: 12,
    opacity: 0.6,
  },

  userRow: {
    display: 'flex',
    justifyContent: 'flex-end',
  },
  assistantRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
  },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: '50%',
    background: '#FAD40B',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    flexShrink: 0,
    marginTop: 2,
  },
  userBubble: {
    background: 'var(--vscode-button-background, #0e639c)',
    color: 'var(--vscode-button-foreground, #fff)',
    padding: '8px 12px',
    borderRadius: '12px 12px 2px 12px',
    fontSize: 13,
    lineHeight: '1.5',
    maxWidth: '85%',
    wordBreak: 'break-word' as const,
  },
  assistantBubble: {
    background: 'var(--vscode-editor-background, #1e1e1e)',
    border: '1px solid var(--vscode-widget-border, rgba(255,255,255,0.1))',
    padding: '8px 12px',
    borderRadius: '2px 12px 12px 12px',
    fontSize: 13,
    lineHeight: '1.5',
    maxWidth: '95%',
    wordBreak: 'break-word' as const,
    overflow: 'hidden',
  },

  toolSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    paddingLeft: 32,
  },
  toolBubble: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    background: 'var(--vscode-textBlockQuote-background, rgba(255,255,255,0.04))',
    borderLeft: '3px solid #FAD40B',
    padding: '4px 10px',
    borderRadius: '0 6px 6px 0',
    fontSize: 12,
  },
  toolText: {
    opacity: 0.8,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },

  streamingDots: {
    display: 'flex',
    gap: 4,
    paddingLeft: 36,
    paddingTop: 4,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: 'var(--vscode-foreground, #ccc)',
    opacity: 0.3,
    animation: 'bna-pulse 0.8s ease-in-out infinite alternate',
  },
};

// Inject keyframes globally
if (typeof document !== 'undefined' && !document.getElementById('bna-keyframes')) {
  const style = document.createElement('style');
  style.id = 'bna-keyframes';
  style.textContent = `
    @keyframes bna-pulse {
      from { opacity: 0.2; transform: scale(0.8); }
      to   { opacity: 0.6; transform: scale(1.1); }
    }
  `;
  document.head.appendChild(style);
}
