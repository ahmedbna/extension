// web/src/components/MessageList.tsx
import React, { useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatItem, InitStep } from '../App';

interface Props {
  items: ChatItem[];
  onOpenFile: (filePath: string) => void;
  onSuggest?: (text: string) => void;
}

// ── Icon components (SVG only, no emoji) ─────────────────────────────────────

function IconCheck() {
  return (
    <svg
      width='10'
      height='10'
      viewBox='0 0 10 10'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <polyline points='1.5 5 4 7.5 8.5 2.5' />
    </svg>
  );
}

function IconX() {
  return (
    <svg
      width='10'
      height='10'
      viewBox='0 0 10 10'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <line x1='2' y1='2' x2='8' y2='8' />
      <line x1='8' y1='2' x2='2' y2='8' />
    </svg>
  );
}

function IconFile() {
  return (
    <svg
      width='11'
      height='11'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.8'
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' />
      <polyline points='14 2 14 8 20 8' />
    </svg>
  );
}

function IconPencil() {
  return (
    <svg
      width='11'
      height='11'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.8'
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <path d='M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7' />
      <path d='M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z' />
    </svg>
  );
}

function IconEye() {
  return (
    <svg
      width='11'
      height='11'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.8'
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <path d='M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z' />
      <circle cx='12' cy='12' r='3' />
    </svg>
  );
}

function IconDeploy() {
  return (
    <svg
      width='11'
      height='11'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.8'
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <polyline points='16 16 12 12 8 16' />
      <line x1='12' y1='12' x2='12' y2='21' />
      <path d='M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3' />
    </svg>
  );
}

function IconPackage() {
  return (
    <svg
      width='11'
      height='11'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.8'
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <line x1='16.5' y1='9.4' x2='7.5' y2='4.21' />
      <path d='M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z' />
      <polyline points='3.27 6.96 12 12.01 20.73 6.96' />
      <line x1='12' y1='22.08' x2='12' y2='12' />
    </svg>
  );
}

function IconDoc() {
  return (
    <svg
      width='11'
      height='11'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.8'
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <path d='M4 19.5A2.5 2.5 0 0 1 6.5 17H20' />
      <path d='M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z' />
    </svg>
  );
}

function IconGear() {
  return (
    <svg
      width='11'
      height='11'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.8'
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <circle cx='12' cy='12' r='3' />
      <path d='M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' />
    </svg>
  );
}

// ── Tool helpers ──────────────────────────────────────────────────────────────

function getToolIcon(toolName: string): React.ReactNode {
  switch (toolName) {
    case 'view':
      return <IconEye />;
    case 'edit':
      return <IconPencil />;
    case 'deploy':
      return <IconDeploy />;
    case 'npmInstall':
      return <IconPackage />;
    case 'lookupDocs':
    case 'lookupConvexDocsTool':
      return <IconDoc />;
    case 'addEnvironmentVariables':
      return <IconGear />;
    default:
      return <IconFile />;
  }
}

function getToolLabel(toolName: string, args?: any): string {
  switch (toolName) {
    case 'view': {
      if (args?.path) {
        const parts = String(args.path).split('/');
        return `View ${parts[parts.length - 1]}`;
      }
      return 'View file';
    }
    case 'edit': {
      if (args?.path) {
        const parts = String(args.path).split('/');
        return `Edit ${parts[parts.length - 1]}`;
      }
      return 'Edit file';
    }
    case 'deploy':
      return 'Deploy';
    case 'npmInstall':
      return args?.packages ? `Install ${args.packages}` : 'Install packages';
    case 'lookupDocs':
      return 'Lookup docs';
    case 'lookupConvexDocsTool':
      return 'Convex docs';
    case 'addEnvironmentVariables':
      return 'Environment variables';
    case 'getConvexDeploymentName':
      return 'Deployment name';
    default:
      return toolName;
  }
}

