/**
 * TaskModal — add / edit task.
 * Always shows a category dropdown.
 * Inline substep add/remove/weight.
 *
 * Recurring:
 *   Rolling (reset) — one live task; completes → advances to next due.
 *   Series  (expand) — hidden template + pre-dated instance tasks.
 *
 * Pattern controls set cadence / dow / dom. A single "First due" date is the
 * schedule anchor for both modes (no competing top-level due field when
 * recurring is on).
 */
import React, { useState, useMemo, useEffect } from 'react';
import Modal from './Modal.jsx';
import TaskJsonImport from './TaskJsonImport.jsx';
import {
  parseCadenceString,
  serialiseCadence,
  firstOccurrenceOnOrAfter,
  previewOccurrences,
  todayStr,
} from '../lib/recurrence.js';
import { LINK_TYPES, normaliseTaskLinks, normaliseTaskLink } from '../lib/taskLinks.js';

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
  { val: 'monthly', label: 'Monthly'  },
];

const CUSTOM_UNITS = [
  { val: 'days',   label: 'days'   },
  { val: 'weeks',  label: 'weeks'  },
  { val: 'months', label: 'months' },
];

const DAYS_OF_WEEK = [
  { val: 1, label: 'Mon' },
  { val: 2, label: 'Tue' },
  { val: 3, label: 'Wed' },
  { val: 4, label: 'Thu' },
  { val: 5, label: 'Fri' },
  { val: 6, label: 'Sat' },
  { val: 0, label: 'Sun' },
];

