/**
 * TaskModal — add / edit task.
 * Always shows a category dropdown.
 * Inline substep add/remove.
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
    const payload = {
      ...(task || {}),
      category_id:       selCatId,
      name:              fd.get('name').trim(),
      status:            fd.get('status'),
      priority:          fd.get('priority'),
      due_date:          fd.get('due_date') || null,
      estimated_hours:   parseFloat(fd.get('estimated_hours')) || 1,
      notes:             fd.get('notes') || null,
      manual_progress:   task?.manual_progress ?? 0,
      recurring:         isRecurring,
      recurring_cadence: isRecurring ? (fd.get('cadence') || 'daily') : null,
      substeps,
      position:          task?.position ?? 0,
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
        {/* Category — always shown */}
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
              style={{ flex:1, fontSize:13, padding:'5px 8px', border:'0.5px solid var(--color-border-secondary)', borderRadius:4 }}
              placeholder="Add substep, press Enter"
              value={newStepText}
              onChange={e => setNewStepText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSubstep(); } }}
            />
            <button type="button" className="btn btn-sm" onClick={addSubstep}>Add</button>
          </div>
        </div>

        <div className="form-field" style={{ flexDirection:'row', alignItems:'center', gap:8 }}>
          <input type="checkbox" name="recurring" id="tm-recurring-cb"
            defaultChecked={!!task?.recurring} />
          <label htmlFor="tm-recurring-cb" style={{ color:'var(--color-text-primary)', fontSize:13 }}>
            Recurring / daily task
          </label>
        </div>

        <div className="form-field">
          <label>Cadence (if recurring)</label>
          <select name="cadence" defaultValue={task?.recurring_cadence || 'daily'}>
            {CADENCE_OPTS.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
          </select>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose} disabled={submitting}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