// Returns the file path from tool args, if applicable (for clickable rows)
function getToolFilePath(toolName: string, args?: any): string | null {
  if ((toolName === 'view' || toolName === 'edit') && args?.path) {
    return String(args.path);
  }
  return null;
}

// ── Strip boltArtifact from already-rendered content ─────────────────────────
// During streaming the parser handles this, but for historical messages we
// also strip here to be safe.

function cleanContent(content: string): string {
  let s = content;
  // 1. Remove complete artifact blocks (already closed)
  s = s.replace(/<boltArtifact[\s\S]*?<\/boltArtifact>/g, '');
  // 2. Remove unclosed artifact blocks (streaming not finished) — everything from
  //    the opening tag to end of string
  s = s.replace(/<boltArtifact[\s\S]*$/, '');
  // 3. Remove any stray boltAction blocks
  s = s.replace(/<boltAction[^>]*>[\s\S]*?<\/boltAction>/g, '');
  // 4. Remove trailing comma / semicolon artifact (lone punctuation on last line)
  s = s.replace(/[,;]\s*$/, '');
  return s.trim();
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ThinkingRow({ text }: { text: string }) {
  return (
    <div className='thinking-row'>
      <div className='thinking-dot' />
      <span className='thinking-shimmer'>{text || 'Thinking...'}</span>
    </div>
  );
}

function ToolRow({
  item,
  onOpenFile,
}: {
  item: Extract<ChatItem, { kind: 'tool-call' }>;
  onOpenFile: (f: string) => void;
}) {
  const label = getToolLabel(item.toolName, item.args);
  const icon = getToolIcon(item.toolName);
  const filePath = getToolFilePath(item.toolName, item.args);
  const isClickable = filePath !== null;

  const handleClick = () => {
    if (filePath) onOpenFile(filePath);
  };

  return (
    <div
      className={`tool-row ${isClickable ? 'tool-row--clickable' : ''}`}
      onClick={isClickable ? handleClick : undefined}
      title={isClickable ? `Open ${filePath}` : undefined}
    >
      <div className='tool-status-icon'>
        {item.status === 'running' && <div className='tool-spinner' />}
        {item.status === 'done' && (
          <div className='tool-check'>
            <IconCheck />
          </div>
        )}
        {item.status === 'error' && (
          <div className='tool-error-icon'>
            <IconX />
          </div>
        )}
      </div>
      <div className='tool-icon-label'>
        <span className='tool-icon-glyph'>{icon}</span>
        <span
          className={`tool-label ${item.status === 'running' ? 'tool-label--running' : ''} ${isClickable ? 'tool-label--link' : ''}`}
        >
          {label}
        </span>
      </div>
    </div>
  );
}

function FileWriteRow({
  item,
  onOpenFile,
}: {
  item: Extract<ChatItem, { kind: 'file-write' }>;
  onOpenFile: (f: string) => void;
}) {
  return (
    <div
      className='file-row file-row--clickable'
      onClick={() => onOpenFile(item.filePath)}
      title={`Open ${item.filePath}`}
    >
      <div className='file-row-icon'>
        <IconFile />
      </div>
      <span className='file-row-path'>{item.filePath}</span>
    </div>
  );
}

function InitPanel({ steps }: { steps: InitStep[] }) {
  const active = steps.find((s) => s.status === 'active');
  return (
    <div className='init-panel'>
      <div className='init-header'>
        <div className='init-spinner' />
        <span className='init-title'>
          {active?.label || 'Setting up project'}
        </span>
      </div>
      <div className='init-steps'>
        {steps.map((step) => (
          <div key={step.id} className='init-step'>
            <div className={`init-step-dot init-step-dot--${step.status}`} />
            <span className={`init-step-label init-step-label--${step.status}`}>
              {step.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function UserBubble({ content }: { content: string }) {
  return (
    <div className='msg-row msg-row--user'>
      <div className='msg-user-bubble'>{content}</div>
    </div>
  );
}

function AssistantBubble({ content }: { content: string }) {
  const display = cleanContent(content);
  if (!display) return null;
  return (
    <div className='msg-row msg-row--assistant'>
      <div className='msg-assistant-body'>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code({ node, inline, className, children, ...props }: any) {
              if (inline)
                return (
                  <code className='inline-code' {...props}>
                    {children}
                  </code>
                );
              return (
                <div className='code-fence'>
                  <code {...props}>{children}</code>
                </div>
              );
            },
          }}
        >
          {display}
        </ReactMarkdown>
      </div>
    </div>
  );
}

function ErrorRow({ text }: { text: string }) {
  return (
    <div className='error-row'>
      <div className='error-row-dot' />
      <span className='error-row-text'>{text}</span>
    </div>
  );
}

// ── Activity section wrapper ─────────────────────────────────────────────────
// Groups consecutive non-message items into a single padded section

function ActivitySection({ children }: { children: React.ReactNode }) {
  return <div className='activity-section'>{children}</div>;
}

// ── Empty state ───────────────────────────────────────────────────────────────

const SUGGESTIONS = [
  'Build a fitness tracker with workout plans',
  'Create a social app with real-time chat',
  'Make a habit tracker with streaks',
  'Build a recipe app with meal planning',
];

function EmptyState({ onSuggest }: { onSuggest?: (s: string) => void }) {
  return (
    <div className='empty-state'>
      <div className='empty-mark'>B</div>
      <p className='empty-title'>BNA</p>
      <p className='empty-desc'>Describe your app idea and I'll build it</p>
      <div className='empty-suggestions'>
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            className='suggestion-chip'
            onClick={() => onSuggest?.(s)}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

// Determine if a chat item should be wrapped in ActivitySection or is a standalone message
function isActivityItem(kind: ChatItem['kind']): boolean {
  return (
    kind === 'thinking' ||
    kind === 'tool-call' ||
    kind === 'file-write' ||
    kind === 'init-panel' ||
    kind === 'error-msg'
  );
}

export function MessageList({ items, onOpenFile, onSuggest }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [items]);

  const showEmpty = items.length === 0;
  if (showEmpty) return <EmptyState onSuggest={onSuggest} />;

  // Render items in order, grouping consecutive activity items together.
  // Each run of activity items (thinking, tools, file writes, etc.) between
  // message bubbles becomes one ActivitySection with a stable key.
  const rendered: React.ReactNode[] = [];
  let activityBuffer: ChatItem[] = [];
  let sectionIdx = 0;

  function flushActivity() {
    if (activityBuffer.length === 0) return;
    const sectionKey = `section-${sectionIdx++}`;
    const buf = activityBuffer.slice();
    rendered.push(
      <ActivitySection key={sectionKey}>
        {buf.map((item) => {
          switch (item.kind) {
            case 'thinking':
              return <ThinkingRow key={item.id} text={item.text} />;
            case 'tool-call':
              return (
                <ToolRow key={item.id} item={item} onOpenFile={onOpenFile} />
              );
            case 'file-write':
              return (
                <FileWriteRow
                  key={item.id}
                  item={item}
                  onOpenFile={onOpenFile}
                />
              );
            case 'init-panel':
              return <InitPanel key={item.id} steps={item.steps} />;
            case 'error-msg':
              return <ErrorRow key={item.id} text={item.text} />;
            default:
              return null;
          }
        })}
      </ActivitySection>,
    );
    activityBuffer = [];
  }

  for (const item of items) {
    if (isActivityItem(item.kind)) {
      activityBuffer.push(item);
    } else {
      flushActivity();
      switch (item.kind) {
        case 'user-msg':
          rendered.push(<UserBubble key={item.id} content={item.content} />);
          break;
        case 'assistant-msg':
          rendered.push(
            <AssistantBubble key={item.id} content={item.content} />,
          );
          break;
      }
    }
  }
  flushActivity();

  return (
    <div className='messages-scroll'>
      <div className='messages-inner'>
        {rendered}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
