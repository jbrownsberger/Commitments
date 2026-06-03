import React, { useState } from 'react';
import Modal from './Modal.jsx';
import TaskPanel, { taskProgress, remainingHours, daysUntil, urgencyScore, urgencyColor, formatDate } from './TaskPanel.jsx';
import '../styles/categories.css';

const COLORS = [
  '#e05252','#e07a52','#d4a017','#5a9e5a','#3a86c8',
  '#7b5ea7','#c4607a','#4aadad','#888888','#2d2d2d',
];

const PRIORITY_LABELS = { low:'Low', med:'Medium', high:'High', critical:'Critical' };
const STATUS_LABELS   = { 'not started':'Not started', 'in progress':'In progress', done:'Done' };

export default function Categories({ appData, userId }) {
  const { categories, tasks, saveCategory, removeCategory, saveTask, removeTask,
          saveSubstep, removeSubstep } = appData;

  const [catModal,   setCatModal]   = useState(null);   // null | 'add' | {cat}
  const [taskModal,  setTaskModal]  = useState(null);   // null | { catId, task? }
  const [panelTask,  setPanelTask]  = useState(null);   // null | { task, cat }
  const [openCats,   setOpenCats]   = useState({});
  const [openCompl,  setOpenCompl]  = useState({});     // completed section per cat
  const [substepInputs, setSubstepInputs] = useState({});  // taskId → text

  // ── Helpers ────────────────────────────────────────────────────────────────
  const tasksFor = (catId) => (tasks || [])
    .filter(t => t.category_id === catId)
    .sort((a,b) => (a.position||0) - (b.position||0));

  const toggleCat   = (id) => setOpenCats(p   => ({ ...p, [id]: !p[id] }));
  const toggleCompl = (id) => setOpenCompl(p  => ({ ...p, [id]: !p[id] }));

  // Normalise field names — DB uses snake_case, original used camelCase
  const norm = (t) => ({
    ...t,
    due_date:        t.due_date        ?? t.dueDate        ?? null,
    estimated_hours: t.estimated_hours ?? t.estimatedHours ?? 1,
    manual_progress: t.manual_progress ?? t.manualProgress ?? 0,
    substeps:        t.substeps        ?? [],
  });

  const cycleStatus = async (task) => {
    const cycle = ['not started', 'in progress', 'done'];
    const cur   = cycle.indexOf(task.status);
    const next  = cycle[(cur + 1) % cycle.length];
    await saveTask({ ...task, status: next, manual_progress: next === 'done' ? 100 : task.manual_progress });
  };

  const openPanel = (task, cat) => setPanelTask({ task: norm(task), cat });

  // ── Category save ──────────────────────────────────────────────────────────
  const handleSaveCat = async (e) => {
    e.preventDefault();
    const fd    = new FormData(e.target);
    const name  = fd.get('name').trim();
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

  // ── Task save (modal form) ─────────────────────────────────────────────────
  const handleSaveTask = async (e) => {
    e.preventDefault();
    const fd       = new FormData(e.target);
    const existing = taskModal?.task || null;
    // Substeps from tempSubsteps state
    const rawSteps = (fd.get('substeps_raw') || '').split('||').filter(Boolean).map(t => ({ text: t, done: false, weight: 1 }));
    const substeps = existing?.substeps?.length ? existing.substeps : rawSteps;
    await saveTask({
      ...(existing || {}),
      category_id:     taskModal.catId,
      name:            fd.get('name').trim(),
      status:          fd.get('status'),
      priority:        fd.get('priority'),
      due_date:        fd.get('due_date')        || null,
      estimated_hours: parseFloat(fd.get('estimated_hours')) || 1,
      notes:           fd.get('notes')           || null,
      manual_progress: existing?.manual_progress ?? 0,
      substeps,
      position:        existing ? existing.position : tasksFor(taskModal.catId).length,
    });
    setTaskModal(null);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="cat-list">
      <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:'1rem' }}>
        <button className="btn btn-sm" onClick={() => setCatModal('add')}>+ Add category</button>
      </div>

      {categories.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">📂</div>
          <div className="empty-title">No categories yet</div>
          <div className="empty-sub">Categories group your tasks — create one to get started.</div>
        </div>
      )}

      {categories.map(cat => {
        const catTasks  = tasksFor(cat.id).map(norm);
        const incomplete = catTasks.filter(t => t.status !== 'done');
        const completed  = catTasks.filter(t => t.status === 'done');
        const isOpen     = !!openCats[cat.id];
        const complOpen  = !!openCompl[cat.id];

        return (
          <div key={cat.id} className="cat-card">
            <div className="cat-header" onClick={() => toggleCat(cat.id)}>
              <span className="cat-dot" style={{ background: cat.color }} />
              <span className="cat-title">{cat.name}</span>
              <span className="cat-meta">{completed.length}/{catTasks.length} done</span>
              <span className={`cat-chevron${isOpen ? ' open' : ''}`}>▶</span>
            </div>

            {isOpen && (
              <div className="cat-body">
                {cat.description && (
                  <div style={{ fontSize:12, color:'var(--color-text-secondary)', marginBottom:10 }}>{cat.description}</div>
                )}

                {/* Incomplete tasks */}
                <div className="task-list">
                  {incomplete.length === 0 && completed.length === 0 && (
                    <div style={{ fontSize:12, color:'var(--color-text-tertiary)', padding:'4px 0' }}>No tasks yet.</div>
                  )}
                  {incomplete.map(task => <TaskRow key={task.id} task={task} cat={cat} onCycle={cycleStatus} onOpen={openPanel} />)}
                </div>

                {/* Completed tasks — collapsible */}
                {completed.length > 0 && (
                  <div style={{ marginTop:8 }}>
                    <div
                      style={{ fontSize:12, color:'var(--color-text-secondary)', cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}
                      onClick={() => toggleCompl(cat.id)}
                    >
                      <span style={{ fontSize:10, transition:'transform 0.2s', display:'inline-block', transform: complOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
                      {completed.length} completed task{completed.length !== 1 ? 's' : ''}
                    </div>
                    {complOpen && (
                      <div className="task-list" style={{ marginTop:8, opacity:0.7 }}>
                        {completed.map(task => <TaskRow key={task.id} task={task} cat={cat} onCycle={cycleStatus} onOpen={openPanel} />)}
                      </div>
                    )}
                  </div>
                )}

                <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:10 }}>
                  <button className="btn btn-sm" onClick={() => setTaskModal({ catId: cat.id })}>+ Add task</button>
                  <button className="btn btn-sm" onClick={() => setCatModal(cat)}>Edit category</button>
                  <button className="btn btn-sm btn-danger" onClick={() => { if (window.confirm(`Delete "${cat.name}" and all its tasks?`)) removeCategory(cat.id); }}>Delete</button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* ── Category modal ── */}
      {catModal && (
        <Modal title={catModal === 'add' ? 'Add category' : 'Edit category'} onClose={() => setCatModal(null)}>
          <form onSubmit={handleSaveCat}>
            <div className="form-field">
              <label>Name</label>
              <input name="name" required autoFocus defaultValue={catModal !== 'add' ? catModal.name : ''} />
            </div>
            <div className="form-field">
              <label>Description (optional)</label>
              <input name="description" defaultValue={catModal !== 'add' ? catModal.description : ''} />
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

      {/* ── Add/Edit Task modal ── */}
      {taskModal && (
        <Modal title={taskModal.task ? 'Edit task' : 'Add task'} onClose={() => setTaskModal(null)}>
          <TaskForm
            key={taskModal.task?.id || 'new'}
            task={taskModal.task}
            onSave={handleSaveTask}
            onCancel={() => setTaskModal(null)}
          />
        </Modal>
      )}

      {/* ── Task detail panel ── */}
      {panelTask && (
        <TaskPanel
          task={panelTask.task}
          cat={panelTask.cat}
          onClose={() => setPanelTask(null)}
          onSave={async (updated) => { await saveTask(updated); }}
          onDelete={async (id)     => { await removeTask(id); setPanelTask(null); }}
          onEdit={(task) => setTaskModal({ catId: task.category_id, task })}
        />
      )}
    </div>
  );
}

// ── Task row (compact list item) ────────────────────────────────────────────
function TaskRow({ task, cat, onCycle, onOpen }) {
  const prog  = taskProgress(task);
  const rem   = remainingHours(task);
  const days  = daysUntil(task.due_date);
  const isDone = task.status === 'done';
  const isInProg = task.status === 'in progress';
  const isOverdue = !isDone && task.due_date && days < 0;

  const daysColor = isOverdue ? 'var(--color-text-danger)'
    : days !== null && days <= 3 ? '#BA7517'
    : 'var(--color-text-secondary)';

  const daysStr = !task.due_date ? ''
    : days < 0  ? `${Math.abs(days)}d overdue`
    : days === 0 ? 'today'
    : `${days}d`;

  return (
    <div className="task-item">
      <div className="task-row">
        <span
          className={`task-check${isDone ? ' done' : isInProg ? ' in-progress' : ''}`}
          onClick={e => { e.stopPropagation(); onCycle(task); }}
          title="Click to cycle status"
        >{isDone ? '✓' : isInProg ? '…' : ''}</span>
        <span
          className={`task-name${isDone ? ' done' : ''}`}
          style={{ cursor:'pointer', textDecorationLine:'underline', textDecorationStyle:'dotted', textUnderlineOffset:3 }}
          onClick={() => onOpen(task, cat)}
        >{task.name}</span>
        {isOverdue && <span className="badge" style={{ background:'var(--color-background-danger)', color:'var(--color-text-danger)', fontSize:10 }}>Overdue</span>}
        {task.due_date && <span className="task-due" style={{ color: daysColor }}>{daysStr}</span>}
        {rem > 0 && <span className="task-due" style={{ color:'var(--color-text-secondary)' }}>{parseFloat(rem).toFixed(1)}h</span>}
      </div>
      {prog > 0 && prog < 100 && (
        <div className="progress-track" style={{ height:3, marginTop:3, marginLeft:26 }}>
          <div className="progress-fill" style={{ width:`${prog}%` }} />
        </div>
      )}
    </div>
  );
}

// ── Task form ───────────────────────────────────────────────────────────────
function TaskForm({ task, onSave, onCancel }) {
  const [tempSubsteps, setTempSubsteps] = useState(
    task?.substeps?.map(s => s.text) || []
  );
  const [substepInput, setSubstepInput] = useState('');

  const addSubstep = () => {
    const text = substepInput.trim();
    if (!text) return;
    setTempSubsteps(p => [...p, text]);
    setSubstepInput('');
  };

  return (
    <form onSubmit={e => {
      // Inject substeps as hidden field
      const hidden = document.createElement('input');
      hidden.type  = 'hidden';
      hidden.name  = 'substeps_raw';
      hidden.value = tempSubsteps.join('||');
      e.target.appendChild(hidden);
      onSave(e);
    }}>
      <div className="form-field">
        <label>Name</label>
        <input name="name" required autoFocus defaultValue={task?.name || ''} />
      </div>
      <div className="form-field">
        <label>Status</label>
        <select name="status" defaultValue={task?.status || 'not started'}>
          {Object.entries(STATUS_LABELS).map(([v,l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div className="form-field">
        <label>Priority</label>
        <select name="priority" defaultValue={task?.priority || 'med'}>
          {Object.entries(PRIORITY_LABELS).map(([v,l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div className="form-field">
        <label>Due date</label>
        <input type="date" name="due_date" defaultValue={task?.due_date || ''} />
      </div>
      <div className="form-field">
        <label>Estimated hours</label>
        <input type="number" name="estimated_hours" min="0.25" step="0.25"
          defaultValue={task?.estimated_hours || 1} />
      </div>
      <div className="form-field">
        <label>Substeps</label>
        <div className="substep-entry">
          <input
            placeholder="Add a substep..."
            value={substepInput}
            onChange={e => setSubstepInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSubstep(); } }}
          />
          <button type="button" className="btn btn-sm" onClick={addSubstep}>Add</button>
        </div>
        <div className="added-substeps">
          {tempSubsteps.map((text, i) => (
            <div key={i} className="added-substep-item">
              <span>{text}</span>
              <button type="button" className="btn btn-sm btn-danger"
                onClick={() => setTempSubsteps(p => p.filter((_,j) => j !== i))}>×</button>
            </div>
          ))}
        </div>
      </div>
      <div className="form-field">
        <label>Notes</label>
        <textarea name="notes" defaultValue={task?.notes || ''} />
      </div>
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary">Save</button>
      </div>
    </form>
  );
}

// ── Color picker ─────────────────────────────────────────────────────────────
function ColorPicker({ name, defaultValue }) {
  const [selected, setSelected] = useState(defaultValue);
  return (
    <div>
      <input type="hidden" name={name} value={selected} />
      <div className="color-row">
        {COLORS.map(c => (
          <span key={c} className={`color-opt${selected === c ? ' selected' : ''}`}
            style={{ background: c }} onClick={() => setSelected(c)} />
        ))}
      </div>
    </div>
  );
}
