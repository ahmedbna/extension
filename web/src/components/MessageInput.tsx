// web/src/components/MessageInput.tsx
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

  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
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

  const canSend = !disabled && !isStreaming && value.trim().length > 0;

  return (
    <div className='input-area'>
      <div
        className={`input-wrapper ${isStreaming ? 'input-wrapper--streaming' : ''}`}
      >
        <textarea
          ref={textareaRef}
          className='input-textarea'
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            isStreaming
              ? 'Building your app...'
              : 'Describe what you want to build...'
          }
          disabled={disabled}
          rows={1}
        />
        <div className='input-actions'>
          {isStreaming ? (
            <button
              className='input-btn input-btn--stop'
              onClick={onStop}
              title='Stop generation'
            >
              <svg
                width='12'
                height='12'
                viewBox='0 0 12 12'
                fill='currentColor'
              >
                <rect x='1' y='1' width='10' height='10' rx='2' />
              </svg>
            </button>
          ) : (
            <button
              className={`input-btn input-btn--send ${canSend ? 'input-btn--active' : ''}`}
              onClick={handleSend}
              disabled={!canSend}
              title='Send message'
            >
              <svg
                width='14'
                height='14'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='2.5'
              >
                <line x1='12' y1='19' x2='12' y2='5' />
                <polyline points='5 12 12 5 19 12' />
              </svg>
            </button>
          )}
        </div>
      </div>
      <p className='input-hint'>
        {isStreaming
          ? 'Press Enter or click ■ to stop'
          : 'Enter to send · Shift+Enter for new line'}
      </p>
    </div>
  );
}
