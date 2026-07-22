/**
 * TaskModal — add / edit task.
 * Always shows a category dropdown.
 * Inline substep add/remove/weight.
 *
 * Recurring reset-mode scheduling:
 *   Two anchor modes, determined by cadence:
 *
 *   WEEKLY cadence:
 *     User picks a day-of-week (Mon–Sun).  This is stored as `recurring_dow`
 *     (0=Sun … 6=Sat) — the permanent source of truth.  `due_date` is derived
 *     on save by db.js (always the next occurrence of that weekday at or after
 *     today) and is never read back by this form; only `recurring_dow` is.
 *
 *   All other cadences:
 *     User picks a specific date which becomes `due_date` directly.
 *
 *   On EDIT, the day-of-week picker is initialised from `task.recurring_dow`
 *   (not from `due_date`), so it always shows exactly what the user set.
 */
import React, { useState, useEffect } from 'react';
import Modal from './Modal.jsx';

const PRIORITY_LABELS = { low: 'Low', med: 'Medium', high: 'High', critical: 'Critical' };
const STATUS_OPTS = [
  { val: 'not started', label: 'Not started' },
  { val: 'in progress', label: 'In progress' },
  { val: 'done',        label: 'Done' },
];

const PRESET_CADENCES = [
  { val: 'daily',   label: 'Daily'    },
  { val: 'weekday', label: 'Weekdays' },
  { val: 'weekly',  label: 'Weekly'   },
];

const CUSTOM_UNITS = [
  { val: 'days',   label: 'days'   },
  { val: 'weeks',  label: 'weeks'  },
  { val: 'months', label: 'months' },
];

// Mon first, Sun last — display order only.
const DAYS_OF_WEEK = [
  { val: 1, label: 'Mon' },
  { val: 2, label: 'Tue' },
  { val: 3, label: 'Wed' },
  { val: 4, label: 'Thu' },
  { val: 5, label: 'Fri' },
  { val: 6, label: 'Sat' },
  { val: 0, label: 'Sun' },
];

function parseCadence(cadence) {
  if (!cadence) return { isCustom: false, preset: 'daily', customN: 2, customUnit: 'days' };
  const m = cadence.match(/^every_(\d+)_(day|week|month)s?$/);
  if (m) return {
    isCustom: true, preset: 'daily',
    customN: parseInt(m[1], 10), customUnit: m[2] + 's',
  };
  return { isCustom: false, preset: cadence, customN: 2, customUnit: 'days' };
}

function serialiseCadence(isCustom, preset, customN, customUnit) {
  if (!isCustom) return preset;
  return `every_${customN}_${customUnit.replace(/s$/, '')}s`;
}

