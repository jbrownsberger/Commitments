import React, { useState } from 'react';
import Modal from './Modal.jsx';
import '../styles/categories.css';

const COLORS = [
  '#e05252','#e07a52','#d4a017','#5a9e5a','#3a86c8',
  '#7b5ea7','#c4607a','#4aadad','#888888','#2d2d2d',
];

const PRIORITY_LABELS = { low:'Low', med:'Medium', high:'High', critical:'Critical' };
const STATUS_LABELS   = { 'not-started':'Not started', 'in-progress':'In progress', done:'Done' };

export default function Categories({ appData, userId }) {
  const { categories, tasks, saveCategory, removeCategory, saveTask, removeTask,
          saveSubstep, removeSubstep } = appData;

  const [catModal,  setCatModal]  = useState(null);  // null | 'add' | {cat}
  const [taskModal, setTaskModal] = useState(null);  // null | { catId, task? }
  const [openCats,  setOpenCats]  = useState({});
  const [openTasks, setOpenTasks] = useState({});

  // ── Helpers ────────────────────────────────────────────────────────────────
  const tasksFor = (catId) => tasks.filter(t => t.category_id === catId)
    .sort((a,b) => a.position - b.position);

  const toggleCat  = (id) => setOpenCats(p  => ({ ...p, [id]: !p[id] }));
  const toggleTask = (id) => setOpenTasks(p => ({ ...p, [id]: !p[id] }));

  const taskProgress = (task) => {
    if (!task.substeps || task.substeps.length === 0) return task.progress || 0;
    const done = task.substeps.filter(s => s.done).length;
    return Math.round((done / task.substeps.length) * 100);
  };

  const remainingHours = (task) => {
    const est  = parseFloat(task.estimated_hours) || 1;
    const prog = taskProgress(task) / 100;
    return Math.max(0, est * (1 - prog)).toFixed(1);
  };

  const daysUntil = (dateStr) => {
    if (!dateStr) return null;
    const diff = Math.ceil((new Date(dateStr + 'T00:00:00') - new Date().setHours(0,0,0,0)) / 86400000);
    return diff;
  };

  const dueBadge = (dateStr) => {
    const d = daysUntil(dateStr);
    if (d === null) return null;
    if (d < 0)  return { label: `${Math.abs(d)}d overdue`, cls: 'badge-critical' };
    if (d === 0) return { label: 'Due today',  cls: 'badge-critical' };
    if (d <= 3)  return { label: `${d}d left`,  cls: 'badge-high' };
    if (d <= 7)  return { label: `${d}d left`,  cls: 'badge-med' };
    return           { label: `${d}d left`,  cls: 'badge-low' };
  };

  // ── Category save ──────────────────────────────────────────────────────────
  const handleSaveCat = async (e) => {
    e.preventDefault();
    const fd   = new FormData(e.target);
    const name = fd.get('name').trim();
    const color = fd.get('color');
    if (!name) return;
    const existing = catModal !== 'add' ? catModal : null;
    await saveCategory({
      ...(existing || {}),
      name, color,
      position: existing ? existing.position : categories.length,
    });
    setCatModal(null);
  };

  // ── Task save ──────────────────────────────────────────────────────────────
  const handleSaveTask = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const existing = taskModal?.task || null;
    await saveTask({
      ...(existing || {}),
      category_id:     taskModal.catId,
      name:            fd.get('name').trim(),
      status:          fd.get('status'),
      priority:        fd.get('priority'),
      due_date:        fd.get('due_date') || null,
      estimated_hours: parseFloat(fd.get('estimated_hours')) || 1,
      notes:           fd.get('notes') || null,
      recurring:       fd.get('recurring') === 'on',
      recurring_cadence: fd.get('recurring_cadence') || null,
      position:        existing ? existing.position : tasksFor(taskModal.catId).length,
    });
    setTaskModal(null);
  };

  // ── Substep toggle ─────────────────────────────────────────────────────────
  const toggleSubstep = async (task, substep) => {
    await saveSubstep({ ...substep, done: !substep.done });
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="cat-list">

      {categories.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">📂</div>
          <div className="empty-title">No categories yet</div>
          <div className="empty-sub">Categories group your tasks — create one to get started.</div>
          <button className="btn btn-primary" onClick={() => setCatModal('add')}>Create category</button>
        </div>
      )}

      {categories.map(cat => {
        const catTasks = tasksFor(cat.id);
        const doneCt   = catTasks.filter(t => t.status === 'done').length;
        const isOpen   = !!openCats[cat.id];
        return (
          <div key={cat.id} className="cat-card">
            <div className="cat-header" onClick={() => toggleCat(cat.id)}>
              <span className="cat-dot" style={{ background: cat.color }} />
              <span className="cat-title">{cat.name}</span>
              <span className="cat-meta">{doneCt}/{catTasks.length} done</span>
              <button className="btn btn-sm" style={{marginLeft:4}} onClick={e => { e.stopPropagation(); setCatModal(cat); }}>Edit</button>
              <button className="btn btn-sm btn-danger" style={{marginLeft:4}} onClick={e => { e.stopPropagation(); if(window.confirm(`Delete "${cat.name}" and all its tasks?`)) removeCategory(cat.id); }}>Delete</button>
              <span className={`cat-chevron${isOpen?' open':''}`}>▶</span>
            </div>

            {isOpen && (
              <div className="cat-body">
                <div className="task-list">
                  {catTasks.length === 0 && (
                    <div style={{fontSize:12,color:'var(--color-text-tertiary)',padding:'4px 0'}}>
                      No tasks yet.
                    </div>
                  )}
                  {catTasks.map(task => {
                    const prog   = taskProgress(task);
                    const badge  = dueBadge(task.due_date);
                    const isOpen = !!openTasks[task.id];
                    return (
                      <div key={task.id} className="task-item">
                        <div className="task-row" onClick={() => toggleTask(task.id)}>
                          <span className={`task-check${task.status==='done'?' done':task.status==='in-progress'?' in-progress':''}`}>
                            {task.status==='done' ? '✓' : task.status==='in-progress' ? '…' : ''}
                          </span>
                          <span className={`task-name${task.status==='done'?' done':''}`}>{task.name}</span>
                          {badge && <span className={`badge ${badge.cls}`}>{badge.label}</span>}
                          <span className={`badge badge-${task.priority}`}>{PRIORITY_LABELS[task.priority]}</span>
                          <span className="task-due">{remainingHours(task)}h left</span>
                        </div>

                        {isOpen && (
                          <div className="task-detail">
                            <div className="detail-grid">
                              <div className="detail-field">
                                <span className="detail-label">Status</span>
                                <span className="detail-val">{STATUS_LABELS[task.status]}</span>
                              </div>
                              <div className="detail-field">
                                <span className="detail-label">Due</span>
                                <span className="detail-val">{task.due_date || '—'}</span>
                              </div>
                              <div className="detail-field">
                                <span className="detail-label">Estimated</span>
                                <span className="detail-val">{task.estimated_hours}h</span>
                              </div>
                              <div className="detail-field">
                                <span className="detail-label">Remaining</span>
                                <span className="detail-val">{remainingHours(task)}h</span>
                              </div>
                            </div>

                            {task.notes && <p className="notes-text">{task.notes}</p>}

                            <div className="progress-wrap">
                              <div className="progress-label">
                                <span>Progress</span><span>{prog}%</span>
                              </div>
                              <div className="progress-track">
                                <div className="progress-fill" style={{width:`${prog}%`}} />
                              </div>
                            </div>

                            {task.substeps && task.substeps.length > 0 && (
                              <div className="substep-list">
                                {task.substeps.map(s => (
                                  <div key={s.id} className="substep">
                                    <span
                                      className={`substep-check${s.done?' done':''}`}
                                      onClick={() => toggleSubstep(task, s)}
                                    >
                                      {s.done ? '✓' : ''}
                                    </span>
                                    <span className={`substep-text${s.done?' done':''}`}>{s.text}</span>
                                    <button
                                      className="btn btn-sm btn-danger"
                                      style={{padding:'1px 6px',fontSize:11}}
                                      onClick={() => removeSubstep(task.id, s.id)}
                                    >×</button>
                                  </div>
                                ))}
                              </div>
                            )}

                            <div className="task-actions">
                              <button className="btn btn-sm" onClick={() => setTaskModal({ catId: cat.id, task })}>Edit task</button>
                              <button
                                className="btn btn-sm"
                                onClick={() => saveTask({ ...task, status: task.status === 'done' ? 'not-started' : 'done' })}
                              >
                                {task.status === 'done' ? 'Reopen' : 'Mark done'}
                              </button>
                              <button className="btn btn-sm btn-danger" onClick={() => { if(window.confirm(`Delete "${task.name}"?`)) removeTask(task.id); }}>Delete</button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <button className="btn btn-sm" onClick={() => setTaskModal({ catId: cat.id })}>+ Add task</button>
              </div>
            )}
          </div>
        );
      })}

      <button className="btn" style={{marginTop:12}} onClick={() => setCatModal('add')}>+ Add category</button>

      {/* ── Category modal ── */}
      {catModal && (
        <Modal title={catModal === 'add' ? 'Add category' : 'Edit category'} onClose={() => setCatModal(null)}>
          <form onSubmit={handleSaveCat}>
            <div className="form-field">
              <label>Name</label>
              <input name="name" required autoFocus defaultValue={catModal !== 'add' ? catModal.name : ''} />
            </div>
            <div className="form-field">
              <label>Color</label>
              <ColorPicker name="color" defaultValue={catModal !== 'add' ? catModal.color : COLORS[0]} />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setCatModal(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Save</button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Task modal ── */}
      {taskModal && (
        <Modal
          title={taskModal.task ? 'Edit task' : 'Add task'}
          onClose={() => setTaskModal(null)}
        >
          <form onSubmit={handleSaveTask}>
            <div className="form-field">
              <label>Name</label>
              <input name="name" required autoFocus defaultValue={taskModal.task?.name || ''} />
            </div>
            <div className="form-field">
              <label>Status</label>
              <select name="status" defaultValue={taskModal.task?.status || 'not-started'}>
                {Object.entries(STATUS_LABELS).map(([v,l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="form-field">
              <label>Priority</label>
              <select name="priority" defaultValue={taskModal.task?.priority || 'med'}>
                {Object.entries(PRIORITY_LABELS).map(([v,l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="form-field">
              <label>Due date</label>
              <input type="date" name="due_date" defaultValue={taskModal.task?.due_date || ''} />
            </div>
            <div className="form-field">
              <label>Estimated hours</label>
              <input type="number" name="estimated_hours" min="0.25" step="0.25"
                defaultValue={taskModal.task?.estimated_hours || 1} />
            </div>
            <div className="form-field">
              <label>Notes</label>
              <textarea name="notes" defaultValue={taskModal.task?.notes || ''} />
            </div>
            <div className="form-field" style={{flexDirection:'row',alignItems:'center',gap:8}}>
              <input type="checkbox" name="recurring" id="recurring"
                defaultChecked={taskModal.task?.recurring || false} />
              <label htmlFor="recurring" style={{color:'inherit'}}>Recurring task</label>
            </div>
            <div className="form-field">
              <label>Recurrence</label>
              <select name="recurring_cadence" defaultValue={taskModal.task?.recurring_cadence || 'weekly'}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Bi-weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setTaskModal(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Save</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ── Color picker sub-component ─────────────────────────────────────────────
function ColorPicker({ name, defaultValue }) {
  const [selected, setSelected] = useState(defaultValue);
  return (
    <div>
      <input type="hidden" name={name} value={selected} />
      <div className="color-row">
        {COLORS.map(c => (
          <span
            key={c}
            className={`color-opt${selected === c ? ' selected' : ''}`}
            style={{ background: c }}
            onClick={() => setSelected(c)}
          />
        ))}
      </div>
    </div>
  );
}
