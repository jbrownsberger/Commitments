/**
 * TaskModal — add / edit task.
 * Always shows a category dropdown.
 * Inline substep add/remove.
 *
 * Recurring modes:
 *   reset  — single row; status auto-resets each cycle (handled in useAppData)
 *   expand — template spawns individual task instances through a date or count
 */
import React, { useState } from 'react';
import Modal from './Modal.jsx';

const PRIORITY_LABELS = { low: 'Low', med: 'Medium', high: 'High', critical: 'Critical' };
const STATUS_OPTS = [
  { val: 'not started', label: 'Not started' },
  { val: 'in progress', label: 'In progress' },
  { val: 'done',        label: 'Done' },
];
const CADENCE_OPTS = [
  { val: 'daily',   label: 'Daily'    },
  { val: 'weekday', label: 'Weekdays' },
  { val: 'weekly',  label: 'Weekly'   },
];

// ── Recurring section subcomponent ─────────────────────────────────────────────
function RecurringSection({ task }) {
  const initRecurring = !!task?.recurring;
  const initType      = task?.recurring_type      || 'reset';
  const initCadence   = task?.recurring_cadence   || 'daily';
  const initUntilMode = task?.recurring_until      ? 'date'
                      : task?.recurring_instances  ? 'count'
                      : 'date';
  const initUntil     = task?.recurring_until     || '';
  const initCount     = task?.recurring_instances || 10;

  const [isRecurring, setIsRecurring] = useState(initRecurring);
  const [recType,     setRecType]     = useState(initType);      // 'reset' | 'expand'
  const [cadence,     setCadence]     = useState(initCadence);
  const [untilMode,   setUntilMode]   = useState(initUntilMode); // 'date' | 'count'
  const [untilDate,   setUntilDate]   = useState(initUntil);
  const [instCount,   setInstCount]   = useState(initCount);

  return (
    <div className="tm-recurring-wrap">
      {/* ── Master toggle ── */}
      <div className="tm-recurring-toggle">
        <input
          type="checkbox"
          id="tm-recurring-cb"
          name="recurring"
          checked={isRecurring}
          onChange={e => setIsRecurring(e.target.checked)}
        />
        <label htmlFor="tm-recurring-cb">Recurring task</label>
      </div>

      {isRecurring && (
        <div className="tm-recurring-body">

          {/* ── Cadence ── */}
          <div className="tm-rec-row">
            <span className="tm-rec-label">Repeats</span>
            <div className="tm-seg" role="group" aria-label="Cadence">
              {CADENCE_OPTS.map(o => (
                <button
                  key={o.val}
                  type="button"
                  className={`tm-seg-btn${cadence === o.val ? ' active' : ''}`}
                  onClick={() => setCadence(o.val)}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {/* Hidden input so FormData picks up the value */}
            <input type="hidden" name="cadence" value={cadence} />
          </div>

          {/* ── Mode ── */}
          <div className="tm-rec-row">
            <span className="tm-rec-label">Behavior</span>
            <div className="tm-seg" role="group" aria-label="Recurring mode">
              <button
                type="button"
                className={`tm-seg-btn${recType === 'reset' ? ' active' : ''}`}
                onClick={() => setRecType('reset')}
                title="One task row that resets itself each cycle"
              >
                Auto-reset
              </button>
              <button
                type="button"
                className={`tm-seg-btn${recType === 'expand' ? ' active' : ''}`}
                onClick={() => setRecType('expand')}
                title="Creates separate tasks for each occurrence"
              >
                Create instances
              </button>
            </div>
            <input type="hidden" name="recurring_type" value={recType} />
          </div>

          {/* ── Mode descriptions ── */}
          <p className="tm-rec-hint">
            {recType === 'reset'
              ? 'A single task that resets to "not started" each cycle after you mark it done. Stays clean in your queue.'
              : 'Spawns individual tasks for each occurrence — each one lives independently in your category with its own due date.'}
          </p>

          {/* ── Expand-only: until options ── */}
          {recType === 'expand' && (
            <div className="tm-rec-until">
              <div className="tm-rec-row" style={{ alignItems: 'flex-start', gap: 12 }}>
                <span className="tm-rec-label" style={{ paddingTop: 6 }}>End</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>

                  {/* Until date */}
                  <label className="tm-rec-radio-row">
                    <input
                      type="radio"
                      name="until_mode"
                      value="date"
                      checked={untilMode === 'date'}
                      onChange={() => setUntilMode('date')}
                    />
                    <span>On date</span>
                    {untilMode === 'date' && (
                      <input
                        type="date"
                        name="recurring_until"
                        value={untilDate}
                        onChange={e => setUntilDate(e.target.value)}
                        className="tm-rec-date-input"
                        required={untilMode === 'date'}
                      />
                    )}
                  </label>

                  {/* Until count */}
                  <label className="tm-rec-radio-row">
                    <input
                      type="radio"
                      name="until_mode"
                      value="count"
                      checked={untilMode === 'count'}
                      onChange={() => setUntilMode('count')}
                    />
                    <span>After</span>
                    {untilMode === 'count' && (
                      <>
                        <input
                          type="number"
                          name="recurring_instances"
                          value={instCount}
                          onChange={e => setInstCount(Math.max(1, parseInt(e.target.value) || 1))}
                          min={1}
                          max={365}
                          className="tm-rec-count-input"
                        />
                        <span style={{ color: 'var(--color-text-secondary)', fontSize: 12 }}>
                          {instCount === 1 ? 'occurrence' : 'occurrences'}
                        </span>
                      </>
                    )}
                  </label>

                  {/* Hidden passthrough for the non-active mode — sends null */}
                  {untilMode === 'count' && (
                    <input type="hidden" name="recurring_until" value="" />
                  )}
                  {untilMode === 'date' && (
                    <input type="hidden" name="recurring_instances" value="" />
                  )}
                </div>
              </div>
            </div>
          )}

          {/* For reset mode, ensure expand fields are empty in FormData */}
          {recType === 'reset' && (
            <>
              <input type="hidden" name="recurring_until"     value="" />
              <input type="hidden" name="recurring_instances" value="" />
              <input type="hidden" name="until_mode"          value="" />
            </>
          )}

        </div>
      )}

      {/* When not recurring, zero out all fields */}
      {!isRecurring && (
        <>
          <input type="hidden" name="recurring_type"      value="" />
          <input type="hidden" name="cadence"             value="" />
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
  const [selCatId,   setSelCatId]   = useState(
    catId ?? task?.category_id ?? categories[0]?.id ?? null
  );

  // Substep editor
  const [substeps,    setSubsteps]   = useState(
    (task?.substeps || []).map(s => ({ ...s, weight: s.weight ?? 1 }))
  );
  const [newStepText, setNewStepText] = useState('');

  const addSubstep = () => {
    const text = newStepText.trim();
    if (!text) return;
    setSubsteps(prev => [...prev, { text, done: false, weight: 1 }]);
    setNewStepText('');
  };
  const removeSubstep = (i) => setSubsteps(prev => prev.filter((_, idx) => idx !== i));

  const handleSubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const isRecurring = fd.get('recurring') === 'on';
    const recType     = fd.get('recurring_type') || 'reset';
    const rawUntil    = fd.get('recurring_until');
    const rawCount    = fd.get('recurring_instances');

    const payload = {
      ...(task || {}),
      category_id:          selCatId,
      name:                 fd.get('name').trim(),
      status:               fd.get('status'),
      priority:             fd.get('priority'),
      due_date:             fd.get('due_date') || null,
      estimated_hours:      parseFloat(fd.get('estimated_hours')) || 1,
      notes:                fd.get('notes') || null,
      manual_progress:      task?.manual_progress ?? 0,
      recurring:            isRecurring,
      recurring_type:       isRecurring ? recType : null,
      recurring_cadence:    isRecurring ? (fd.get('cadence') || 'daily') : null,
      recurring_until:      (isRecurring && recType === 'expand' && rawUntil)  ? rawUntil          : null,
      recurring_instances:  (isRecurring && recType === 'expand' && rawCount)  ? parseInt(rawCount) : null,
      is_recurring_template: isRecurring && recType === 'expand',
      substeps,
      position:             task?.position ?? 0,
    };
    setSubmitting(true);
    try {
      await onSave(payload);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title={isEdit ? 'Edit task' : 'Add task'} onClose={onClose} wide>
      <form onSubmit={handleSubmit}>
        {/* Category */}
        {categories.length > 0 && (
          <div className="form-field">
            <label>Category</label>
            <select value={selCatId || ''} onChange={e => setSelCatId(e.target.value)}>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
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

        {/* Substeps */}
        <div className="form-field">
          <label>Substeps</label>
          {substeps.map((s, i) => (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4 }}>
              <span style={{ flex:1, fontSize:13 }}>{s.text}</span>
              <button type="button" className="btn btn-sm btn-danger"
                style={{ padding:'1px 8px', fontSize:11 }}
                onClick={() => removeSubstep(i)}>Remove</button>
            </div>
          ))}
          <div style={{ display:'flex', gap:6, marginTop:4 }}>
            <input
              style={{ flex:1, fontSize:13, padding:'5px 8px',
                border:'0.5px solid var(--color-border-secondary)', borderRadius:4 }}
              placeholder="Add substep, press Enter"
              value={newStepText}
              onChange={e => setNewStepText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSubstep(); } }}
            />
            <button type="button" className="btn btn-sm" onClick={addSubstep}>Add</button>
          </div>
        </div>

        {/* Recurring — self-contained section */}
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
