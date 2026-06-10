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

  if (session === undefined) return <Splash text="Loading\u2026" />;
  if (!session) return <LoginPage />;
  return <AuthedApp userId={session.user.id} userEmail={session.user.email} />;
}

// ── Login page ────────────────────────────────────────────────────────────
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
    <div style={{ maxWidth: 380, margin: '80px auto', padding: '0 1.5rem' }}>
      <h1 style={{ fontSize: 22, fontWeight: 500, marginBottom: '0.25rem' }}>Commitments</h1>
      <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: '1.75rem' }}>
        Your personal task &amp; planning system.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: '1.25rem' }}>
        {[['magic','Magic link'],['password','Password'],['signup','Sign up']].map(([m, label]) => (
          <button key={m}
            className={`btn btn-sm${mode === m ? ' btn-primary' : ''}`}
            onClick={() => { setMode(m); setMsg(null); }}
          >{label}</button>
        ))}
      </div>

      <form onSubmit={submit}>
        <div className="form-field" style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display:'block', marginBottom:4 }}>Email</label>
          <input
            type="email" required
            value={email} onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            style={{ width: '100%', boxSizing: 'border-box' }}
          />
        </div>

        {(mode === 'password' || mode === 'signup') && (
          <div className="form-field" style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display:'block', marginBottom:4 }}>Password</label>
            <input
              type="password" required minLength={6}
              value={pw} onChange={e => setPw(e.target.value)}
              placeholder="Min. 6 characters"
              style={{ width: '100%', boxSizing: 'border-box' }}
            />
          </div>
        )}

        {msg && (
          <div style={{
            fontSize: 13, marginBottom: 12, padding: '8px 12px',
            borderRadius: 6,
            background: msg.type === 'error' ? 'var(--color-bg-danger)' : 'var(--color-bg-success)',
            color:      msg.type === 'error' ? 'var(--color-text-danger)' : 'var(--color-text-success)',
          }}>
            {msg.text}
          </div>
        )}

        <button
          type="submit"
          className="btn btn-primary"
          disabled={loading}
          style={{ width: '100%' }}
        >
          {loading ? 'Please wait\u2026' :
            mode === 'magic'    ? 'Send magic link' :
            mode === 'password' ? 'Sign in' : 'Create account'}
        </button>
      </form>
    </div>
  );
}

// ── Authed shell ──────────────────────────────────────────────────────────────
function AuthedApp({ userId, userEmail }) {
  const appData = useAppData(userId);

  // ── GCal free/busy ──────────────────────────────────────────────
  const [gcalFreeBusy, setGcalFreeBusy] = useState(() => loadFreeBusy());

  const onFreeBusyUpdate = (data) => {
    saveFreeBusy(data);
    setGcalFreeBusy(data);
  };

  const onFreeBusyClear = () => {
    clearFreeBusy();
    setGcalFreeBusy(null);
  };

  // ── GCal connection state ──────────────────────────────────────────
  const [gcalConnected, setGcalConnected] = useState(() => hasValidCachedToken());

  // Start silent refresh on mount if a valid token is already cached,
  // and stop it cleanly when the component unmounts.
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
      // User just connected — start the refresh cycle
      startSilentTokenRefresh((stillConnected) => {
        setGcalConnected(stillConnected);
      });
    } else {
      stopSilentTokenRefresh();
    }
  }, []);

  // ── GCal settings + selected calendars ────────────────────────────
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
    onFreeBusyUpdate,
    onFreeBusyClear,
    gcalConnected,
    onConnectionChange,
    gcalSettings,
    gcalSelCals,
  };

  return <Shell userId={userId} userEmail={userEmail} appData={enrichedAppData} />;
}

function Splash({ text }) {
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center',
      height:'100vh', fontSize: 13, color: 'var(--color-text-secondary)' }}>
      {text}
    </div>
  );
}
