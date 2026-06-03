/**
 * TaskModal — standalone add/edit task modal.
 * Can be opened from anywhere (Shell header, Overview, etc.).
 * onSave receives the raw form values; caller decides category_id.
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

/**
 * Props:
 *   task       — existing task object (edit mode) or null (add mode)
 *   catId      — category_id to assign (required when task is null)
 *   categories — array of category objects (for the dropdown when catId is not fixed)
 *   onSave     — async (taskPayload) => void
 *   onClose    — () => void
 */
export default function TaskModal({ task, catId, categories = [], onSave, onClose }) {
  const isEdit = !!task;
  const [submitting, setSubmitting] = useState(false);
  const [selCatId, setSelCatId] = useState(catId ?? task?.category_id ?? categories[0]?.id ?? null);

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
      substeps:          task?.substeps ?? [],
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
    <Modal title={isEdit ? 'Edit task' : 'Add task'} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {/* Category selector — only shown when no fixed catId and categories available */}
        {!catId && categories.length > 0 && (
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
          <input
            type="number" name="estimated_hours"
            min={0.5} step={0.5}
            defaultValue={task?.estimated_hours ?? 1}
          />
        </div>

        <div className="form-field">
          <label>Notes</label>
          <textarea name="notes" defaultValue={task?.notes || ''} />
        </div>

        <div className="form-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox" name="recurring" id="tm-recurring-cb"
            defaultChecked={!!task?.recurring}
          />
          <label htmlFor="tm-recurring-cb" style={{ color: 'var(--color-text-primary)', fontSize: 13 }}>
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