function RecurringSection({ task, isRecurring, setIsRecurring }) {
  const parsed = parseCadenceString(task?.recurring_cadence);

  const [recType,    setRecType]    = useState(task?.recurring_type || 'reset');
  const [isCustom,   setIsCustom]   = useState(parsed.isCustom);
  const [preset,     setPreset]     = useState(
    parsed.isCustom ? 'daily' : (parsed.preset === 'monthly' || PRESET_CADENCES.some(p => p.val === parsed.preset) ? parsed.preset : 'daily')
  );
  const [customN,    setCustomN]    = useState(parsed.customN);
  const [customUnit, setCustomUnit] = useState(parsed.customUnit);

  const initDow = task?.recurring_dow ?? (task?.due_date
    ? (() => {
        const [y, m, d] = task.due_date.split('-').map(Number);
        return new Date(y, m - 1, d).getDay();
      })()
    : 2);
  const [selectedDow, setSelectedDow] = useState(initDow);

  const initDom = task?.recurring_dom
    ?? (task?.due_date ? parseInt(task.due_date.slice(8), 10) : new Date().getDate());
  const [selectedDom, setSelectedDom] = useState(initDom);

  const cadenceValue = serialiseCadence(isCustom, preset, customN, customUnit);
  const isWeekly  = !isCustom && preset === 'weekly';
  const isMonthly = !isCustom && preset === 'monthly';
  const isCustomWeeks  = isCustom && customUnit === 'weeks';
  const isCustomMonths = isCustom && customUnit === 'months';
  const needsDow = isWeekly || isCustomWeeks;
  const needsDom = isMonthly || isCustomMonths;

  const rule = useMemo(() => ({
    cadence: cadenceValue,
    dow: needsDow ? selectedDow : null,
    dom: needsDom ? selectedDom : null,
  }), [cadenceValue, needsDow, selectedDow, needsDom, selectedDom]);

  const defaultFirstDue = useMemo(() => {
    if (task?.due_date) return task.due_date;
    if (task?.recurring_start) return task.recurring_start;
    return firstOccurrenceOnOrAfter(rule, todayStr());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- initial only

  const [firstDue, setFirstDue] = useState(defaultFirstDue);

  const isNew = !task?.id;
  useEffect(() => {
    if (!isRecurring) return;
    if (!isNew && task?.due_date) return;
    setFirstDue(firstOccurrenceOnOrAfter(rule, todayStr()));
  }, [cadenceValue, selectedDow, selectedDom, isRecurring]); // eslint-disable-line react-hooks/exhaustive-deps

  const [untilMode,  setUntilMode]  = useState(task?.recurring_until ? 'date' : 'count');
  const [untilDate,  setUntilDate]  = useState(task?.recurring_until  || '');
  const [instCount,  setInstCount]  = useState(task?.recurring_instances || 10);

  const preview = useMemo(() => {
    if (!isRecurring || !firstDue) return '';
    try {
      return previewOccurrences(rule, firstDue, 3);
    } catch {
      return '';
    }
  }, [isRecurring, rule, firstDue]);

  return (
    <div className="tm-recurring-wrap">
      <div className="tm-recurring-toggle">
        <input type="checkbox" id="tm-recurring-cb" name="recurring"
          checked={isRecurring} onChange={e => setIsRecurring(e.target.checked)} />
        <label htmlFor="tm-recurring-cb">Recurring task</label>
      </div>

      {isRecurring ? (
        <div className="tm-recurring-body">
          <div className="tm-rec-row" style={{ alignItems: 'flex-start' }}>
            <span className="tm-rec-label" style={{ paddingTop: 6 }}>Repeats</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
              <div className="tm-seg tm-seg-wrap" role="group" aria-label="Cadence">
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
                    className="tm-rec-count-input"
                  />
                  <select value={customUnit} onChange={e => setCustomUnit(e.target.value)}
                    className="tm-rec-date-input">
                    {CUSTOM_UNITS.map(u => <option key={u.val} value={u.val}>{u.label}</option>)}
                  </select>
                </div>
              )}

              {needsDow && (
                <div className="tm-seg" role="group" aria-label="Day of week">
                  {DAYS_OF_WEEK.map(d => (
                    <button key={d.val} type="button"
                      className={`tm-seg-btn${selectedDow === d.val ? ' active' : ''}`}
                      onClick={() => setSelectedDow(d.val)}>
                      {d.label}
                    </button>
                  ))}
                </div>
              )}

              {needsDom && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>On day</span>
                  <input type="number" min={1} max={31} value={selectedDom}
                    onChange={e => setSelectedDom(Math.min(31, Math.max(1, parseInt(e.target.value) || 1)))}
                    className="tm-rec-count-input"
                  />
                  <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>of each month</span>
                </div>
              )}
            </div>
            <input type="hidden" name="cadence" value={cadenceValue} />
            <input type="hidden" name="recurring_dow" value={needsDow ? selectedDow : ''} />
            <input type="hidden" name="recurring_dom" value={needsDom ? selectedDom : ''} />
          </div>

          <div className="tm-rec-row" style={{ alignItems: 'flex-start' }}>
            <span className="tm-rec-label" style={{ paddingTop: 6 }}>Behavior</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
              <div className="tm-seg" role="group">
                <button type="button"
                  className={`tm-seg-btn${recType === 'reset' ? ' active' : ''}`}
                  onClick={() => setRecType('reset')}>
                  Rolling
                </button>
                <button type="button"
                  className={`tm-seg-btn${recType === 'expand' ? ' active' : ''}`}
                  onClick={() => setRecType('expand')}>
                  Series
                </button>
              </div>
              <p className="tm-rec-hint" style={{ paddingLeft: 0, margin: 0 }}>
                {recType === 'reset'
                  ? 'One task that rolls to the next due date when you complete it.'
                  : 'Creates a list of dated tasks up front (template stays hidden).'}
              </p>
            </div>
            <input type="hidden" name="recurring_type" value={recType} />
          </div>

          <div className="tm-rec-row">
            <span className="tm-rec-label">First due</span>
            <input type="date" name="recurring_first_due" value={firstDue}
              onChange={e => setFirstDue(e.target.value)}
              className="tm-rec-date-input" required />
          </div>

          {recType === 'expand' && (
            <div className="tm-rec-until">
              <div className="tm-rec-row" style={{ alignItems: 'flex-start', gap: 12 }}>
                <span className="tm-rec-label" style={{ paddingTop: 6 }}>End</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
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

          {preview && (
            <div className="tm-rec-preview">
              <span className="tm-rec-preview-label">Next</span>
              <span>{preview}</span>
            </div>
          )}
        </div>
      ) : (
        <>
          <input type="hidden" name="recurring_type"      value="" />
          <input type="hidden" name="cadence"             value="" />
          <input type="hidden" name="recurring_dow"       value="" />
          <input type="hidden" name="recurring_dom"       value="" />
          <input type="hidden" name="recurring_first_due" value="" />
          <input type="hidden" name="recurring_until"     value="" />
          <input type="hidden" name="recurring_instances" value="" />
          <input type="hidden" name="until_mode"          value="" />
        </>
      )}
    </div>
  );
}

export default function TaskModal({ task, catId, categories = [], onSave, onClose }) {
  const isEdit = !!task;
  const [submitting, setSubmitting] = useState(false);
  const [isRecurring, setIsRecurring] = useState(!!task?.recurring);
  const [selCatId, setSelCatId] = useState(
    catId ?? task?.category_id ?? categories[0]?.id ?? null
  );
  const [substeps, setSubsteps] = useState(
    (task?.substeps || []).map(s => ({ ...s, weight: s.weight ?? 1 }))
  );
  const [newStepText, setNewStepText] = useState('');
  const [newStepWeight, setNewStepWeight] = useState(1);
  const [links, setLinks] = useState(() => normaliseTaskLinks(task?.links));
  const [newLinkType, setNewLinkType] = useState('web');
  const [newLinkLabel, setNewLinkLabel] = useState('');
  const [newLinkValue, setNewLinkValue] = useState('');
  const [linkError, setLinkError] = useState('');

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

  const addLink = () => {
    const link = normaliseTaskLink({ type: newLinkType, label: newLinkLabel, value: newLinkValue });
    if (!link) {
      setLinkError(newLinkType === 'email'
        ? 'Enter a valid email address.'
        : newLinkType === 'shortcut'
          ? 'Enter the Shortcut name.'
          : 'Enter a valid web address.');
      return;
    }
    setLinks(prev => [...prev, link]);
    setNewLinkLabel('');
    setNewLinkValue('');
    setLinkError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);

    const recurringOn = fd.get('recurring') === 'on';
    const recType     = fd.get('recurring_type') || 'reset';
    const cadence     = fd.get('cadence') || 'daily';
    const rawUntil    = fd.get('recurring_until');
    const rawCount    = fd.get('recurring_instances');
    const rawDow      = fd.get('recurring_dow');
    const rawDom      = fd.get('recurring_dom');
    const firstDue    = fd.get('recurring_first_due') || null;
    const topDueDate  = fd.get('due_date') || null;

    const recurringDow = (rawDow !== '' && rawDow !== null)
      ? parseInt(rawDow, 10)
      : null;
    const recurringDom = (rawDom !== '' && rawDom !== null)
      ? parseInt(rawDom, 10)
      : null;

    let due_date = recurringOn ? firstDue : topDueDate;

    if (recurringOn && due_date) {
      due_date = firstOccurrenceOnOrAfter({
        cadence,
        dow: recurringDow,
        dom: recurringDom,
      }, due_date);
    }

    const payload = {
      ...(task || {}),
      category_id:           selCatId,
      name:                  fd.get('name').trim(),
      status:                fd.get('status'),
      priority:              fd.get('priority'),
      due_date,
      estimated_hours:       parseFloat(fd.get('estimated_hours')) || 1,
      notes:                 fd.get('notes') || null,
      links,
      manual_progress:       task?.manual_progress ?? 0,
      recurring:             recurringOn,
      recurring_type:        recurringOn ? recType : null,
      recurring_cadence:     recurringOn ? cadence  : null,
      recurring_dow:         recurringOn ? recurringDow : null,
      recurring_dom:         recurringOn ? recurringDom : null,
      recurring_start:       recurringOn ? due_date : null,
      recurring_until:       (recurringOn && recType === 'expand' && rawUntil)  ? rawUntil           : null,
      recurring_instances:   (recurringOn && recType === 'expand' && rawCount)  ? parseInt(rawCount, 10) : null,
      is_recurring_template: recurringOn && recType === 'expand',
      ...(recurringOn && recType === 'expand' ? { status: 'not started', manual_progress: 0 } : {}),
      substeps,
      position:              task?.position ?? 0,
    };

    if (!recurringOn) {
      payload.recurring_template_id = task?.recurring_template_id ?? null;
      payload.recurring_last_completed_at = null;
    }

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
      {!isEdit && (
        <TaskJsonImport categories={categories} onSave={onSave} onClose={onClose} />
      )}
      <form onSubmit={handleSubmit}>
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

        {!isRecurring && (
          <div className="form-field">
            <label>Due date</label>
            <input type="date" name="due_date" defaultValue={task?.due_date || ''} />
          </div>
        )}
        {isRecurring && <input type="hidden" name="due_date" value="" />}

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
          <label>Links</label>
          {links.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 8 }}>
              {links.map((link, i) => (
                <div key={`${link.type}-${link.value}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                  <span style={{ color: 'var(--color-text-tertiary)', minWidth: 80 }}>{LINK_TYPES.find(t => t.value === link.type)?.label}</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{link.label}</span>
                  <button type="button" className="btn btn-sm btn-danger" style={{ padding: '1px 8px', fontSize: 11 }}
                    aria-label={`Remove ${link.label}`} onClick={() => setLinks(prev => prev.filter((_, idx) => idx !== i))}>✕</button>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <select value={newLinkType} onChange={e => { setNewLinkType(e.target.value); setLinkError(''); }} style={{ width: 116 }}>
              {LINK_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
            </select>
            <input value={newLinkLabel} onChange={e => setNewLinkLabel(e.target.value)} placeholder="Label (optional)" style={{ flex: '1 1 120px' }} />
            <input value={newLinkValue} onChange={e => { setNewLinkValue(e.target.value); setLinkError(''); }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLink(); } }}
              placeholder={newLinkType === 'email' ? 'name@example.com' : newLinkType === 'shortcut' ? 'Shortcut name' : 'https://example.com'}
              style={{ flex: '2 1 180px' }} />
            <button type="button" className="btn btn-sm" onClick={addLink}>Add link</button>
          </div>
          {linkError && <div style={{ marginTop: 5, color: 'var(--color-text-danger)', fontSize: 12 }}>{linkError}</div>}
          <div style={{ marginTop: 5, color: 'var(--color-text-tertiary)', fontSize: 12 }}>
            Shortcuts run locally on your Mac when opened from the app.
          </div>
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

        <RecurringSection
          task={task}
          isRecurring={isRecurring}
          setIsRecurring={setIsRecurring}
        />

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
