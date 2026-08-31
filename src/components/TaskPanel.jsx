/**
 * TaskPanel — full-detail modal for a single task.
 * Matches the screenshot: header, meta row, weighted substeps with drag-to-reorder,
 * auto-status logic, snooze, notes, footer actions.
 *
 * Auto-status rules:
 *   progress > 0 and < 100  →  'in progress'
 *   progress === 100         →  'done'
 *   progress === 0           →  'not started'
 *
 * Substep weights are DISPLAY-ONLY here. To change a weight, use Edit mode
 * (TaskModal), which has a proper Save button.
 */
import React, { useState, useRef } from 'react';
import Modal from './Modal.jsx';
import {
  cadenceLabel as engineCadenceLabel,
  modeLabel,
  isSeriesInstance,
  isSeriesTemplate,
} from '../lib/recurrence.js';
import { LINK_TYPES, normaliseTaskLinks, taskLinkHref } from '../lib/taskLinks.js';
import '../styles/task-panel.css';

const STATUS_CYCLE = ['not started', 'in progress', 'done'];

// ── Helpers exported for use in Overview/Planner ───────────────────────────

export function taskProgress(task) {
  const substeps = task.substeps || [];
  if (substeps.length === 0) return task.manual_progress ?? task.manualProgress ?? 0;
  const totalWeight = substeps.reduce((s, sub) => s + (sub.weight ?? 1), 0);
  if (totalWeight === 0) return 0;
  const doneWeight  = substeps.filter(s => s.done).reduce((s, sub) => s + (sub.weight ?? 1), 0);
  return Math.round((doneWeight / totalWeight) * 100);
}

export function remainingHours(task) {
  const est  = parseFloat(task.estimated_hours ?? task.estimatedHours) || 1;
  const prog = taskProgress(task) / 100;
  return Math.max(0, est * (1 - prog));
}

export function daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.round(
    (new Date(dateStr + 'T00:00:00') - new Date().setHours(0,0,0,0)) / 86400000
  );
}

export function urgencyScore(task) {
  if (task.status === 'done') return 0;
  const days = daysUntil(task.due_date ?? task.dueDate);
  if (days === null) return 1;
  if (days < 0)  return 0;
  const rem = remainingHours(task);
  if (days === 0) return 100;
  return Math.min(100, Math.round((rem / Math.max(days, 0.5)) * 20));
}

export function urgencyColor(score) {
  if (score >= 75) return 'var(--color-text-danger)';
  if (score >= 50) return '#854F0B';
  if (score >= 25) return 'var(--color-text-warning)';
  return 'var(--color-text-success)';
}

export function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric'
  });
}

// Derive status from numeric progress
function statusFromProgress(prog, currentStatus) {
  if (prog >= 100) return 'done';
  if (prog > 0)    return 'in progress';
  return currentStatus === 'done' ? 'not started' : currentStatus;
}

// Priority badge colors
const PRIORITY_STYLES = {
  low:      { bg: 'var(--color-background-success)', color: 'var(--color-text-success)' },
  med:      { bg: 'var(--color-background-warning)', color: 'var(--color-text-warning)' },
  high:     { bg: '#FAEEDA', color: '#854F0B' },
  critical: { bg: 'var(--color-background-danger)',  color: 'var(--color-text-danger)'  },
};
const PRIORITY_LABELS = { low:'Low', med:'Medium', high:'High', critical:'Critical' };

/** Human-readable cadence string (re-exported for Overview / Categories). */
export function cadenceLabel(task) {
  return engineCadenceLabel(task);
}

