// web/src/components/ShimmerStatus.tsx
// Text shimmer effect with dropdown showing files being updated

import React, { useState } from 'react';
import type { FileWriteEvent, ToolCallEvent, StreamStatus } from '../App';

interface Props {
  streamStatus: StreamStatus;
  statusText: string;
  fileWrites: FileWriteEvent[];
  toolCalls: ToolCallEvent[];
}

const TOOL_ICONS: Record<string, string> = {
  deploy: '🚀',
  npmInstall: '📦',
  view: '👁',
  edit: '✏️',
  lookupDocs: '📚',
  lookupConvexDocsTool: '📖',
  addEnvironmentVariables: '🔑',
  getConvexDeploymentName: '🔍',
};

const TOOL_LABELS: Record<string, string> = {
  deploy: 'Deploy',
  npmInstall: 'Install packages',
  view: 'View file',
  edit: 'Edit file',
  lookupDocs: 'Lookup docs',
  lookupConvexDocsTool: 'Convex docs',
  addEnvironmentVariables: 'Env vars',
  getConvexDeploymentName: 'Deployment name',
};

export function ShimmerStatus({
  streamStatus,
  statusText,
  fileWrites,
  toolCalls,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  const isActive = streamStatus !== 'idle' && streamStatus !== 'error';
  const hasActivity = fileWrites.length > 0 || toolCalls.length > 0;

  if (!isActive && !hasActivity) return null;

  const activeToolCalls = toolCalls.filter((t) => t.status === 'running');
  const currentActivity = activeToolCalls[0];
  const displayText = currentActivity
    ? TOOL_LABELS[currentActivity.toolName] || currentActivity.toolName
    : statusText || 'Working...';

  return (
    <div
      className={`shimmer-container ${expanded ? 'shimmer-container--expanded' : ''}`}
    >
      <button
        className='shimmer-header'
        onClick={() => hasActivity && setExpanded((e) => !e)}
        style={{ cursor: hasActivity ? 'pointer' : 'default' }}
      >
        <div className='shimmer-left'>
          {isActive && <span className='shimmer-pulse-dot' />}
          <span
            className={`shimmer-text ${isActive ? 'shimmer-text--active' : ''}`}
          >
            {displayText}
          </span>
        </div>

        {hasActivity && (
          <div className='shimmer-right'>
            <span className='shimmer-count'>
              {fileWrites.length > 0 &&
                `${fileWrites.length} file${fileWrites.length !== 1 ? 's' : ''}`}
              {fileWrites.length > 0 && toolCalls.length > 0 && ', '}
              {toolCalls.length > 0 &&
                `${toolCalls.filter((t) => t.status === 'done').length}/${toolCalls.length} tools`}
            </span>
            <span
              className={`shimmer-chevron ${expanded ? 'shimmer-chevron--up' : ''}`}
            >
              ‹
            </span>
          </div>
        )}
      </button>

      {expanded && hasActivity && (
        <div className='shimmer-dropdown'>
          {toolCalls.length > 0 && (
            <div className='shimmer-section'>
              <div className='shimmer-section-label'>Tool calls</div>
              {toolCalls.map((tc) => (
                <div
                  key={tc.id}
                  className={`shimmer-item shimmer-item--tool shimmer-item--${tc.status}`}
                >
                  <span className='shimmer-item-icon'>
                    {tc.status === 'running' ? (
                      <span className='shimmer-spinner' />
                    ) : tc.status === 'error' ? (
                      '✗'
                    ) : (
                      '✓'
                    )}
                  </span>
                  <span className='shimmer-item-icon-emoji'>
                    {TOOL_ICONS[tc.toolName] || '🔧'}
                  </span>
                  <span className='shimmer-item-name'>
                    {TOOL_LABELS[tc.toolName] || tc.toolName}
                  </span>
                </div>
              ))}
            </div>
          )}

          {fileWrites.length > 0 && (
            <div className='shimmer-section'>
              <div className='shimmer-section-label'>Files updated</div>
              {fileWrites.map((fw) => (
                <div key={fw.id} className='shimmer-item shimmer-item--file'>
                  <span className='shimmer-item-icon shimmer-item-icon--file'>
                    📄
                  </span>
                  <span className='shimmer-item-path'>{fw.filePath}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
