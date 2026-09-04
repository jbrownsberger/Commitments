import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from './lib/supabase.js';
import {
  signInWithMagicLink,
  signInWithPassword,
  signUpWithPassword,
  resetPasswordForEmail,
  updatePassword,
} from './lib/db.js';
import { useAppData } from './hooks/useAppData.js';
import Shell from './components/Shell.jsx';
import { loadFreeBusySnapshot, loadFreeBusy, saveFreeBusy, clearFreeBusy } from './lib/gcalAvailability.js';
import {
  connectGcal,
  isGcalConnected,
  loadGcalSettings,
  loadSelectedCals,
} from './lib/gcalScheduler.js';
import { GCAL_PREFS_CHANGED_EVENT } from './lib/gcalPrefs.js';
import './styles/login.css';

export default function App() {
  const [session,          setSession]          = useState(undefined);
  const [isRecoveryMode,   setIsRecoveryMode]   = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, s) => {
        if (event === 'PASSWORD_RECOVERY') {
          setSession(s);
          setIsRecoveryMode(true);
        } else {
          setIsRecoveryMode(false);
          setSession(s);
        }
      }
    );
    return () => subscription.unsubscribe();
  }, []);

  if (session === undefined) return <Splash text="Loading…" />;
  if (isRecoveryMode && session) return <ResetPasswordPage />;
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

// ── Small inline SVG icons (additional) ──────────────────────────────────────────────────
const IconRepeat = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
    xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M11.5 1.5l2 2-2 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M2.5 7.5v-1a3 3 0 013-3h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    <path d="M4.5 14.5l-2-2 2-2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M13.5 8.5v1a3 3 0 01-3 3h-8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
  </svg>
);

const IconBell = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
    xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M6 13.5a2 2 0 004 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    <path d="M3.5 7a4.5 4.5 0 019 0c0 2.5.5 3.5 1.5 5H2c1-.9 1.5-2.5 1.5-5z"
      stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" fill="none"/>
  </svg>
);

// ── Feature list ─────────────────────────────────────────────────────────────────────────
const FEATURES = [
  { Icon: IconBolt,     title: 'Urgency Score',       text: 'A 0–100 score based on deadlines and effort surfaces what needs attention right now.' },
  { Icon: IconCalendar, title: 'Weekly Planner',       text: 'Drag-and-drop tasks onto days, or Auto-fill to build a balanced schedule instantly.' },
  { Icon: IconClock,    title: 'Google Calendar',      text: 'See free time from your calendars and push work blocks directly to Google Calendar.' },
  { Icon: IconRepeat,   title: 'Recurring Tasks',      text: 'Rolling resets or pre-dated series — daily, weekly, monthly, or custom intervals.' },
  { Icon: IconBell,     title: 'Push Notifications',   text: 'Daily digest of overdue and upcoming work, delivered at the hour you choose.' },
  { Icon: IconBarChart, title: 'AI Assistant (MCP)',    text: 'Connect any MCP-compatible AI for hands-free task creation and management.' },
];