// ── Recurring section ──────────────────────────────────────────────────────────
function RecurringSection({ task }) {
  const parsed = parseCadence(task?.recurring_cadence);

  const [isRecurring, setIsRecurring] = useState(!!task?.recurring);
  const [recType,     setRecType]     = useState(task?.recurring_type || 'reset');
  const [isCustom,    setIsCustom]    = useState(parsed.isCustom);
  const [preset,      setPreset]      = useState(parsed.preset);
  const [customN,     setCustomN]     = useState(parsed.customN);
  const [customUnit,  setCustomUnit]  = useState(parsed.customUnit);

  const isWeekly = !isCustom && preset === 'weekly';

  // ── Day-of-week for weekly tasks ──────────────────────────────────────────
  // Initialise ONLY from recurring_dow — never from due_date.
  // Default to Tuesday (2) for new tasks.
  const initDow = task?.recurring_dow ?? 2;
  const [selectedDow, setSelectedDow] = useState(initDow);

  // ── Specific-date anchor for non-weekly cadences ──────────────────────────
  const [dueDate, setDueDate] = useState(task?.due_date || '');

  // When switching away from weekly, restore the task's existing due_date.
  useEffect(() => {
    if (!isWeekly) setDueDate(task?.due_date || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWeekly]);

  const [untilMode,  setUntilMode]  = useState(task?.recurring_until ? 'date' : 'count');
  const [untilDate,  setUntilDate]  = useState(task?.recurring_until  || '');
  const [instCount,  setInstCount]  = useState(task?.recurring_instances || 10);

  const cadenceValue = serialiseCadence(isCustom, preset, customN, customUnit);

  return (
    <div className="tm-recurring-wrap">
      <div className="tm-recurring-toggle">
        <input
          type="checkbox" id="tm-recurring-cb" name="recurring"
          checked={isRecurring} onChange={e => setIsRecurring(e.target.checked)}
        />
        <label htmlFor="tm-recurring-cb">Recurring task</label>
      </div>

      {isRecurring && (
        <div className="tm-recurring-body">

          {/* ── Cadence ── */}
          <div className="tm-rec-row">
            <span className="tm-rec-label">Repeats</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
              <div className="tm-seg" role="group" aria-label="Cadence">
                {PRESET_CADENCES.map(o => (
                  <button key={o.val} type="button"
                    className={`tm-seg-btn${!isCustom && preset === o.val ? ' active' : ''}`}
                    onClick={() => { setIsCustom(false); setPreset(o.val); }}>
                    {o.label}
                  </button>
                ))}
                <button type="button"
                  className={`tm-seg-btn${isCustom ? ' active' : ''}`}
                  onClick={() => setIsCustom(true)}>
                  Custom
                </button>
              </div>
              {isCustom && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>Every</span>
                  <input type="number" min={1} max={365} value={customN}
                    onChange={e => setCustomN(Math.max(1, parseInt(e.target.value) || 1))}
                    style={{ width: 58, fontSize: 13, padding: '4px 6px',
                      border: '0.5px solid var(--color-border-secondary)',
                      borderRadius: 4, background: 'var(--color-bg-input)',
                      color: 'var(--color-text-primary)' }}
                  />
                  <select value={customUnit} onChange={e => setCustomUnit(e.target.value)}
                    style={{ fontSize: 13, padding: '4px 6px' }}>
                    {CUSTOM_UNITS.map(u => <option key={u.val} value={u.val}>{u.label}</option>)}
                  </select>
                </div>
              )}
            </div>
            <input type="hidden" name="cadence" value={cadenceValue} />
          </div>

          {/* ── Behavior ── */}
          <div className="tm-rec-row">
            <span className="tm-rec-label">Behavior</span>
            <div className="tm-seg" role="group">
              <button type="button"
                className={`tm-seg-btn${recType === 'reset' ? ' active' : ''}`}
                onClick={() => setRecType('reset')}>
                Auto-reset
              </button>
              <button type="button"
                className={`tm-seg-btn${recType === 'expand' ? ' active' : ''}`}
                onClick={() => setRecType('expand')}>
                Create instances
              </button>
            </div>
            <input type="hidden" name="recurring_type" value={recType} />
          </div>

          {/* ── Due anchor (reset mode only) ── */}
          {recType === 'reset' && (
            <div className="tm-rec-row" style={{ alignItems: 'flex-start' }}>
              <span className="tm-rec-label" style={{ paddingTop: 6 }}>Due</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>

                {isWeekly ? (
                  <>
                    {/* Day-of-week picker — value submitted via hidden input */}
                    <div className="tm-seg" role="group" aria-label="Day of week">
                      {DAYS_OF_WEEK.map(d => (
                        <button key={d.val} type="button"
                          className={`tm-seg-btn${selectedDow === d.val ? ' active' : ''}`}
                          onClick={() => setSelectedDow(d.val)}>
                          {d.label}
                        </button>
                      ))}
                    </div>
                    <p className="tm-rec-hint" style={{ marginTop: 0 }}>
                      {`Resets each week on ${DAYS_OF_WEEK.find(d => d.val === selectedDow)?.label ?? ''}.
                        Complete it early and it holds until that day;
                        complete it late and it resets to the following
                        ${DAYS_OF_WEEK.find(d => d.val === selectedDow)?.label ?? ''}.`}
                    </p>
                    {/* recurring_dow is the source of truth for weekly tasks. */}
                    <input type="hidden" name="recurring_dow" value={selectedDow} />
                  </>
                ) : (
                  <>
                    <input type="date" value={dueDate}
                      onChange={e => setDueDate(e.target.value)}
                      style={{ fontSize: 13, padding: '4px 6px',
                        border: '0.5px solid var(--color-border-secondary)',
                        borderRadius: 4, background: 'var(--color-bg-input)',
                        color: 'var(--color-text-primary)' }}
                    />
                    <p className="tm-rec-hint" style={{ marginTop: 0 }}>
                      Resets each cycle on this date.
                      Complete it early and it holds until the due date;
                      complete it late and it advances to the next occurrence.
                    </p>
                    <input type="hidden" name="recurring_due_date" value={dueDate} />
                    <input type="hidden" name="recurring_dow" value="" />
                  </>
                )}
              </div>
            </div>
          )}

          {/* ── Expand-only: end condition ── */}
          {recType === 'expand' && (
            <div className="tm-rec-until">
              <input type="hidden" name="recurring_dow" value="" />
              <div className="tm-rec-row" style={{ alignItems: 'flex-start', gap: 12 }}>
                <span className="tm-rec-label" style={{ paddingTop: 6 }}>End</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                  <label className="tm-rec-radio-row">
                    <input type="radio" name="until_mode" value="date"
                      checked={untilMode === 'date'} onChange={() => setUntilMode('date')} />
                    <span>On date</span>
                    {untilMode === 'date' && (
                      <input type="date" name="recurring_until" value={untilDate}
                        onChange={e => setUntilDate(e.target.value)}
                        className="tm-rec-date-input" required />
                    )}
                  </label>
                  <label className="tm-rec-radio-row">
                    <input type="radio" name="until_mode" value="count"
                      checked={untilMode === 'count'} onChange={() => setUntilMode('count')} />
                    <span>After</span>
                    {untilMode === 'count' && (
                      <>
                        <input type="number" name="recurring_instances" value={instCount}
                          onChange={e => setInstCount(Math.max(1, parseInt(e.target.value) || 1))}
                          min={1} max={365} className="tm-rec-count-input" />
                        <span style={{ color: 'var(--color-text-secondary)', fontSize: 12 }}>
                          {instCount === 1 ? 'occurrence' : 'occurrences'}
                        </span>
                      </>
                    )}
                  </label>
                  {untilMode === 'count' && <input type="hidden" name="recurring_until" value="" />}
                  {untilMode === 'date'  && <input type="hidden" name="recurring_instances" value="" />}
                </div>
              </div>
            </div>
          )}

          {recType === 'reset' && (
            <>
              <input type="hidden" name="recurring_until"     value="" />
              <input type="hidden" name="recurring_instances" value="" />
              <input type="hidden" name="until_mode"          value="" />
            </>
          )}

        </div>
      )}

      {!isRecurring && (
        <>
          <input type="hidden" name="recurring_type"      value="" />
          <input type="hidden" name="cadence"             value="" />
          <input type="hidden" name="recurring_dow"       value="" />
          <input type="hidden" name="recurring_due_date"  value="" />
          <input type="hidden" name="recurring_until"     value="" />
          <input type="hidden" name="recurring_instances" value="" />
          <input type="hidden" name="until_mode"          value="" />
        </>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function TaskModal({ task, catId, categories = [], onSave, onClose }) {
  const isEdit = !!task;
  const [submitting, setSubmitting] = useState(false);
  const [selCatId, setSelCatId] = useState(
    catId ?? task?.category_id ?? categories[0]?.id ?? null
  );
  const [substeps,    setSubsteps]   = useState(
    (task?.substeps || []).map(s => ({ ...s, weight: s.weight ?? 1 }))
  );
  const [newStepText,   setNewStepText]   = useState('');
  const [newStepWeight, setNewStepWeight] = useState(1);

  const addSubstep = () => {
    const text = newStepText.trim();
    if (!text) return;
    setSubsteps(prev => [...prev, { text, done: false, weight: Math.max(1, newStepWeight || 1) }]);
    setNewStepText('');
    setNewStepWeight(1);
  };

  const removeSubstep = i => setSubsteps(prev => prev.filter((_, idx) => idx !== i));

  const updateSubstepWeight = (i, val) => {
    const w = Math.max(1, parseInt(val) || 1);
    setSubsteps(prev => prev.map((s, idx) => idx === i ? { ...s, weight: w } : s));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);

    const isRecurring = fd.get('recurring') === 'on';
    const recType     = fd.get('recurring_type') || 'reset';
    const cadence     = fd.get('cadence') || 'daily';
    const rawUntil    = fd.get('recurring_until');
    const rawCount    = fd.get('recurring_instances');

    // recurring_dow: only meaningful for weekly reset tasks.
    const rawDow = fd.get('recurring_dow');
    const isWeeklyCadence = isRecurring && recType === 'reset' && cadence === 'weekly';
    const recurringDow = isWeeklyCadence && rawDow !== '' && rawDow !== null
      ? parseInt(rawDow, 10)
      : null;

    // due_date for non-weekly reset tasks comes from the date picker.
    // For weekly tasks, db.js derives due_date from recurring_dow on save —
    // we pass null here and let the server-side logic handle it.
    const recurringDueDate = fd.get('recurring_due_date') || null;
    const topDueDate       = fd.get('due_date') || null;

    const due_date = (() => {
      if (!isRecurring || recType !== 'reset') return topDueDate;
      if (isWeeklyCadence) return null;  // db.js will set this from recurring_dow
      return recurringDueDate || topDueDate;
    })();

    const payload = {
      ...(task || {}),
      category_id:           selCatId,
      name:                  fd.get('name').trim(),
      status:                fd.get('status'),
      priority:              fd.get('priority'),
      due_date,
      estimated_hours:       parseFloat(fd.get('estimated_hours')) || 1,
      notes:                 fd.get('notes') || null,
      manual_progress:       task?.manual_progress ?? 0,
      recurring:             isRecurring,
      recurring_type:        isRecurring ? recType : null,
      recurring_cadence:     isRecurring ? cadence  : null,
      recurring_dow:         recurringDow,
      recurring_until:       (isRecurring && recType === 'expand' && rawUntil)  ? rawUntil           : null,
      recurring_instances:   (isRecurring && recType === 'expand' && rawCount)  ? parseInt(rawCount) : null,
      is_recurring_template: isRecurring && recType === 'expand',
      substeps,
      position:              task?.position ?? 0,
    };

    setSubmitting(true);
    try {
      await onSave(payload);
      onClose();
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title={isEdit ? 'Edit task' : 'Add task'} onClose={onClose} wide>
      <form onSubmit={handleSubmit}>
        {categories.length > 0 && (
          <div className="form-field">
            <label>Category</label>
            <select value={selCatId || ''} onChange={e => setSelCatId(e.target.value)}>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}

        <div className="form-field">
          <label>Name</label>
          <input name="name" required defaultValue={task?.name || ''} autoFocus />
        </div>

        <div className="form-field">
          <label>Status</label>
          <select name="status" defaultValue={task?.status || 'not started'}>
            {STATUS_OPTS.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
          </select>
        </div>

        <div className="form-field">
          <label>Priority</label>
          <select name="priority" defaultValue={task?.priority || 'med'}>
            {Object.entries(PRIORITY_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>

        <div className="form-field">
          <label>Due date</label>
          <input type="date" name="due_date" defaultValue={task?.due_date || ''} />
        </div>

        <div className="form-field">
          <label>Estimated hours</label>
          <input type="number" name="estimated_hours" min={0.5} step={0.5}
            defaultValue={task?.estimated_hours ?? 1} />
        </div>

        <div className="form-field">
          <label>Notes</label>
          <textarea name="notes" defaultValue={task?.notes || ''} />
        </div>

        <div className="form-field">
          <label>Substeps</label>
          {substeps.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <span style={{ flex: 1, fontSize: 13 }}>{s.text}</span>
              <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>wt:</span>
              <input
                type="number" min={1} max={99}
                value={s.weight ?? 1}
                onChange={e => updateSubstepWeight(i, e.target.value)}
                style={{
                  width: 52, fontSize: 13, padding: '2px 4px',
                  border: '0.5px solid var(--color-border-secondary)',
                  borderRadius: 4, textAlign: 'center',
                  background: 'var(--color-bg-input)',
                  color: 'var(--color-text-primary)',
                }}
                title="Weight (affects progress %)"
              />
              <button type="button" className="btn btn-sm btn-danger"
                style={{ padding: '1px 8px', fontSize: 11 }}
                onClick={() => removeSubstep(i)}>✕</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
            <input
              style={{ flex: 1, fontSize: 13, padding: '5px 8px',
                border: '0.5px solid var(--color-border-secondary)', borderRadius: 4,
                background: 'var(--color-bg-input)', color: 'var(--color-text-primary)' }}
              placeholder="Add substep…"
              value={newStepText}
              onChange={e => setNewStepText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSubstep(); } }}
            />
            <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>wt:</span>
            <input
              type="number" min={1} max={99}
              value={newStepWeight}
              onChange={e => setNewStepWeight(Math.max(1, parseInt(e.target.value) || 1))}
              style={{
                width: 52, fontSize: 13, padding: '5px 4px',
                border: '0.5px solid var(--color-border-secondary)',
                borderRadius: 4, textAlign: 'center',
                background: 'var(--color-bg-input)',
                color: 'var(--color-text-primary)',
              }}
              title="Weight for new substep"
            />
            <button type="button" className="btn btn-sm" onClick={addSubstep}>Add</button>
          </div>
        </div>

        <RecurringSection task={task} />

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose} disabled={submitting}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Add task'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
