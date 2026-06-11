import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from './lib/supabase.js';
import { signInWithMagicLink, signInWithPassword, signUpWithPassword } from './lib/db.js';
import { useAppData } from './hooks/useAppData.js';
import Shell from './components/Shell.jsx';
import { loadFreeBusy, saveFreeBusy, clearFreeBusy } from './lib/gcalAvailability.js';
import {
  hasValidCachedToken,
  loadGcalSettings,
  loadSelectedCals,
  startSilentTokenRefresh,
  stopSilentTokenRefresh,
} from './lib/gcalScheduler.js';

export default function App() {
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, s) => setSession(s)
    );
    return () => subscription.unsubscribe();
  }, []);

  if (session === undefined) return <Splash text="Loading…" />;
  if (!session) return <LoginPage />;
  return <AuthedApp userId={session.user.id} userEmail={session.user.email} />;
}

// ── Feature list shown on the login hero ───────────────────────────────────────────
const FEATURES = [
  { icon: '📅', text: 'Track tasks with due dates, priorities, and progress' },
  { icon: '⏰', text: 'Schedule work across your calendar with a smart planner' },
  { icon: '📊', text: 'See real free time each day via Google Calendar sync' },
  { icon: '⚡', text: 'Quick tasks for anything that only takes a few minutes' },
];

