import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from './lib/supabase.js';
import { signInWithMagicLink, signInWithPassword, signUpWithPassword } from './lib/db.js';
import { useAppData } from './hooks/useAppData.js';
import Shell from './components/Shell.jsx';
import { loadFreeBusySnapshot, loadFreeBusy, saveFreeBusy, clearFreeBusy } from './lib/gcalAvailability.js';
import {
  connectGcal,
  isGcalConnected,
  loadGcalSettings,
  loadSelectedCals,
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

  if (session === undefined) return <Splash text="Loading\u2026" />;
  if (!session) return <LoginPage />;
  return <AuthedApp userId={session.user.id} userEmail={session.user.email} />;
}

// ── Small inline SVG icons (no emoji) ────────────────────────────────────────────────────────
const IconCalendar = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
    xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x="1.5" y="2.5" width="13" height="12" rx="2"
      stroke="currentColor" strokeWidth="1.4" fill="none"/>
    <path d="M1.5 6.5h13" stroke="currentColor" strokeWidth="1.3"/>
    <path d="M5 1.5v2M11 1.5v2" stroke="currentColor"
      strokeWidth="1.4" strokeLinecap="round"/>
    <circle cx="5.5" cy="10" r="0.9" fill="currentColor"/>
    <circle cx="8" cy="10" r="0.9" fill="currentColor"/>
    <circle cx="10.5" cy="10" r="0.9" fill="currentColor"/>
  </svg>
);

const IconClock = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
    xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.4"/>
    <path d="M8 4.5V8l2.5 1.5" stroke="currentColor"
      strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const IconBarChart = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
    xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x="1.5" y="8" width="3" height="5.5" rx="0.75"
      fill="currentColor" opacity="0.7"/>
    <rect x="6.5" y="5" width="3" height="8.5" rx="0.75"
      fill="currentColor"/>
    <rect x="11.5" y="2" width="3" height="11.5" rx="0.75"
      fill="currentColor" opacity="0.85"/>
  </svg>
);

const IconBolt = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
    xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M9.5 1.5L3.5 9h5l-2 5.5L14.5 7H9l.5-5.5z"
      stroke="currentColor" strokeWidth="1.35"
      strokeLinejoin="round" fill="none"/>
  </svg>
);

// ── Feature list ─────────────────────────────────────────────────────────────────────────
const FEATURES = [
  { Icon: IconCalendar, text: 'Track tasks with due dates, priorities, and progress' },
  { Icon: IconClock,    text: 'Schedule work across your calendar with a smart planner' },
  { Icon: IconBarChart, text: 'See real free time each day via Google Calendar sync' },
  { Icon: IconBolt,     text: 'Quick tasks for anything that only takes a few minutes' },
];

// ── Login page ───────────────────────────────────────────────────────────────────────────────────
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
            <img src="/logo.jpg" alt="Commitments logo" className="login-logo-img" />
          </div>
          <h1 className="login-hero-title">Commitments</h1>
          <p className="login-hero-tagline">
            A personal planning system that keeps your deadlines, tasks,
            and calendar in one honest view.
          </p>
          <ul className="login-features">
            {FEATURES.map(({ Icon, text }) => (
              <li key={text} className="login-feature-item">
                <span className="login-feature-icon"><Icon /></span>
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
            {mode === 'signup' ? 'Create account' : 'Sign in'}
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
              {loading            ? 'Please wait\u2026'   :
               mode === 'magic'    ? 'Send magic link' :
               mode === 'password' ? 'Sign in'         : 'Create account'}
            </button>
          </form>

          <p className="login-hint">
            {mode === 'magic'
              ? 'We\u2019ll email you a one-click sign-in link. No password needed.'
              : mode === 'signup'
              ? 'You\u2019ll receive a confirmation email before you can sign in.'
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

// ── Authed shell ───────────────────────────────────────────────────────────────────────────────────
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

  const [gcalFreeBusySnapshot, setGcalFreeBusySnapshot] = useState(() => loadFreeBusySnapshot());
  const gcalFreeBusy = gcalFreeBusySnapshot?.data || null;

  const onFreeBusyUpdate = (data, meta = {}) => {
    saveFreeBusy(data, meta);
    setGcalFreeBusySnapshot(loadFreeBusySnapshot());
  };

  const onFreeBusyClear = () => {
    clearFreeBusy();
    setGcalFreeBusySnapshot(null);
  };

  const [gcalConnected, setGcalConnected] = useState(false);

  // Check connection status once on mount (session is guaranteed to exist
  // since AuthedApp only renders when session is non-null).
  useEffect(() => {
    isGcalConnected().then(setGcalConnected);
  }, []);

  const onConnectionChange = useCallback((isConnected) => {
    setGcalConnected(isConnected);
  }, []);

  const gcalSettings = loadGcalSettings();
  const gcalSelCals  = [...loadSelectedCals()];

  if (appData.loading) return <Splash text="Loading your data\u2026" />;
  if (appData.error)   return (
    <div style={{ maxWidth: 500, margin: '80px auto', padding: '0 1.5rem',
      color: 'var(--color-text-danger)', fontSize: 13 }}>
      <strong>Error loading data:</strong> {appData.error}
    </div>
  );

  const enrichedAppData = {
    ...appData,
    gcalFreeBusy,
    gcalFreeBusySnapshot,
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
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 14,
      height: '100vh',
    }}>
      <div className="splash-spinner" />
      <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{text}</span>
    </div>
  );
}
