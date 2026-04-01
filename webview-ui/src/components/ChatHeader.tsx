import React from 'react';

interface Props {
  onNewChat: () => void;
  onConnectConvex: () => void;
}

export function ChatHeader({ onNewChat, onConnectConvex }: Props) {
  return (
    <div style={styles.header}>
      <div style={styles.left}>
        <div style={styles.logo}>⚡</div>
        <span style={styles.title}>BNA</span>
      </div>
      <div style={styles.right}>
        <button style={styles.btn} onClick={onConnectConvex} title="Connect Convex">
          🔗
        </button>
        <button style={styles.btn} onClick={onNewChat} title="New Chat">
          ＋
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    borderBottom: '1px solid var(--vscode-widget-border, rgba(255,255,255,0.1))',
    flexShrink: 0,
  },
  left: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  logo: {
    fontSize: 18,
  },
  title: {
    fontWeight: 800,
    fontSize: 15,
    letterSpacing: '-0.03em',
  },
  right: {
    display: 'flex',
    gap: 4,
  },
  btn: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    color: 'var(--vscode-foreground)',
    borderRadius: 6,
    padding: '4px 8px',
    cursor: 'pointer',
    fontSize: 13,
  },
};