// ── Login page ────────────────────────────────────────────────────────────────────
function LoginPage() {
  const [mode,    setMode]    = useState('magic');
  const [email,   setEmail]   = useState('');
  const [pw,      setPw]      = useState('');
  const [msg,     setMsg]     = useState(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setMsg(null);
    setLoading(true);
    try {
      if (mode === 'magic') {
        const { error } = await signInWithMagicLink(email);
        if (error) throw error;
        setMsg({ type: 'success', text: 'Check your email for a sign-in link!' });
      } else if (mode === 'password') {
        const { error } = await signInWithPassword(email, pw);
        if (error) throw error;
      } else {
        const { error } = await signUpWithPassword(email, pw);
        if (error) throw error;
        setMsg({ type: 'success', text: 'Account created! Check your email to confirm, then sign in.' });
        setMode('password');
      }
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      {/* ── Left: hero ── */}
      <div className="login-hero">
        <div className="login-hero-inner">
          <div className="login-logo">
            <svg width="36" height="36" viewBox="0 0 36 36" fill="none"
              xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <rect width="36" height="36" rx="9" fill="currentColor" opacity="0.12"/>
              <rect x="7" y="8" width="22" height="20" rx="3"
                stroke="currentColor" strokeWidth="1.8" fill="none"/>
              <path d="M7 14h22" stroke="currentColor" strokeWidth="1.6"/>
              <path d="M12 6v4M24 6v4"
                stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              <path d="M12 20l3.5 3.5L24 17"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h1 className="login-hero-title">Commitments</h1>
          <p className="login-hero-tagline">
            A personal planning system that keeps your deadlines, tasks,
            and calendar in one honest view.
          </p>
          <ul className="login-features">
            {FEATURES.map(({ icon, text }) => (
              <li key={text} className="login-feature-item">
                <span className="login-feature-icon">{icon}</span>
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* ── Right: auth card ── */}
      <div className="login-card-wrap">
        <div className="login-card">
          <h2 className="login-card-title">
            {mode === 'signup' ? 'Create account' :
             mode === 'magic'  ? 'Sign in' : 'Sign in'}
          </h2>

          <div className="login-mode-tabs">
            {[['magic','Magic link'], ['password','Password'], ['signup','Sign up']].map(([m, label]) => (
              <button
                key={m}
                className={`login-mode-tab${mode === m ? ' active' : ''}`}
                onClick={() => { setMode(m); setMsg(null); }}
              >{label}</button>
            ))}
          </div>

          <form onSubmit={submit} className="login-form">
            <div className="login-field">
              <label className="login-label">Email</label>
              <input
                type="email" required
                value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="login-input"
              />
            </div>

            {(mode === 'password' || mode === 'signup') && (
              <div className="login-field">
                <label className="login-label">Password</label>
                <input
                  type="password" required minLength={6}
                  value={pw} onChange={e => setPw(e.target.value)}
                  placeholder="Min. 6 characters"
                  className="login-input"
                />
              </div>
            )}

            {msg && (
              <div className={`login-msg login-msg--${msg.type}`}>{msg.text}</div>
            )}

            <button
              type="submit"
              className="btn btn-primary login-submit"
              disabled={loading}
            >
              {loading       ? 'Please wait…'   :
               mode === 'magic'    ? 'Send magic link' :
               mode === 'password' ? 'Sign in'         : 'Create account'}
            </button>
          </form>

          <p className="login-hint">
            {mode === 'magic'
              ? 'We’ll email you a one-click sign-in link. No password needed.'
              : mode === 'signup'
              ? 'You’ll receive a confirmation email before you can sign in.'
              : null}
          </p>
        </div>

        {/* ── Footer links ── */}
        <div className="login-footer">
          <a href="/privacy.html" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
          <span className="login-footer-sep">&middot;</span>
          <a href="/terms.html"   target="_blank" rel="noopener noreferrer">Terms of Service</a>
          <span className="login-footer-sep">&middot;</span>
          <a href="https://github.com/jbrownsberger/Commitments"
             target="_blank" rel="noopener noreferrer">GitHub</a>
        </div>
      </div>
    </div>
  );
}

// ── Authed shell ──────────────────────────────────────────────────────────────────
function AuthedApp({ userId, userEmail }) {
  const appData = useAppData(userId);

  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    if (appData.preferences && appData.preferences.dark_mode !== undefined) {
      setDarkMode(!!appData.preferences.dark_mode);
    }
  }, [appData.preferences]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  const toggleDarkMode = useCallback(async () => {
    const next = !darkMode;
    setDarkMode(next);
    await appData.savePreferences({ ...appData.preferences, dark_mode: next });
  }, [darkMode, appData]);

  const [gcalFreeBusy, setGcalFreeBusy] = useState(() => loadFreeBusy());

  const onFreeBusyUpdate = (data) => {
    saveFreeBusy(data);
    setGcalFreeBusy(data);
  };

  const onFreeBusyClear = () => {
    clearFreeBusy();
    setGcalFreeBusy(null);
  };

  const [gcalConnected, setGcalConnected] = useState(() => hasValidCachedToken());

  useEffect(() => {
    if (hasValidCachedToken()) {
      startSilentTokenRefresh((isConnected) => {
        setGcalConnected(isConnected);
      });
    }
    return () => stopSilentTokenRefresh();
  }, []);

  const onConnectionChange = useCallback((isConnected) => {
    setGcalConnected(isConnected);
    if (isConnected) {
      startSilentTokenRefresh((stillConnected) => {
        setGcalConnected(stillConnected);
      });
    } else {
      stopSilentTokenRefresh();
    }
  }, []);

  const gcalSettings = loadGcalSettings();
  const gcalSelCals  = [...loadSelectedCals()];

  if (appData.loading) return <Splash text="Loading your data…" />;
  if (appData.error)   return (
    <div style={{ maxWidth: 500, margin: '80px auto', padding: '0 1.5rem',
      color: 'var(--color-text-danger)', fontSize: 13 }}>
      <strong>Error loading data:</strong> {appData.error}
    </div>
  );

  const enrichedAppData = {
    ...appData,
    gcalFreeBusy,
    onFreeBusyUpdate,
    onFreeBusyClear,
    gcalConnected,
    onConnectionChange,
    gcalSettings,
    gcalSelCals,
  };

  return <Shell
    userId={userId}
    userEmail={userEmail}
    appData={enrichedAppData}
    darkMode={darkMode}
    onToggleDarkMode={toggleDarkMode}
  />;
}

function Splash({ text }) {
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center',
      height:'100vh', fontSize: 13, color: 'var(--color-text-secondary)' }}>
      {text}
    </div>
  );
}
