import React, { useState } from 'react';

interface Props {
  onSignIn: () => void;
  authError?: string | null;
}

export function AuthPrompt({ onSignIn, authError }: Props) {
  const [isSigningIn, setIsSigningIn] = useState(false);

  const handleSignIn = () => {
    setIsSigningIn(true);
    onSignIn();
    // Reset after timeout in case sign-in doesn't complete
    setTimeout(() => setIsSigningIn(false), 60000);
  };

  return (
    <div style={styles.container}>
      <div style={styles.logoSection}>
        <div style={styles.logo}>⚡</div>
        <h1 style={styles.title}>BNA</h1>
      </div>

      <h2 style={styles.subtitle}>Build Fullstack Mobile Apps</h2>
      <p style={styles.description}>
        Sign in to start building Expo + Convex apps with AI
      </p>

      {authError && (
        <div style={styles.errorBanner}>
          <span style={styles.errorIcon}>⚠</span>
          <span style={styles.errorText}>{authError}</span>
        </div>
      )}

      <button
        style={{
          ...styles.signInBtn,
          ...(isSigningIn ? styles.signInBtnDisabled : {}),
        }}
        onClick={handleSignIn}
        disabled={isSigningIn}
      >
        {isSigningIn
          ? 'Waiting for browser...'
          : authError
            ? 'Sign In to Continue'
            : 'Sign In to Get Started'}
      </button>

      <p style={styles.note}>
        {isSigningIn
          ? 'Complete sign-in in your browser, then return here'
          : 'Opens your browser for secure authentication'}
      </p>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    padding: 32,
    textAlign: 'center',
    gap: 8,
  },
  logoSection: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  logo: {
    fontSize: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: 900,
    letterSpacing: '-0.04em',
    margin: 0,
  },
  subtitle: {
    fontSize: 16,
    fontWeight: 700,
    margin: 0,
  },
  description: {
    fontSize: 13,
    opacity: 0.6,
    maxWidth: 240,
    lineHeight: '1.5',
    marginBottom: 8,
  },
  errorBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    background: 'rgba(239, 68, 68, 0.1)',
    border: '1px solid rgba(239, 68, 68, 0.25)',
    borderRadius: 8,
    padding: '8px 14px',
    marginBottom: 8,
    maxWidth: 280,
  },
  errorIcon: {
    color: '#ef4444',
    fontSize: 14,
    flexShrink: 0,
  },
  errorText: {
    color: 'rgba(239, 68, 68, 0.9)',
    fontSize: 12,
    textAlign: 'left' as const,
    lineHeight: '1.4',
  },
  signInBtn: {
    background: '#FAD40B',
    color: '#000',
    border: 'none',
    borderRadius: 10,
    padding: '12px 28px',
    fontWeight: 700,
    fontSize: 14,
    cursor: 'pointer',
    transition: 'opacity 0.15s',
    marginTop: 4,
  },
  signInBtnDisabled: {
    opacity: 0.6,
    cursor: 'wait',
  },
  note: {
    fontSize: 11,
    opacity: 0.35,
    marginTop: 8,
    maxWidth: 240,
    lineHeight: '1.4',
  },
};
