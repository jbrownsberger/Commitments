import React, { useState } from 'react';
import Modal from './Modal.jsx';
import TaskPanel, { taskProgress, remainingHours, daysUntil, urgencyScore, urgencyColor, formatDate } from './TaskPanel.jsx';
import '../styles/categories.css';

const COLORS = [
  '#e05252','#e07a52','#d4a017','#5a9e5a','#3a86c8',
  '#7b5ea7','#c4607a','#4aadad','#888888','#2d2d2d',
];

const PRIORITY_LABELS = { low:'Low', med:'Medium', high:'High', critical:'Critical' };
const STATUS_OPTS = [
  { val:'not started',  label:'Not started' },
  { val:'in progress',  label:'In progress' },
  { val:'done',         label:'Done' },
];

export default function Categories({ appData, userId, onAddTask, onEditTask }) {
  const { categories, tasks, saveCategory, removeCategory, saveTask, removeTask,
          saveSubstep, removeSubstep } = appData;

  const [catModal,    setCatModal]    = useState(null);
  const [panelTask,   setPanelTask]   = useState(null);
  const [openCats,    setOpenCats]    = useState({});
  const [openCompl,   setOpenCompl]   = useState({});

  // ── Helpers ──────────────────────────────────────────────────────────────
  const tasksFor = (catId) => (tasks || [])
    .filter(t => t.category_id === catId)
    .sort((a, b) => (a.position || 0) - (b.position || 0));

  const toggleCat   = (id) => setOpenCats(p  => ({ ...p, [id]: !p[id] }));
  const toggleCompl = (id) => setOpenCompl(p => ({ ...p, [id]: !p[id] }));

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

  // ── Category save ────────────────────────────────────────────────────────
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
      position: existing ? existing.position : (categories.length),
    });
    setCatModal(null);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div>
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
          const catTasks   = tasksFor(cat.id).map(norm);
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
                  <div className="task-list">
                    {incomplete.length === 0 && completed.length === 0 && (
                      <div style={{ fontSize:12, color:'var(--color-text-tertiary)', padding:'4px 0' }}>No tasks yet.</div>
                    )}
                    {incomplete.map(task => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        cat={cat}
                        onCycle={cycleStatus}
                        onOpen={openPanel}
                        badge={task.recurring ? (task.recurring_cadence || 'daily') : null}
                      />
                    ))}
                  </div>

                  {completed.length > 0 && (
                    <div style={{ marginTop:8 }}>
                      <div
                        style={{ fontSize:12, color:'var(--color-text-secondary)', cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}
                        onClick={() => toggleCompl(cat.id)}
                      >
                        <span style={{ fontSize:10, transition:'transform 0.2s', display:'inline-block', transform: complOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
                        {completed.length} completed
                      </div>
                      {complOpen && (
                        <div className="task-list" style={{ marginTop:8, opacity:0.7 }}>
                          {completed.map(task => (
                            <TaskRow
                              key={task.id}
                              task={task}
                              cat={cat}
                              onCycle={cycleStatus}
                              onOpen={openPanel}
                              badge={task.recurring ? (task.recurring_cadence || 'daily') : null}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:10 }}>
                    <button
                      className="btn btn-sm"
                      onClick={() => onAddTask && onAddTask(cat.id)}
                    >+ Add task</button>
                    <button className="btn btn-sm" onClick={() => setCatModal(cat)}>Edit</button>
                    <button className="btn btn-sm btn-danger" onClick={() => {
                      if (window.confirm(`Delete "${cat.name}" and all its tasks?`)) removeCategory(cat.id);
                    }}>Delete</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Category modal ── */}
      {catModal && (
        <Modal title={catModal === 'add' ? 'Add category' : 'Edit category'} onClose={() => setCatModal(null)}>
          <form onSubmit={handleSaveCat}>
            <div className="form-field">
              <label>Name</label>
              <input name="name" required defaultValue={catModal !== 'add' ? catModal.name : ''} autoFocus />
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

      {/* ── Task detail panel ── */}
      {panelTask && (
        <TaskPanel
          task={panelTask.task}
          cat={panelTask.cat}
          onClose={() => setPanelTask(null)}
          onSave={async (updated) => {
            await saveTask(updated);
            // Update the panel's local task reference so it stays in sync,
            // but do NOT close the panel — only Close/Edit/Delete should do that.
            setPanelTask(prev => prev ? { ...prev, task: updated } : null);
          }}
          onDelete={async (id) => { await removeTask(id); setPanelTask(null); }}
          onEdit={(task) => {
            setPanelTask(null);
            onEditTask && onEditTask(task);
          }}
        />
      )}
    </div>
  );
}

// ── TaskRow ───────────────────────────────────────────────────────────────────

function TaskRow({ task, cat, onCycle, onOpen, badge }) {
  const prog     = taskProgress(task);
  const isDone   = task.status === 'done';
  const isInProg = task.status === 'in progress';
  const days     = daysUntil(task.due_date);
  const isOverdue = !isDone && task.due_date && days < 0;
  const daysStr = !task.due_date ? ''
    : days < 0  ? `${Math.abs(days)}d overdue`
    : days === 0 ? 'today'
    : `${days}d`;

  return (
    <div className="task-item">
      <div className="task-row" onClick={() => onOpen(task, cat)}>
        <span
          className={`task-check${isDone ? ' done' : isInProg ? ' in-progress' : ''}`}
          onClick={e => { e.stopPropagation(); onCycle(task); }}
          title="Cycle status"
        >{isDone ? '✓' : isInProg ? '…' : ''}</span>
        <span className={`task-name${isDone ? ' done' : ''}`}>{task.name}</span>
        {badge && (
          <span className="badge" style={{ background:'var(--color-bg-info)', color:'var(--color-text-info)', fontSize:10 }}>
            {badge}
          </span>
        )}
        {task.priority && task.priority !== 'med' && (
          <span className={`badge badge-${task.priority}`}>
            {task.priority === 'critical' ? '!!' : task.priority}
          </span>
        )}
        {task.due_date && (
          <span className="task-due" style={{ color: isOverdue ? 'var(--color-text-danger)' : '' }}>
            {daysStr}
          </span>
        )}
      </div>
      {prog > 0 && prog < 100 && (
        <div className="progress-track" style={{ margin:'0 12px 8px', height:3 }}>
          <div className="progress-fill" style={{ width:`${prog}%` }} />
        </div>
      )}
    </div>
  );
}

// ── ColorPicker ───────────────────────────────────────────────────────────────

function ColorPicker({ name, defaultValue }) {
  const [selected, setSelected] = useState(defaultValue || COLORS[0]);
  return (
    <div>
      <input type="hidden" name={name} value={selected} />
      <div className="color-row">
        {COLORS.map(c => (
          <div
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
