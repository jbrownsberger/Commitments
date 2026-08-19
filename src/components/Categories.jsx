import React, { useState } from 'react';
import Modal from './Modal.jsx';
import TaskPanel, { taskProgress, remainingHours, daysUntil, urgencyScore, urgencyColor, formatDate, cadenceLabel } from './TaskPanel.jsx';
import { isWorkTask, isSeriesInstance } from '../lib/recurrence.js';
import { CATEGORY_COLORS } from '../lib/palette.js';
import { LINK_TYPES, normaliseTaskLink, normaliseTaskLinks } from '../lib/taskLinks.js';
import '../styles/categories.css';

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
  const [categoryLinks, setCategoryLinks] = useState([]);

  // ── Helpers ──────────────────────────────────────────────────────────────
  const tasksFor = (catId) => (tasks || [])
    .filter(t => t.category_id === catId && isWorkTask(t))
    .sort((a, b) => (a.position || 0) - (b.position || 0));

  const taskBadge = (task) => {
    if (task.recurring) return cadenceLabel(task) || 'recurring';
    if (isSeriesInstance(task)) return 'series';
    return null;
  };

  const toggleCat   = (id) => setOpenCats(p  => ({ ...p, [id]: !p[id] }));
  const toggleCompl = (id) => setOpenCompl(p => ({ ...p, [id]: !p[id] }));
  const openCategoryModal = (category) => {
    setCategoryLinks(normaliseTaskLinks(category === 'add' ? [] : category.links));
    setCatModal(category);
  };

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
      name, color, links: categoryLinks,
      position: existing ? existing.position : (categories.length),
    });
    setCatModal(null);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div>
      <div className="cat-list">
        <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:'1rem' }}>
          <button className="btn btn-sm" onClick={() => openCategoryModal('add')}>+ Add category</button>
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
                        badge={taskBadge(task)}
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
                              badge={taskBadge(task)}
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
                    <button className="btn btn-sm" onClick={() => openCategoryModal(cat)}>Edit</button>
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
              <ColorPicker name="color" defaultValue={catModal !== 'add' ? catModal.color : CATEGORY_COLORS[0]} />
            </div>
            <CategoryLinksEditor links={categoryLinks} onChange={setCategoryLinks} />
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
            const saved = await saveTask(updated);
            // Use returned row (rolling may have advanced). Keep panel open.
            setPanelTask(prev => prev ? { ...prev, task: saved || updated } : null);
            return saved;
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
  const [selected, setSelected] = useState(defaultValue || CATEGORY_COLORS[0]);
  return (
    <div>
      <input type="hidden" name={name} value={selected} />
      <div className="color-row">
        {CATEGORY_COLORS.map(c => (
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

function CategoryLinksEditor({ links, onChange }) {
  const [type, setType] = useState('web');
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  const add = () => {
    const link = normaliseTaskLink({ type, label, value });
    if (!link) {
      setError(type === 'email' ? 'Enter a valid email address.' : type === 'shortcut' ? 'Enter the Shortcut name.' : 'Enter a valid web address.');
      return;
    }
    onChange([...links, link]);
    setLabel('');
    setValue('');
    setError('');
  };

  return (
    <div className="form-field">
      <label>Default links</label>
      <div style={{ marginBottom: 6, color: 'var(--color-text-tertiary)', fontSize: 12 }}>
        These appear automatically on every task in this category.
      </div>
      {links.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 8 }}>
          {links.map((link, i) => (
            <div key={`${link.type}-${link.value}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <span style={{ color: 'var(--color-text-tertiary)', minWidth: 80 }}>{LINK_TYPES.find(item => item.value === link.type)?.label}</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{link.label}</span>
              <button type="button" className="btn btn-sm btn-danger" style={{ padding: '1px 8px', fontSize: 11 }}
                aria-label={`Remove ${link.label}`} onClick={() => onChange(links.filter((_, idx) => idx !== i))}>✕</button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <select value={type} onChange={e => { setType(e.target.value); setError(''); }} style={{ width: 116 }}>
          {LINK_TYPES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Label (optional)" style={{ flex: '1 1 120px' }} />
        <input value={value} onChange={e => { setValue(e.target.value); setError(''); }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder={type === 'email' ? 'name@example.com' : type === 'shortcut' ? 'Shortcut name' : 'https://example.com'} style={{ flex: '2 1 180px' }} />
        <button type="button" className="btn btn-sm" onClick={add}>Add link</button>
      </div>
      {error && <div style={{ marginTop: 5, color: 'var(--color-text-danger)', fontSize: 12 }}>{error}</div>}
    </div>
  );
}
