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
import { GCAL_PREFS_CHANGED_EVENT } from './lib/gcalPrefs.js';
import './styles/login.css';

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
  { Icon: IconCalendar, title: 'See the whole week', text: 'Bring deadlines, scheduled work, and calendar availability into one clear plan.' },
  { Icon: IconClock,    title: 'Make time for what matters', text: 'Turn a long task list into realistic blocks of work that fit your actual days.' },
  { Icon: IconBarChart, title: 'Stay ahead of deadlines', text: 'Track progress and spot overloaded weeks before they become a last-minute scramble.' },
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
      {/* ── Intro ── */}
      <div className="login-hero">
        <div className="login-hero-inner">
          <div className="login-brand">
            <span className="login-brand-mark"><img src="/logo.png" alt="Commitments logo" className="login-logo-img" /></span>
            <span>Commitments</span>
          </div>
          <p className="login-eyebrow">A calmer way to plan</p>
          <h1 className="login-hero-title">Keep every promise<br />in view.</h1>
          <p className="login-hero-tagline">
            Commitments is a workload-aware planner for the things you need to get done.
            It pairs your tasks and deadlines with the time you really have, so your plan
            stays useful when life gets busy.
          </p>
          <div className="login-preview" aria-hidden="true">
            <div className="login-preview-topbar">
              <img src="/logo.png" alt="" className="login-preview-logo" />
              <span>Today’s plan</span>
              <span className="login-preview-date">Tue, Aug 19</span>
            </div>
            <div className="login-preview-body">
              <div className="login-preview-task complete"><span>✓</span> Draft project brief <small>Done</small></div>
              <div className="login-preview-task"><span /> Prepare client review <small>2h · Thu</small></div>
              <div className="login-preview-task"><span /> Research next steps <small>45m · Today</small></div>
              <div className="login-preview-focus"><span>Focus time</span><strong>2h 45m available</strong></div>
            </div>
          </div>
          <ul className="login-features">
            {FEATURES.map(({ Icon, title, text }) => (
              <li key={text} className="login-feature-item">
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
              {loading            ? 'Please wait…'   :
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
