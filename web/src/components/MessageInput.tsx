// web/src/components/MessageInput.tsx
import React, { useRef, useEffect, useCallback } from 'react';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  disabled: boolean;
}

export function MessageInput({
  value,
  onChange,
  onSend,
  onStop,
  isStreaming,
  disabled,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    }
  }, [value]);

  // Focus when suggestion populates the field
  useEffect(() => {
    if (value && ref.current && document.activeElement !== ref.current) {
      ref.current.focus();
      // Move cursor to end
      const len = ref.current.value.length;
      ref.current.setSelectionRange(len, len);
    }
  }, [value]);

  const send = useCallback(() => {
    const t = value.trim();
    if (!t || disabled || isStreaming) return;
    onSend(t);
  }, [value, disabled, isStreaming, onSend]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (isStreaming) {
        onStop();
      } else {
        send();
      }
    }
  };

  const canSend = !disabled && !isStreaming && value.trim().length > 0;

  return (
    <div className='input-area'>
      <div className={`input-box ${isStreaming ? 'input-box--streaming' : ''}`}>
        <textarea
          ref={ref}
          className='input-textarea'
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKey}
          placeholder={
            isStreaming ? 'Generating...' : 'Describe what you want to build...'
          }
          disabled={disabled}
          rows={1}
        />
        {isStreaming ? (
          <button className='input-stop-btn' onClick={onStop} title='Stop'>
            <svg width='10' height='10' viewBox='0 0 10 10' fill='currentColor'>
              <rect x='1' y='1' width='8' height='8' rx='1.5' />
            </svg>
          </button>
        ) : (
          <button
            className={`input-send-btn ${canSend ? 'input-send-btn--active' : ''}`}
            onClick={send}
            disabled={!canSend}
            title='Send'
          >
            <svg
              width='13'
              height='13'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='2.25'
              strokeLinecap='round'
              strokeLinejoin='round'
            >
              <line x1='12' y1='19' x2='12' y2='5' />
              <polyline points='5 12 12 5 19 12' />
            </svg>
          </button>
        )}
      </div>
      <p className='input-hint'>Enter to send · Shift+Enter for new line</p>
    </div>
  );
}