// ── Recurring meta badge ───────────────────────────────────────────────────
function RecurringMeta({ task }) {
  // Series instances: light "part of series" note
  if (isSeriesInstance(task)) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12,
        color: 'var(--color-text-info, var(--color-text-secondary))',
        marginTop: 8,
        padding: '5px 8px',
        background: 'var(--color-background-info, rgba(59,130,246,0.06))',
        borderRadius: 'var(--radius-sm, 4px)',
        width: 'fit-content',
      }}>
        <span style={{ fontSize: 13 }}>⧉</span>
        <span>Part of a series</span>
      </div>
    );
  }

  if (!task.recurring || !task.recurring_cadence) return null;

  const label = cadenceLabel(task);
  const mode = modeLabel(task);
  const isTemplate = isSeriesTemplate(task);

  let lastCompletedStr = null;
  const completedAt = task.recurring_last_completed_at;
  if (completedAt) {
    try {
      lastCompletedStr = new Date(completedAt).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric',
      });
    } catch (_) {}
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      fontSize: 12,
      color: 'var(--color-text-info, var(--color-text-secondary))',
      marginTop: 8,
      padding: '5px 8px',
      background: 'var(--color-background-info, rgba(59,130,246,0.06))',
      borderRadius: 'var(--radius-sm, 4px)',
      width: 'fit-content',
      flexWrap: 'wrap',
    }}>
      <span style={{ fontSize: 13 }}>↻</span>
      <span>Repeats {label}</span>
      {mode && (
        <span style={{ color: 'var(--color-text-tertiary, var(--color-text-secondary))' }}>
          · {mode}{isTemplate ? ' template' : ''}
        </span>
      )}
      {lastCompletedStr && (
        <span style={{ color: 'var(--color-text-tertiary, var(--color-text-secondary))' }}>
          · last completed {lastCompletedStr}
        </span>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export default function TaskPanel({ task, cat, onClose, onSave, onDelete, onEdit }) {
  const [local, setLocal] = useState({
    ...task,
    substeps: (task.substeps || []).map(s => ({ ...s, weight: s.weight ?? 1 })),
  });
  const dragIdx = useRef(null);

  const prog    = taskProgress(local);
  const rem     = remainingHours(local);
  const days    = daysUntil(local.due_date ?? local.dueDate);
  const isDone  = local.status === 'done';
  const isOverdue = !isDone && (local.due_date ?? local.dueDate) && days < 0;

  const daysStr = !(local.due_date ?? local.dueDate) ? ''
    : days < 0  ? `${Math.abs(days)}d overdue`
    : days === 0 ? 'today'
    : `${days}d left`;

  // Persist a partial update. Rolling tasks may advance on complete — apply
  // the returned task so the panel shows the next due date immediately.
  const save = async (updates) => {
    const next = { ...local, ...updates };
    setLocal(next);
    try {
      const result = await onSave(next);
      if (result && result.id === next.id) {
        setLocal({
          ...result,
          substeps: (result.substeps || next.substeps || []).map(s => ({
            ...s, weight: s.weight ?? 1,
          })),
        });
      }
    } catch (e) {
      console.error('TaskPanel save failed:', e);
    }
  };

  // ── Status button
  const cycleStatus = () => {
    const cur  = STATUS_CYCLE.indexOf(local.status);
    const next = STATUS_CYCLE[(cur + 1) % STATUS_CYCLE.length];
    save({
      status: next,
      manual_progress: next === 'done' ? 100 : next === 'not started' ? 0 : local.manual_progress,
    });
  };
  // ── Substep toggle
  const toggleSubstep = (idx) => {
    const substeps = local.substeps.map((s, i) => i === idx ? { ...s, done: !s.done } : s);
    const newProg  = taskProgress({ ...local, substeps });
    save({ substeps, status: statusFromProgress(newProg, local.status), manual_progress: newProg });
  };

  // ── Substep drag-to-reorder
  const moveSubstep = (from, to) => {
    if (from === to) return;
    const subs = [...local.substeps];
    const [moved] = subs.splice(from, 1);
    subs.splice(to, 0, moved);
    save({ substeps: subs });
  };

  // ── Manual progress slider (no-substep mode)
  const setProgress = (val) => {
    const v      = parseInt(val);
    const status = statusFromProgress(v, local.status);
    save({ manual_progress: v, status });
  };

  // ── Snooze
  const snooze = (numDays) => {
    const base = local.due_date ?? local.dueDate;
    if (!base) return;
    const d = new Date(base + 'T00:00:00');
    d.setDate(d.getDate() + numDays);
    save({ due_date: d.toISOString().slice(0, 10) });
  };

  const hasSubsteps = local.substeps.length > 0;
  const priorityStyle = PRIORITY_STYLES[local.priority] || {};

  return (
    <Modal title="" onClose={onClose} wide className="task-panel-modal">
      <div className="task-panel" style={{ '--task-panel-color': cat?.color || '#82979B' }}>
      <div className="task-panel-strip" />
      <div className="task-panel-body">
      {/* ── Header ── */}
      <div className="task-panel-header">
        <div style={{ flex:1, minWidth:0 }}>
          <h2 className="task-panel-title">{local.name}</h2>
          <div className="task-panel-meta">
            {cat?.name && (
              <span className="task-panel-category"><span />{cat.name}</span>
            )}
            {(local.due_date ?? local.dueDate) && (
              <span className={`task-panel-due${isOverdue ? ' overdue' : ''}${days !== null && days <= 3 && !isOverdue ? ' soon' : ''}`}>
                {formatDate(local.due_date ?? local.dueDate)}
                {daysStr && <span> · {daysStr}</span>}
              </span>
            )}
            {local.priority && local.priority !== 'med' && (
              <span className="badge" style={{ background: priorityStyle.bg, color: priorityStyle.color }}>
                {PRIORITY_LABELS[local.priority] || local.priority}
              </span>
            )}
          </div>
          <RecurringMeta task={local} />
        </div>
        <button className="task-panel-close" type="button" onClick={onClose} aria-label="Close">✕</button>
      </div>

      <button className={`task-panel-status ${local.status || 'not-started'}`} onClick={cycleStatus}>{isDone ? '✓ Reopen' : local.status === 'in progress' ? '● In progress — mark done' : '○ Not started — start'}</button>

      {/* ── Meta row ── */}
      <div className="task-panel-stats">
        {(local.estimated_hours ?? local.estimatedHours) && (
          <div className="task-panel-stat">
            <div className="task-panel-stat-label">Estimated</div>
            <div className="task-panel-stat-value">{local.estimated_hours ?? local.estimatedHours}h</div>
          </div>
        )}
        <div className="task-panel-stat">
          <div className="task-panel-stat-label">Remaining</div>
          <div className="task-panel-stat-value">{rem.toFixed(1)}h</div>
        </div>
        <div className="task-panel-stat">
          <div className="task-panel-stat-label">Status</div>
          <div className="task-panel-stat-value task-panel-status-value">{local.status || 'not started'}</div>
        </div>
      </div>

      {/* ── Progress ── */}
      <div className="task-panel-progress-section">
        <div className="task-panel-section-heading">
          <span>Progress</span>
          <span>{prog}%</span>
        </div>
        <div className="progress-track task-panel-progress-track">
          <div className="progress-fill" style={{ width:`${prog}%`, background:'var(--task-panel-color)' }} />
        </div>
        {!hasSubsteps && (
          <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:10 }}>
            <input
              type="range" min={0} max={100} step={5}
              value={local.manual_progress || 0}
              style={{ flex:1, cursor:'pointer', accentColor:'var(--color-text-info)' }}
              onChange={e => setLocal(p => ({ ...p, manual_progress: parseInt(e.target.value) }))}
              onMouseUp={e  => setProgress(e.target.value)}
              onTouchEnd={e => setProgress(e.currentTarget.value)}
            />
            <span style={{ fontSize:12, minWidth:34 }}>{local.manual_progress || 0}%</span>
            <button className="btn btn-sm" onClick={() => setProgress(Math.min(100, (local.manual_progress || 0) + 10))}>+10%</button>
          </div>
        )}
      </div>

      {/* ── Substeps ── */}
      {hasSubsteps && (
        <div className="task-panel-substeps">
          <div className="task-panel-section-title">
            Substeps
            <span style={{ fontSize:12, fontWeight:400, color:'var(--color-text-tertiary)' }}>— drag to reorder</span>
          </div>
          {local.substeps.map((s, i) => (
            <div
              key={i}
              className="task-panel-substep-row"
              draggable
              onDragStart={e => {
                dragIdx.current = i;
                e.currentTarget.style.opacity = '0.4';
              }}
              onDragEnd={e => { e.currentTarget.style.opacity = '1'; }}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); moveSubstep(dragIdx.current, i); }}
            >
              {/* drag handle */}
              <span className="task-panel-drag-handle">⠇</span>
              {/* checkbox */}
              <input
                type="checkbox"
                checked={!!s.done}
                onChange={() => toggleSubstep(i)}
                className="task-panel-substep-check"
              />
              {/* text */}
              <span className={`task-panel-substep-text${s.done ? ' done' : ''}`}>{s.text}</span>
              {/* weight — read-only display; edit via Edit button → TaskModal */}
              {(s.weight ?? 1) !== 1 && (
                <span
                  style={{ fontSize:11, color:'var(--color-text-tertiary)' }}
                  title="Substep weight (edit in Edit mode to change)"
                >
                  wt:{s.weight}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Notes ── */}
      {local.notes && (
        <div className="task-panel-notes">
          <div className="task-panel-section-title">Notes</div>
          <div className="task-panel-notes-text">{local.notes}</div>
        </div>
      )}

      {(normaliseTaskLinks(cat?.links).length > 0 || normaliseTaskLinks(local.links).length > 0) && (
        <div className="task-panel-links">
          <div className="task-panel-section-title">Links</div>
          <div className="task-panel-links-list">
            {[...normaliseTaskLinks(cat?.links).map(link => ({ ...link, source: 'Category' })), ...normaliseTaskLinks(local.links)].map((link, i) => {
              const href = taskLinkHref(link);
              const typeLabel = LINK_TYPES.find(t => t.value === link.type)?.label || 'Link';
              return href && (
                <a key={`${link.type}-${link.value}-${i}`} href={href}
                  target={link.type === 'web' ? '_blank' : undefined}
                  rel={link.type === 'web' ? 'noreferrer' : undefined}
                  className="task-panel-link">
                  {link.source ? `${link.source} · ` : ''}{typeLabel}: {link.label}
                </a>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Snooze ── */}
      <div className="task-panel-snooze">
        <span>Snooze:</span>
        {(local.due_date ?? local.dueDate) ? (
          <>
            <button className="btn btn-sm" onClick={() => snooze(1)}>+1 day</button>
            <button className="btn btn-sm" onClick={() => snooze(7)}>+1 week</button>
          </>
        ) : (
          <span style={{ fontSize:12, color:'var(--color-text-tertiary)' }}>No due date set</span>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Close</button>
        <button className="btn" onClick={() => { onEdit(local); onClose(); }}>Edit</button>
        <button
          className="btn btn-danger"
          onClick={() => {
            if (window.confirm(`Delete "${local.name}"?`)) { onDelete(local.id); onClose(); }
          }}
        >Delete</button>
      </div>
      </div>
      </div>
    </Modal>
  );
}
