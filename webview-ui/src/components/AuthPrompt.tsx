import React from 'react';

interface Props {
  onSignIn: () => void;
}

export function AuthPrompt({ onSignIn }: Props) {
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

      <button style={styles.signInBtn} onClick={onSignIn}>
        Sign In to Get Started
      </button>

      <p style={styles.note}>
        Opens your browser for secure authentication
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
    marginBottom: 16,
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
  },
  note: {
    fontSize: 11,
    opacity: 0.35,
    marginTop: 8,
  },
};
