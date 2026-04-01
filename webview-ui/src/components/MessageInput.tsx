import React, { useState, useRef, useEffect, useCallback } from 'react';

interface Props {
  onSend: (text: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  disabled: boolean;
}

export function MessageInput({ onSend, onStop, isStreaming, disabled }: Props) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  }, [value]);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
  }, [value, disabled, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (isStreaming) {
        onStop();
      } else {
        handleSend();
      }
    }
  };

  return (
    <div style={styles.container}>
      <textarea
        ref={textareaRef}
        style={styles.textarea}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={isStreaming ? 'Building...' : 'Describe what you want to build...'}
        disabled={disabled}
        rows={1}
      />
      <button
        style={{
          ...styles.sendBtn,
          ...(isStreaming ? styles.stopBtn : {}),
          ...((disabled || (!isStreaming && !value.trim())) ? styles.disabledBtn : {}),
        }}
        onClick={isStreaming ? onStop : handleSend}
        disabled={disabled || (!isStreaming && !value.trim())}
      >
        {isStreaming ? '■' : '↑'}
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: 6,
    background: 'rgba(255,255,255,0.04)',
    borderRadius: 10,
    border: '1px solid var(--vscode-input-border, rgba(255,255,255,0.1))',
    padding: '6px 6px 6px 12px',
  },
  textarea: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    color: 'var(--vscode-foreground)',
    fontSize: 13,
    lineHeight: '1.5',
    resize: 'none',
    outline: 'none',
    fontFamily: 'inherit',
    minHeight: 24,
    maxHeight: 200,
    padding: '2px 0',
  },
  sendBtn: {
    width: 28,
    height: 28,
    borderRadius: '50%',
    border: 'none',
    background: '#FAD40B',
    color: '#000',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    transition: 'opacity 0.15s',
  },
  stopBtn: {
    background: 'rgba(255,255,255,0.1)',
    color: 'var(--vscode-foreground)',
    border: '1px solid rgba(255,255,255,0.15)',
    fontSize: 10,
  },
  disabledBtn: {
    opacity: 0.3,
    cursor: 'not-allowed',
  },
};
