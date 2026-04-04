// web/src/components/AuthScreen.tsx
import React, { useState } from 'react';

interface Props {
  onSignIn: () => void;
  authError?: string | null;
}

export function AuthScreen({ onSignIn, authError }: Props) {
  const [isSigningIn, setIsSigningIn] = useState(false);

  const handleSignIn = () => {
    setIsSigningIn(true);
    onSignIn();
    setTimeout(() => setIsSigningIn(false), 60_000);
  };

  return (
    <div className='auth-screen'>
      <div className='auth-glow' />
      <div className='auth-content'>
        <div className='auth-logo'>
          <div className='auth-logo-icon'>⚡</div>
          <span className='auth-logo-text'>BNA</span>
        </div>

        <div className='auth-headline'>
          <h1>
            Build Fullstack
            <br />
            Mobile Apps
          </h1>
          <p>Expo + Convex + AI — all in one place</p>
        </div>

        {authError && (
          <div className='auth-error'>
            <span className='auth-error-icon'>⚠</span>
            <span>{authError}</span>
          </div>
        )}

        <button
          className={`auth-btn ${isSigningIn ? 'auth-btn--loading' : ''}`}
          onClick={handleSignIn}
          disabled={isSigningIn}
        >
          {isSigningIn ? (
            <>
              <span className='auth-btn-spinner' />
              Waiting for browser...
            </>
          ) : (
            <>
              <span>Sign In to Get Started</span>
              <span className='auth-btn-arrow'>→</span>
            </>
          )}
        </button>

        {isSigningIn && (
          <p className='auth-hint'>
            Complete sign-in in your browser, then return here
          </p>
        )}
      </div>
    </div>
  );
}
