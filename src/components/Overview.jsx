import React, { useState, useCallback } from 'react';
import Modal from './Modal.jsx';
import '../styles/overview.css';

// ── Helpers ───────────────────────────────────────────────────────────────────

function toISO(d) { return d.toISOString().slice(0, 10); }

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  return Math.ceil((new Date(dateStr + 'T00:00:00') - today) / 86400000);
}

function taskProgress(task) {
  if (!task.substeps || task.substeps.length === 0) return task.progress || 0;
  const done = task.substeps.filter(s => s.done).length;
  return Math.round((done / task.substeps.length) * 100);
}

function remainingHours(task) {
  const est  = parseFloat(task.estimated_hours) || 1;
  const prog = taskProgress(task) / 100;
  return Math.max(0, est * (1 - prog));
}

/**
 * Greedy forward-pack: distributes each task's remaining hours across days
 * up to its deadline, respecting daily capacity. Returns per-day load array.
 */
function buildDayLoads(tasks, weeklyHours, days = 112) {
  const dayAvail   = weeklyHours / 7;
  const dayBuckets = new Float64Array(days);
  const today      = new Date(); today.setHours(0,0,0,0);

  const sorted = [...tasks]
    .filter(t => t.status !== 'done' && !t.recurring)
    .sort((a, b) => {
      const da = a.due_date ? daysUntil(a.due_date) : 9999;
      const db = b.due_date ? daysUntil(b.due_date) : 9999;
      return da - db;
    });

  for (const t of sorted) {
    let rem      = remainingHours(t);
    if (rem <= 0) continue;
    const dueDays = t.due_date ? Math.max(daysUntil(t.due_date), 0) : days - 1;
    const lastDay = Math.min(dueDays, days - 1);
    const daily   = rem / Math.max(lastDay + 1, 1);
    for (let d = 0; d <= lastDay && rem > 0; d++) {
      const space = Math.max(dayAvail - dayBuckets[d], 0);
      const take  = Math.min(daily, rem, space);
      if (take > 0) { dayBuckets[d] += take; rem -= take; }
    }
    if (rem > 0.001) dayBuckets[lastDay] += rem;
  }
  return dayBuckets;
}

function hoursInWindow(dayBuckets, windowDays) {
  let sum = 0;
  for (let d = 0; d < Math.min(windowDays, dayBuckets.length); d++) sum += dayBuckets[d];
  return sum;
}

function capacityPressure(dayBuckets, windowDays, weeklyHours) {
  const avail    = (weeklyHours / 7) * windowDays;
  const demanded = hoursInWindow(dayBuckets, windowDays);
  return avail > 0 ? demanded / avail : 0;
}

function urgencyScore(task, dayBuckets, weeklyHours) {
  if (task.status === 'done' || task.recurring) return 0;
  const days = daysUntil(task.due_date);
  if (days === null) return 1;
  if (days < 0)      return 0;
  const rem  = remainingHours(task);
  if (days === 0)    return 100;
  const base     = Math.min(90, Math.round((rem / Math.max(days, 0.5)) * 20));
  const pressure = capacityPressure(dayBuckets, days, weeklyHours);
  const boost    = pressure > 1 ? Math.min(10, Math.round((pressure - 1) * 10)) : 0;
  return Math.min(100, base + boost);
}

