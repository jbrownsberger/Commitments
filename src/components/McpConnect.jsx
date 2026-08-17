import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

const MCP_TOKEN_FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mcp-token`;
const MCP_ENDPOINT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mcp`;

/**
 * Lets the signed-in user generate, view, and revoke personal MCP tokens
 * used to connect Commitments to Perplexity (or any MCP-compatible client)
 * as a custom remote connector.
 */
export default function McpConnect() {
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [newToken, setNewToken] = useState(null);
  const [label, setLabel] = useState('');
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  const authedFetch = useCallback(async (method, body) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token;
    if (!accessToken) throw new Error('Not signed in.');

    const res = await fetch(MCP_TOKEN_FN_URL + (method === 'DELETE' && body?.id ? `?id=${body.id}` : ''), {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
    });

    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      throw new Error(payload.error || `Request failed (${res.status})`);
    }
    return res.json();
  }, []);

  const loadTokens = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await authedFetch('GET');
      setTokens(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);

  useEffect(() => {
    loadTokens();
  }, [loadTokens]);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    setNewToken(null);
    try {
      const data = await authedFetch('POST', { label: label.trim() || null });
      setNewToken(data.token);
      setLabel('');
      await loadTokens();
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleRevoke = async (id) => {
    if (!window.confirm('Revoke this token? Any connected AI assistant using it will lose access immediately.')) {
      return;
    }
    setError(null);
    try {
      await authedFetch('DELETE', { id });
      await loadTokens();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCopy = async (value) => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mcp-connect">
      <h3>Connect to AI assistant (MCP)</h3>
      <p className="mcp-connect__help">
        Generate a personal token to let Perplexity, Claude, or any MCP-compatible AI assistant
        read and update your tasks directly. Each token is tied to your account only.
      </p>

      <div className="mcp-connect__endpoint">
        <label>Server URL</label>
        <div className="mcp-connect__copy-row">
          <code>{MCP_ENDPOINT_URL}</code>
          <button type="button" onClick={() => handleCopy(MCP_ENDPOINT_URL)}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      <div className="mcp-connect__generate">
        <input
          type="text"
          placeholder="Label (optional, e.g. 'Perplexity')"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button type="button" onClick={handleGenerate} disabled={generating}>
          {generating ? 'Generating…' : 'Generate new token'}
        </button>
      </div>

      {newToken && (
        <div className="mcp-connect__new-token">
          <p>
            <strong>Copy this token now — it won't be shown again.</strong>
          </p>
          <div className="mcp-connect__copy-row">
            <code>{newToken}</code>
            <button type="button" onClick={() => handleCopy(newToken)}>Copy</button>
          </div>
        </div>
      )}

      {error && <p className="mcp-connect__error">{error}</p>}

      <div className="mcp-connect__list">
        <h4>Active tokens</h4>
        {loading ? (
          <p>Loading…</p>
        ) : tokens.length === 0 ? (
          <p className="mcp-connect__empty">No tokens yet.</p>
        ) : (
          <ul>
            {tokens.map((t) => (
              <li key={t.id}>
                <span>{t.label || 'Unnamed token'}</span>
                <span className="mcp-connect__meta">
                  Created {new Date(t.created_at).toLocaleDateString()}
                  {t.last_used_at && ` · Last used ${new Date(t.last_used_at).toLocaleDateString()}`}
                </span>
                <button type="button" onClick={() => handleRevoke(t.id)}>Revoke</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