// ── Login page ───────────────────────────────────────────────────────────────────────────────────
function LoginPage() {
  // mode: 'magic' | 'password' | 'signup' | 'forgot'
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
      } else if (mode === 'signup') {
        const { error } = await signUpWithPassword(email, pw);
        if (error) throw error;
        setMsg({
          type: 'success',
          text: 'Account created! Please check your email and click the confirmation link before signing in.',
        });
        setMode('password');
      } else if (mode === 'forgot') {
        const { error } = await resetPasswordForEmail(email);
        if (error) throw error;
        setMsg({ type: 'success', text: 'Password reset email sent — check your inbox.' });
      }
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const modeLabel = {
    magic:    'Sign in',
    password: 'Sign in',
    signup:   'Create account',
    forgot:   'Reset password',
  }[mode];

  return (
    <div className="login-page">
      {/* ── Hero ── */}
      <div className="login-hero">
        <div className="login-hero-inner">
          <div className="login-brand">
            <span className="login-brand-mark"><img src="/logo.png" alt="TaskTriage logo" className="login-logo-img" /></span>
            <span>TaskTriage</span>
          </div>
          <p className="login-eyebrow">Workload-aware deadline tracker</p>
          <h1 className="login-hero-title">Stop guessing.<br />Start triaging.</h1>
          <p className="login-hero-tagline">
            Most to-do apps let you pile on tasks forever. <strong>TaskTriage</strong> calculates a live <strong>Urgency Score</strong>, tracks your real capacity, and turns a chaotic pile of tasks into a time-blocked weekly plan you can actually follow.
          </p>
          <div className="login-preview" aria-hidden="true">
            <div className="today-plan-panel">
              <div className="today-plan-title">
                <div style={{display:'flex', alignItems:'center', gap:8}}>
                  <img src="/logo.png" alt="" style={{width: 14, height: 14, objectFit: 'contain'}} />
                  <span>Today's plan</span>
                </div>
                <span className="today-plan-total">3.5h</span>
              </div>
              
              <div className="today-plan-item" style={{'--today-task-color': '#4F6B5E'}}>
                <div className="today-plan-dot" />
                <div className="today-plan-content">
                  <div className="today-plan-name done">Draft project brief</div>
                  <div className="today-plan-meta">1.0h planned today</div>
                </div>
                <span className="task-check done">✓</span>
              </div>

              <div className="today-plan-item" style={{'--today-task-color': '#B85B57'}}>
                <div className="today-plan-dot" />
                <div className="today-plan-content">
                  <div className="today-plan-name">Prepare client review</div>
                  <div className="today-plan-meta in-progress">In progress · 2.0h planned today</div>
                </div>
                <span className="task-check in-progress"></span>
              </div>

              <div className="today-plan-item" style={{ borderBottom: 'none', '--today-task-color': '#658375' }}>
                <div className="today-plan-dot" />
                <div className="today-plan-content">
                  <div className="today-plan-name">Research next steps</div>
                  <div className="today-plan-meta">0.5h planned today</div>
                </div>
                <span className="task-check"></span>
              </div>
            </div>
          </div>
          <ul className="login-features">
            {FEATURES.map(({ Icon, title, text }) => (
              <li key={title} className="login-feature-item">
                <span className="login-feature-icon"><Icon /></span>
                <span><strong>{title}</strong>{text}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* ── Right: auth card ── */}
      <div className="login-card-wrap">
        <div className="login-card">
          <h2 className="login-card-title">
            {modeLabel}
          </h2>

          {mode !== 'forgot' && (
            <div className="login-mode-tabs">
              {[['magic','Magic link'], ['password','Password'], ['signup','Sign up']].map(([m, label]) => (
                <button
                  key={m}
                  className={`login-mode-tab${mode === m ? ' active' : ''}`}
                  onClick={() => { setMode(m); setMsg(null); }}
                >{label}</button>
              ))}
            </div>
          )}

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
              {loading             ? 'Please wait…'        :
               mode === 'magic'    ? 'Send magic link'     :
               mode === 'password' ? 'Sign in'             :
               mode === 'signup'   ? 'Create account'      :
                                     'Send reset email'}
            </button>
          </form>

          {/* Forgot password link (shown in password mode) */}
          {mode === 'password' && (
            <button
              className="login-forgot-link"
              onClick={() => { setMode('forgot'); setMsg(null); }}
            >
              Forgot password?
            </button>
          )}

          {/* Back to sign in (shown in forgot mode) */}
          {mode === 'forgot' && (
            <button
              className="login-forgot-link"
              onClick={() => { setMode('password'); setMsg(null); }}
            >
              ← Back to sign in
            </button>
          )}

          <p className="login-hint">
            {mode === 'magic'
              ? "We'll email you a one-click sign-in link. No password needed."
              : mode === 'signup'
              ? "You'll receive a confirmation email. Click the link inside to activate your account."
              : mode === 'forgot'
              ? "We'll send a password reset link to your email."
              : null}
          </p>
        </div>

        {/* ── Footer links ── */}
        <div className="login-footer">
          <a href="/privacy.html" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
          <span className="login-footer-sep">&middot;</span>
          <a href="/terms.html"   target="_blank" rel="noopener noreferrer">Terms of Service</a>
          <span className="login-footer-sep">&middot;</span>
          <a href="https://github.com/jbrownsberger/TaskTriage"
             target="_blank" rel="noopener noreferrer">GitHub</a>
        </div>
      </div>
    </div>
  );
}

// ── Reset password page (shown after clicking email recovery link) ──────────────
function ResetPasswordPage() {
  const [pw,      setPw]      = useState('');
  const [pw2,     setPw2]     = useState('');
  const [msg,     setMsg]     = useState(null);
  const [loading, setLoading] = useState(false);
  const [done,    setDone]    = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (pw !== pw2) {
      setMsg({ type: 'error', text: "Passwords don't match." });
      return;
    }
    setLoading(true);
    setMsg(null);
    try {
      const { error } = await updatePassword(pw);
      if (error) throw error;
      setDone(true);
      setMsg({ type: 'success', text: 'Password updated! Redirecting…' });
      setTimeout(() => window.location.assign('/'), 2000);
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-hero">
        <div className="login-hero-inner">
          <div className="login-brand">
            <span className="login-brand-mark"><img src="/logo.png" alt="TaskTriage logo" className="login-logo-img" /></span>
            <span>TaskTriage</span>
          </div>
          <h1 className="login-hero-title">Set a new<br />password.</h1>
          <p className="login-hero-tagline">
            Choose a strong password (at least 6 characters) to protect your account.
          </p>
        </div>
      </div>

      <div className="login-card-wrap">
        <div className="login-card">
          <h2 className="login-card-title" style={{ fontFamily: 'inherit' }}>
            Set new password
          </h2>

          {!done && (
            <form onSubmit={submit} className="login-form" style={{ marginTop: '1.5rem' }}>
              <div className="login-field">
                <label className="login-label">New password</label>
                <input
                  type="password" required minLength={6}
                  value={pw} onChange={e => setPw(e.target.value)}
                  placeholder="Min. 6 characters"
                  className="login-input"
                />
              </div>
              <div className="login-field">
                <label className="login-label">Confirm new password</label>
                <input
                  type="password" required minLength={6}
                  value={pw2} onChange={e => setPw2(e.target.value)}
                  placeholder="Repeat password"
                  className="login-input"
                />
              </div>
              {msg && (
                <div className={`login-msg login-msg--${msg.type}`}>{msg.text}</div>
              )}
              <button
                type="submit"
                className="btn btn-primary login-submit"
                disabled={loading}
              >
                {loading ? 'Saving…' : 'Update password'}
              </button>
            </form>
          )}

          {done && msg && (
            <div className={`login-msg login-msg--${msg.type}`} style={{ marginTop: '1.5rem' }}>
              {msg.text}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Authed shell ───────────────────────────────────────────────────────────────────────────────────
function AuthedApp({ userId, userEmail }) {
  const appData = useAppData(userId);

  // Settings live in localStorage for fast access, then hydrate from Supabase.
  // Re-render the planner and overview when either source updates them.
  const [, refreshGcalPrefs] = useState(0);
  useEffect(() => {
    const refresh = () => refreshGcalPrefs(version => version + 1);
    window.addEventListener(GCAL_PREFS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(GCAL_PREFS_CHANGED_EVENT, refresh);
  }, []);

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

  if (appData.loading) return <Splash text="Loading your data…" />;
  if (appData.error)   return (
    <div style={{ maxWidth: 500, margin: '80px auto', padding: '0 1.5rem',
      color: 'var(--color-text-danger)', fontSize: 13 }}>
      <strong>Error loading data:</strong> {appData.error}
      <div style={{ marginTop: 16 }}>
        <button className="btn btn-primary" onClick={appData.retryLoad}>
          Try again
        </button>
      </div>
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
