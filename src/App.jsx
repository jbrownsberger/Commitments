import React, { useState, useEffect } from 'react';
import { Auth } from '@supabase/auth-ui-react';
import { ThemeSupa } from '@supabase/auth-ui-shared';
import { supabase } from './lib/supabase.js';
import { onAuthChange } from './lib/db.js';
import { useAppData } from './hooks/useAppData.js';
import Shell from './components/Shell.jsx';

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = loading

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, s) => setSession(s)
    );
    return () => subscription.unsubscribe();
  }, []);

  // Still checking session
  if (session === undefined) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh',
      fontSize: 13, color: 'var(--color-text-secondary)' }}>
      Loading…
    </div>
  );

  // Not signed in — show auth UI
  if (!session) return (
    <div style={{ maxWidth: 400, margin: '80px auto', padding: '0 1.5rem' }}>
      <h1 style={{ fontSize: 22, fontWeight: 500, marginBottom: '1.5rem' }}>Commitments</h1>
      <Auth
        supabaseClient={supabase}
        appearance={{ theme: ThemeSupa }}
        providers={['google']}
        magicLink={true}
        view="sign_in"
      />
    </div>
  );

  return <AuthedApp userId={session.user.id} userEmail={session.user.email} />;
}

function AuthedApp({ userId, userEmail }) {
  const appData = useAppData(userId);
  if (appData.loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh',
      fontSize: 13, color: 'var(--color-text-secondary)' }}>
      Loading your data…
    </div>
  );
  if (appData.error) return (
    <div style={{ maxWidth: 500, margin: '80px auto', padding: '0 1.5rem', color: 'var(--color-text-danger)' }}>
      <strong>Error loading data:</strong> {appData.error}
    </div>
  );
  return <Shell userId={userId} userEmail={userEmail} appData={appData} />;
}
