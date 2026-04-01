import React from 'react';

interface Props {
  status: 'streaming' | 'error';
  error: string | null;
  onRetry: () => void;
}

export function StatusIndicator({ status, error, onRetry }: Props) {
  if (status === 'streaming') {
    return (
      <div style={styles.container}>
        <div style={styles.dot} />
        <span style={styles.text}>Building...</span>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div style={{ ...styles.container, ...styles.errorContainer }}>
        <span style={styles.errorIcon}>⚠</span>
        <span style={styles.errorText}>{error || 'Something went wrong'}</span>
        <button style={styles.retryBtn} onClick={onRetry}>
          Retry
        </button>
      </div>
    );
  }

  return null;
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 10px',
    borderRadius: 8,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.06)',
    fontSize: 12,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: '#FAD40B',
    animation: 'bna-pulse 1s ease-in-out infinite alternate',
  },
  text: {
    opacity: 0.5,
    flex: 1,
  },
  errorContainer: {
    background: 'rgba(239,68,68,0.08)',
    border: '1px solid rgba(239,68,68,0.2)',
  },
  errorIcon: {
    color: '#ef4444',
  },
  errorText: {
    color: 'rgba(239,68,68,0.8)',
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  retryBtn: {
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.1)',
    color: 'var(--vscode-foreground)',
    borderRadius: 6,
    padding: '2px 10px',
    fontSize: 11,
    cursor: 'pointer',
    flexShrink: 0,
  },
};
