// web/src/components/ChatHeader.tsx
import React from 'react';

interface Props {
  onNewChat: () => void;
  onConnectConvex: () => void;
  onSignOut: () => void;
}

export function ChatHeader({ onNewChat, onConnectConvex, onSignOut }: Props) {
  return (
    <div className='chat-header'>
      <div className='chat-header-brand'>
        <span className='chat-header-icon'>⚡</span>
        <span className='chat-header-name'>BNA</span>
      </div>
      <div className='chat-header-actions'>
        <button
          className='header-btn'
          onClick={onConnectConvex}
          title='Connect Convex'
        >
          <svg
            width='14'
            height='14'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth='2'
          >
            <path d='M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' />
            <path d='M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' />
          </svg>
        </button>
        <button className='header-btn' onClick={onNewChat} title='New Chat'>
          <svg
            width='14'
            height='14'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth='2'
          >
            <path d='M12 5v14M5 12h14' />
          </svg>
        </button>
        <button className='header-btn' onClick={onSignOut} title='Sign Out'>
          <svg
            width='14'
            height='14'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth='2'
          >
            <path d='M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4' />
            <polyline points='16 17 21 12 16 7' />
            <line x1='21' y1='12' x2='9' y2='12' />
          </svg>
        </button>
      </div>
    </div>
  );
}