function urgencyMeta(score) {
  if (score >= 75) return { label: 'Critical', cls: 'badge-critical', color: 'var(--color-text-danger)' };
  if (score >= 50) return { label: 'High',     cls: 'badge-high',     color: '#854F0B' };
  if (score >= 25) return { label: 'Medium',   cls: 'badge-med',      color: 'var(--color-text-warning)' };
  return               { label: 'Low',      cls: 'badge-low',      color: 'var(--color-text-success)' };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Overview({ appData, userId }) {
  const { categories, tasks, preferences, saveTask, savePreferences } = appData;
  const weeklyHours = preferences?.weekly_hours ?? 20;

  const [capModal,  setCapModal]  = useState(false);
  const [capInput,  setCapInput]  = useState(weeklyHours);

  // Derived data
  const allTasks   = tasks.filter(t => !t.recurring);
  const activeTasks = allTasks.filter(t => t.status !== 'done');
  const total      = allTasks.length;
  const done       = allTasks.filter(t => t.status === 'done').length;
  const overdue    = activeTasks.filter(t => t.due_date && daysUntil(t.due_date) < 0).length;
  const dueWeek    = activeTasks.filter(t => t.due_date && daysUntil(t.due_date) >= 0 && daysUntil(t.due_date) <= 7).length;

  const catMap     = Object.fromEntries(categories.map(c => [c.id, c]));
  const dayBuckets = buildDayLoads(tasks, weeklyHours);

  const weekDemanded = hoursInWindow(dayBuckets, 7);
  const capPct       = Math.min(100, Math.round((weekDemanded / Math.max(weeklyHours, 1)) * 100));
  const capColor     = capPct >= 100 ? 'var(--color-text-danger)' : capPct >= 75 ? '#BA7517' : 'var(--color-text-success)';

  // Urgency queue: active, non-recurring, sorted by score desc
  const queue = activeTasks
    .filter(t => !t.recurring)
    .map(t => ({ ...t, cat: catMap[t.category_id], score: urgencyScore(t, dayBuckets, weeklyHours) }))
    .sort((a, b) => b.score - a.score);

  const todayStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });

  // ── Capacity modal save
  const handleSaveCap = async (e) => {
    e.preventDefault();
    await savePreferences({ weekly_hours: parseFloat(capInput) || 20 });
    setCapModal(false);
  };

  return (
    <div className="overview">

      {/* Date line */}
      <div className="overview-date">📅 {todayStr}</div>

      {/* Metric grid */}
      <div className="overview-grid">
        <Metric label="Total tasks"  value={total} />
        <Metric label="Completed"    value={done} />
        <Metric label="Due this week" value={dueWeek} />
        <Metric label="Overdue"      value={overdue}
          valueStyle={overdue > 0 ? { color: 'var(--color-text-danger)' } : {}} />
      </div>

      {/* Weekly capacity bar */}
      <div className="cap-wrap">
        <div className="cap-header">
          <span className="cap-label">Weekly capacity (next 7 days)</span>
          <div className="cap-right">
            <span style={{ fontSize: 12, color: capColor, fontWeight: 500 }}>
              {weekDemanded.toFixed(1)}h demanded / {weeklyHours}h available
            </span>
            <button className="btn btn-sm" onClick={() => { setCapInput(weeklyHours); setCapModal(true); }}
              title="Change weekly hours" aria-label="Edit weekly capacity">
              ⚙
            </button>
          </div>
        </div>
        <div className="cap-track">
          <div className="cap-fill" style={{ width: `${capPct}%`, background: capColor }} />
        </div>
        {capPct >= 100 && (
          <div className="cap-warn">⚠ This week is overloaded — consider pushing lower-priority tasks.</div>
        )}
      </div>

      {/* Urgency queue */}
      <div className="queue-label">Urgency queue</div>

      {queue.length === 0 && (
        <div className="empty-state" style={{ padding: '2rem 0' }}>
          <div className="empty-icon">✅</div>
          <div className="empty-title">All clear!</div>
          <div className="empty-sub">No active tasks. Add some from the Categories tab.</div>
        </div>
      )}

      <div className="urgency-list">
        {queue.map(task => {
          const meta  = urgencyMeta(task.score);
          const days  = daysUntil(task.due_date);
          const dueLabel = days === null ? '' :
            days < 0  ? `${Math.abs(days)}d overdue` :
            days === 0 ? 'Due today' : `${days}d left`;
          const dueCls = days !== null && days <= 3 ? 'due-urgent' : '';

          return (
            <div key={task.id} className="urgency-item">
              <div className="urgency-name" title={task.name}>
                {task.cat && <span className="urgency-dot" style={{ background: task.cat.color }} />}
                {task.name}
              </div>
              <div className="urgency-bar-wrap">
                <div className="urgency-track">
                  <div className="urgency-fill"
                    style={{ width: `${task.score}%`, background: meta.color }} />
                </div>
              </div>
              <div className="urgency-right">
                <span className={`badge ${meta.cls}`}>{meta.label}</span>
                {dueLabel && <span className={`urgency-due ${dueCls}`}>{dueLabel}</span>}
              </div>
              <div className="urgency-actions">
                <button
                  className="btn btn-sm"
                  onClick={() => saveTask({ ...task, status: task.status === 'done' ? 'not-started' : 'done' })}
                >
                  {task.status === 'done' ? 'Reopen' : 'Done ✓'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Capacity modal */}
      {capModal && (
        <Modal title="Weekly capacity" onClose={() => setCapModal(false)}>
          <form onSubmit={handleSaveCap}>
            <div className="form-field">
              <label>Hours available per week</label>
              <input
                type="number" min="1" max="168" step="0.5"
                value={capInput}
                onChange={e => setCapInput(e.target.value)}
                autoFocus
              />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setCapModal(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Save</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function Metric({ label, value, valueStyle = {} }) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className="metric-val" style={valueStyle}>{value}</div>
    </div>
  );
}
