// web/src/components/MessageList.tsx
import React, { useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ShimmerStatus } from './ShimmerStatus';
import type { ChatMsg } from '../hooks/useVSCodeAPI';
import type { FileWriteEvent, ToolCallEvent, StreamStatus } from '../App';

interface Props {
  messages: ChatMsg[];
  toolCalls: ToolCallEvent[];
  fileWrites: FileWriteEvent[];
  streamStatus: StreamStatus;
  statusText: string;
  error: string | null;
}

export function MessageList({
  messages,
  toolCalls,
  fileWrites,
  streamStatus,
  statusText,
  error,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, toolCalls, fileWrites, streamStatus]);

  if (messages.length === 0 && streamStatus === 'idle') {
    return (
      <div className='messages-empty'>
        <div className='empty-logo'>⚡</div>
        <h2 className='empty-title'>BNA</h2>
        <p className='empty-subtitle'>Describe your app idea to get started</p>
        <div className='empty-suggestions'>
          {SUGGESTIONS.map((s) => (
            <div key={s} className='empty-suggestion'>
              {s}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className='messages-container'>
      <div className='messages-inner'>
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        <ShimmerStatus
          streamStatus={streamStatus}
          statusText={statusText}
          fileWrites={fileWrites}
          toolCalls={toolCalls}
        />

        {error && (
          <div className='error-banner'>
            <span className='error-banner-icon'>⚠</span>
            <span className='error-banner-text'>{error}</span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
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

  if (isUser) {
    return (
      <div className='msg-row msg-row--user'>
        <div className='msg-bubble msg-bubble--user'>
          <p>{displayContent}</p>
        </div>
      </div>
    );
  }

  return (
    <div className='msg-row msg-row--assistant'>
      <div className='msg-avatar'>⚡</div>
      <div className='msg-bubble msg-bubble--assistant'>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code({ node, inline, className, children, ...props }: any) {
              if (inline) {
                return (
                  <code className='code-inline' {...props}>
                    {children}
                  </code>
                );
              }
              return (
                <div className='code-block-wrapper'>
                  <code className={`code-block ${className || ''}`} {...props}>
                    {children}
                  </code>
                </div>
              );
            },
          }}
        >
          {displayContent}
        </ReactMarkdown>
      </div>
    </div>
  );
}

const SUGGESTIONS = [
  'Build a fitness tracker with workout plans',
  'Create a social app with real-time chat',
  'Make a todo app with Convex backend',
  'Build an e-commerce app with products',
];
