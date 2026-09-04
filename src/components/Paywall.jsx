/**
 * Paywall.jsx — shown when a non-premium user navigates to Planner or GCal.
 */
import React, { useState } from 'react';
import { supabase } from '../lib/supabase.js';
import '../styles/paywall.css';

const SUPABASE_URL       = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY  = import.meta.env.VITE_SUPABASE_ANON_KEY;

const IconLock = () => (
  <svg width="40" height="40" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true">
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

const IconCalendar = () => (
  <svg width="18" height="18" viewBox="0 0 16 16" fill="none"
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

const IconPlan = () => (
  <svg width="18" height="18" viewBox="0 0 16 16" fill="none"
    xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x="1.5" y="2.5" width="13" height="11" rx="2"
      stroke="currentColor" strokeWidth="1.4" fill="none"/>
    <path d="M1.5 6h13" stroke="currentColor" strokeWidth="1.2"/>
    <path d="M5 1.5v2M11 1.5v2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    <path d="M4.5 9h3M4.5 11.5h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
  </svg>
);

const FEATURES = [
  { Icon: IconPlan,     text: 'Drag-and-drop weekly Planner — schedule tasks into your actual days' },
  { Icon: IconCalendar, text: 'Google Calendar sync — see free time and push work blocks to your calendar' },
];

export default function Paywall({ featureName }) {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [plan,    setPlan]    = useState('yearly'); // 'monthly' | 'yearly'

  const handleUpgrade = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not signed in');

      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/create-checkout`,
        {
          method:  'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${session.access_token}`,
            'apikey':        SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ plan })
        },
      );

      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || 'Checkout failed');
      }

      const { url } = await res.json();
      if (url) {
        window.location.href = url;
      } else {
        throw new Error('No checkout URL returned');
      }
    } catch (err) {
      setError(err.message || 'Something went wrong');
      setLoading(false);
    }
  };

  return (
    <div className="paywall">
      <div className="paywall-inner">
        <div className="paywall-lock-icon">
          <IconLock />
        </div>

        <h2 className="paywall-title">
          {featureName} is a Premium feature
        </h2>

        <p className="paywall-subtitle">
          Upgrade to <strong>TaskTriage Premium</strong> to unlock the full
          planning experience.
        </p>

        <ul className="paywall-features">
          {FEATURES.map(({ Icon, text }) => (
            <li key={text} className="paywall-feature">
              <span className="paywall-feature-icon"><Icon /></span>
              <span>{text}</span>
            </li>
          ))}
        </ul>

        <div className="paywall-plan-toggle">
          <button
            className={`paywall-toggle-btn ${plan === 'monthly' ? 'active' : ''}`}
            onClick={() => setPlan('monthly')}
          >
            Monthly
          </button>
          <button
            className={`paywall-toggle-btn ${plan === 'yearly' ? 'active' : ''}`}
            onClick={() => setPlan('yearly')}
          >
            Yearly <span className="paywall-badge">Save 40%</span>
          </button>
        </div>

        <div className="paywall-price">
          {plan === 'yearly' ? (
            <>
              <span className="paywall-price-amount">$14.99</span>
              <span className="paywall-price-period">&nbsp;/ year</span>
            </>
          ) : (
            <>
              <span className="paywall-price-amount">$1.99</span>
              <span className="paywall-price-period">&nbsp;/ month</span>
            </>
          )}
        </div>

        <button
          className="btn btn-primary paywall-cta"
          onClick={handleUpgrade}
          disabled={loading}
        >
          {loading ? 'Redirecting to checkout…' : 'Start 7-day free trial'}
        </button>

        {error && (
          <p className="paywall-error">{error}</p>
        )}

        <p className="paywall-hint">
          Cancel any time. Billed through Stripe. Secure checkout.
        </p>
      </div>
    </div>
  );
}

