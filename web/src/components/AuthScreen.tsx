// web/src/components/AuthScreen.tsx
import React, { useState } from 'react';

interface Props {
  onSignIn: () => void;
  authError?: string | null;
}

export function AuthScreen({ onSignIn, authError }: Props) {
  const [pending, setPending] = useState(false);

  const handle = () => {
    setPending(true);
    onSignIn();
    setTimeout(() => setPending(false), 60_000);
  };

  return (
    <div className='auth-screen'>
      <div className='auth-ambient' />
      <div className='auth-body'>
        <div className='auth-wordmark'>
          <div className='auth-wordmark-icon'>B</div>
          <span className='auth-wordmark-name'>BNA</span>
        </div>

        <div className='auth-copy'>
          <h2>Build Mobile Apps with AI</h2>
          <p>Expo + Convex, all from VS Code</p>
        </div>

        {authError && (
          <div className='auth-error-box'>
            <div className='auth-error-dot' />
            <span className='auth-error-text'>{authError}</span>
          </div>
        )}

        <button className='auth-cta' onClick={handle} disabled={pending}>
          {pending ? (
            <>
              <span className='auth-cta-spinner' />
              Waiting for browser...
            </>
          ) : (
            'Sign In to Get Started'
          )}
        </button>

        {pending && (
          <p className='auth-subtext'>
            Complete sign-in in your browser, then return here
          </p>
        )}
      </div>
    </div>
  );
}
