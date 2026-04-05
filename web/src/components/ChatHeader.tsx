// web/src/components/ChatHeader.tsx
import React from 'react';

interface Props {
  onNewChat: () => void;
  onConnectConvex: () => void;
  onSignOut: () => void;
}

export function ChatHeader({ onNewChat, onConnectConvex, onSignOut }: Props) {
  return (
    <div className='header'>
      <div className='header-brand'>
        <div className='header-badge'>B</div>
        <span className='header-title'>BNA</span>
      </div>
      <div className='header-actions'>
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
            strokeWidth='1.75'
            strokeLinecap='round'
            strokeLinejoin='round'
          >
            <path d='M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' />
            <path d='M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' />
          </svg>
        </button>
        <button className='header-btn' onClick={onNewChat} title='New chat'>
          <svg
            width='14'
            height='14'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth='1.75'
            strokeLinecap='round'
            strokeLinejoin='round'
          >
            <path d='M12 5v14M5 12h14' />
          </svg>
        </button>
        <button className='header-btn' onClick={onSignOut} title='Sign out'>
          <svg
            width='14'
            height='14'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth='1.75'
            strokeLinecap='round'
            strokeLinejoin='round'
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
