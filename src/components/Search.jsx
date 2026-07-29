/**
 * Search — global task search overlay.
 * Matches against: task name, notes, substep text.
 * Pressing Enter or clicking a result opens the task in the edit modal.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import '../styles/search.css';

// ── Helpers ──────────────────────────────────────────────────────────────────
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Returns an array of { text, highlight } segments for a string + query.
 * highlight === true means this segment matched.
 */
function highlight(str, regex) {
  if (!str) return [{ text: '', highlight: false }];
  const parts = [];
  let last = 0;
  let m;
  const re = new RegExp(regex.source, 'gi');
  while ((m = re.exec(str)) !== null) {
    if (m.index > last) parts.push({ text: str.slice(last, m.index), highlight: false });
    parts.push({ text: m[0], highlight: true });
    last = re.lastIndex;
    if (m[0].length === 0) { re.lastIndex++; } // guard infinite loop
  }
  if (last < str.length) parts.push({ text: str.slice(last), highlight: false });
  return parts.length ? parts : [{ text: str, highlight: false }];
}

function HighlightedText({ str, regex }) {
  const parts = highlight(str, regex);
  return (
    <span>
      {parts.map((p, i) =>
        p.highlight
          ? <mark key={i} className="search-mark">{p.text}</mark>
          : <span key={i}>{p.text}</span>
      )}
    </span>
  );
}

/** Truncate note text around first match for compact display. */
function snippetAround(str, regex, radius = 60) {
  if (!str) return '';
  const re = new RegExp(regex.source, 'i');
  const m = re.exec(str);
  if (!m) return str.slice(0, radius * 2);
  const start = Math.max(0, m.index - radius);
  const end   = Math.min(str.length, m.index + m[0].length + radius);
  return (start > 0 ? '…' : '') + str.slice(start, end) + (end < str.length ? '…' : '');
}

/** Priority label map */
const PRI_LABEL = { low: 'Low', med: 'Med', high: 'High', critical: '!' };
const PRI_CLASS = { low: 'badge-low', med: 'badge-med', high: 'badge-high', critical: 'badge-critical' };

// ── Search result item ────────────────────────────────────────────────────────
function SearchResult({ task, query, regex, catName, catColor, focused, onClick }) {
  const ref = useRef(null);
  useEffect(() => {
    if (focused && ref.current) {
      ref.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [focused]);

  const matchedSubs = (task.substeps || []).filter(s =>
    s.text && regex.test(s.text)
  );
  const noteSnippet = task.notes && regex.test(task.notes)
    ? snippetAround(task.notes, regex)
    : null;

  return (
    <button
      ref={ref}
      className={`search-result${focused ? ' search-result--focused' : ''}`}
      onClick={onClick}
      type="button"
    >
      {/* Category color bar */}
      <span
        className="search-result-cat-bar"
        style={{ background: catColor || 'var(--color-border-secondary)' }}
      />

      <div className="search-result-body">
        {/* Row 1: name + badges */}
        <div className="search-result-title-row">
          <span className="search-result-name">
            <HighlightedText str={task.name} regex={regex} />
          </span>
          <span className="search-result-badges">
            {catName && <span className="search-result-cat">{catName}</span>}
            {task.priority && (
              <span className={`badge ${PRI_CLASS[task.priority] || 'badge-med'} badge-xs`}>
                {PRI_LABEL[task.priority] || task.priority}
              </span>
            )}
            {task.status === 'done' && (
              <span className="search-result-done-badge">Done</span>
            )}
          </span>
        </div>

        {/* Row 2: matched substeps */}
        {matchedSubs.length > 0 && (
          <ul className="search-result-subs">
            {matchedSubs.slice(0, 3).map(s => (
              <li key={s.id}>
                <HighlightedText str={s.text} regex={regex} />
              </li>
            ))}
            {matchedSubs.length > 3 && (
              <li className="search-result-more">+{matchedSubs.length - 3} more substeps</li>
            )}
          </ul>
        )}

        {/* Row 3: note snippet */}
        {noteSnippet && (
          <p className="search-result-note">
            <HighlightedText str={noteSnippet} regex={regex} />
          </p>
        )}
      </div>
    </button>
  );
}

// ── Main Search component ─────────────────────────────────────────────────────
export default function Search({ tasks, categories, onSelectTask, onClose }) {
  const [query, setQuery]     = useState('');
  const [cursor, setCursor]   = useState(0);
  const inputRef              = useRef(null);
  const overlayRef            = useRef(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Click-outside to close
  const handleOverlayClick = (e) => {
    if (e.target === overlayRef.current) onClose();
  };

  const catMap = Object.fromEntries((categories || []).map(c => [c.id, c]));

  // Build results
  const results = React.useMemo(() => {
    const q = query.trim();
    if (!q || q.length < 1) return [];
    const re = new RegExp(escapeRegex(q), 'i');
    return (tasks || []).filter(t => {
      if (re.test(t.name)) return true;
      if (t.notes && re.test(t.notes)) return true;
      if ((t.substeps || []).some(s => s.text && re.test(s.text))) return true;
      return false;
    });
  }, [tasks, query]);

  // Reset cursor when results change
  useEffect(() => { setCursor(0); }, [results]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor(c => Math.min(c + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor(c => Math.max(c - 1, 0));
    } else if (e.key === 'Enter' && results.length > 0) {
      e.preventDefault();
      onSelectTask(results[cursor]);
      onClose();
    }
  }, [results, cursor, onSelectTask, onClose]);

  const queryRegex = React.useMemo(() => {
    const q = query.trim();
    if (!q) return null;
    return new RegExp(escapeRegex(q), 'gi');
  }, [query]);

  return (
    <div
      className="search-overlay"
      ref={overlayRef}
      onClick={handleOverlayClick}
      role="dialog"
      aria-label="Search tasks"
      aria-modal="true"
    >
      <div className="search-modal">
        {/* Search input */}
        <div className="search-input-row">
          <span className="search-icon" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 20 20" fill="none"
              xmlns="http://www.w3.org/2000/svg">
              <circle cx="8.5" cy="8.5" r="5.75" stroke="currentColor" strokeWidth="1.7"/>
              <path d="M13 13l4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
            </svg>
          </span>
          <input
            ref={inputRef}
            type="text"
            className="search-input"
            placeholder="Search tasks, substeps, notes…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            autoComplete="off"
            spellCheck={false}
          />
          {query && (
            <button
              className="search-clear"
              onClick={() => { setQuery(''); inputRef.current?.focus(); }}
              type="button"
              aria-label="Clear search"
            >✕</button>
          )}
        </div>

        {/* Results */}
        <div className="search-results" role="listbox">
          {query.trim().length > 0 && results.length === 0 && (
            <p className="search-empty">No tasks matched "{query}"</p>
          )}

          {query.trim().length === 0 && (
            <p className="search-hint">Type to search across all tasks, substeps, and notes.</p>
          )}

          {results.map((task, i) => {
            const cat = catMap[task.category_id];
            return (
              <SearchResult
                key={task.id}
                task={task}
                query={query}
                regex={queryRegex}
                catName={cat?.name}
                catColor={cat?.color}
                focused={i === cursor}
                onClick={() => { onSelectTask(task); onClose(); }}
              />
            );
          })}
        </div>

        {/* Footer hint */}
        {results.length > 0 && (
          <div className="search-footer">
            <kbd>↑↓</kbd> navigate &nbsp;&nbsp; <kbd>Enter</kbd> open &nbsp;&nbsp; <kbd>Esc</kbd> close
          </div>
        )}
      </div>
    </div>
  );
}
