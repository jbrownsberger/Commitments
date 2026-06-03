import React, { useState, useRef, useCallback } from 'react';
import TaskPanel   from './TaskPanel.jsx';
import '../styles/planner.css';

// ── Constants ────────────────────────────────────────────────────────────────
const SHOW_WEEKS = 4;
const DAY_NAMES  = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

// ── Pure helpers ───────────────────────────────────────────────────────────────

function toISO(d) { return d.toISOString().slice(0, 10); }

function fmtShort(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function taskProgress(task) {
  const substeps = task.substeps || [];
  if (substeps.length === 0) return task.manual_progress ?? task.manualProgress ?? 0;
  const totalWeight = substeps.reduce((s, sub) => s + (sub.weight ?? 1), 0);
  if (totalWeight === 0) return 0;
  const doneWeight = substeps.filter(s => s.done).reduce((s, sub) => s + (sub.weight ?? 1), 0);
  return Math.round((doneWeight / totalWeight) * 100);
}

function remainingHours(task) {
  const est  = parseFloat(task.estimated_hours) || 1;
  return Math.max(0, est * (1 - taskProgress(task) / 100));
}

function buildISOs(weekOffset) {
  const today  = new Date(); today.setHours(0,0,0,0);
  const anchor = new Date(today);
  const dow    = anchor.getDay();
  anchor.setDate(anchor.getDate() + (dow === 0 ? -6 : 1 - dow) + weekOffset * 7);
  return Array.from({ length: SHOW_WEEKS * 7 }, (_, i) => {
    const d = new Date(anchor); d.setDate(d.getDate() + i); return toISO(d);
  });
}

function hoursOnDay(task, iso, todayISO) {
  const rem        = remainingHours(task);
  const futureDays = (task.scheduled_days || []).filter(d => d >= todayISO);
  if (!futureDays.length) return 0;
  const dayHours      = task.scheduled_day_hours || {};
  const explicitTotal = futureDays.reduce((s, d) => s + (dayHours[d] || 0), 0);
  const unweighted    = futureDays.filter(d => !dayHours[d]);
  const perUnweighted = unweighted.length > 0
    ? Math.max(rem - explicitTotal, 0) / unweighted.length : 0;
  return dayHours[iso] !== undefined ? dayHours[iso] : perUnweighted;
}

function autoFill(tasks, weeklyHours, sessionHours, allISOs) {
  const todayISO = toISO(new Date());
  const dayAvail = weeklyHours / 7;
  const DAYS     = 16 * 7;

  const dayLoad = {};
  for (const t of tasks) {
    if (!t.scheduled_days) continue;
    const rem        = remainingHours(t);
    const futureDays = t.scheduled_days.filter(d => d >= todayISO);
    if (!futureDays.length) continue;
    const dayHours      = t.scheduled_day_hours || {};
    const explicitTotal = futureDays.reduce((s, d) => s + (dayHours[d] || 0), 0);
    const unweighted    = futureDays.filter(d => !dayHours[d]);
    const perUw         = unweighted.length > 0
      ? Math.max(rem - explicitTotal, 0) / unweighted.length : 0;
    for (const d of futureDays) {
      dayLoad[d] = (dayLoad[d] || 0) + (dayHours[d] !== undefined ? dayHours[d] : perUw);
    }
  }

  const unscheduled = tasks
    .filter(t => t.status !== 'done' && !t.recurring &&
      (!t.scheduled_days || !t.scheduled_days.some(d => d >= todayISO)))
    .sort((a, b) => (a.due_date || '9999') < (b.due_date || '9999') ? -1 : 1);

  const updated = tasks.map(t => ({
    ...t,
    scheduled_days: t.scheduled_days ? [...t.scheduled_days] : [],
    scheduled_day_hours: { ...(t.scheduled_day_hours || {}) },
  }));
  const byId = Object.fromEntries(updated.map(t => [t.id, t]));
  const today = new Date(); today.setHours(0,0,0,0);

  for (const t of unscheduled) {
    const task = byId[t.id];
    if (!task) continue;
    const rem = remainingHours(task);
    if (rem <= 0) continue;
    const lastISO = task.due_date || (() => {
      const d = new Date(today); d.setDate(d.getDate() + DAYS); return toISO(d);
    })();
    const candidates = [];
    const cur = new Date(today);
    while (toISO(cur) <= lastISO) {
      const iso   = toISO(cur);
      const space = Math.max(dayAvail - (dayLoad[iso] || 0), 0);
      if (space > 0.05) candidates.push(iso);
      cur.setDate(cur.getDate() + 1);
    }
    if (candidates.length === 0) continue;
    const sessionsNeeded = Math.ceil(rem / sessionHours);
    const assignedDays   = sessionsNeeded <= candidates.length
      ? candidates.slice(-sessionsNeeded)
      : candidates;
    const hrsPerDay = rem / assignedDays.length;
    for (const iso of assignedDays) {
      const space  = Math.max(dayAvail - (dayLoad[iso] || 0), 0);
      const actual = Math.min(hrsPerDay, space);
      dayLoad[iso] = (dayLoad[iso] || 0) + actual;
    }
    task.scheduled_days = assignedDays;
  }
  return updated;
}

// ── Component ───────────────────────────────────────────────────────────────────

export default function Planner({ appData, userId, onEditTask }) {
  const { categories, tasks, preferences, saveTask, removeTask, setTaskSchedule } = appData;
  const weeklyHours  = preferences?.weekly_hours  ?? 20;
  const sessionHours = preferences?.session_hours ?? 1;
  const dayAvail     = weeklyHours / 7;

  const [weekOffset,  setWeekOffset]  = useState(0);
  const [openPopover, setOpenPopover] = useState(null);
  const [hrsInput,    setHrsInput]    = useState('');
  const [panelTask,   setPanelTask]   = useState(null);  // task detail panel
  const dragging = useRef(null);

  const today    = new Date(); today.setHours(0,0,0,0);
  const todayISO = toISO(today);
  const allISOs  = buildISOs(weekOffset);

  const catMap    = Object.fromEntries(categories.map(c => [c.id, c]));
  const allActive = tasks.filter(t => t.status !== 'done');

  const dayLoad        = {};
  const scheduledOnDay = {};
  const dueOnDay       = {};
  allISOs.forEach(iso => { dayLoad[iso] = 0; scheduledOnDay[iso] = []; dueOnDay[iso] = []; });

  for (const t of allActive) {
    if (t.due_date && dueOnDay[t.due_date] !== undefined) dueOnDay[t.due_date].push(t);
    if (!t.scheduled_days || t.scheduled_days.length === 0) continue;
    const rem        = remainingHours(t);
    if (rem <= 0) continue;
    const futureDays = t.scheduled_days.filter(d => d >= todayISO);
    for (const d of futureDays) {
      const hrs = hoursOnDay(t, d, todayISO);
      if (dayLoad[d]        !== undefined) dayLoad[d]        += hrs;
      if (scheduledOnDay[d] !== undefined) scheduledOnDay[d].push(t);
    }
  }

  const unscheduled = allActive.filter(
    t => !t.recurring && (!t.scheduled_days || !t.scheduled_days.some(d => allISOs.includes(d)))
  ).sort((a, b) => (a.due_date || '9999') < (b.due_date || '9999') ? -1 : 1);

  // ── Handlers
  const handleAutoFill = useCallback(async () => {
    const savePreferences = appData.savePreferences;
    const updated = autoFill(allActive, weeklyHours, sessionHours, allISOs);
    for (const t of updated) {
      const orig = tasks.find(x => x.id === t.id);
      const schedChanged = JSON.stringify(orig?.scheduled_days?.slice().sort()) !==
                           JSON.stringify(t.scheduled_days?.slice().sort());
      if (schedChanged) {
        await setTaskSchedule(t.id, t.scheduled_days);
        if (JSON.stringify(orig?.scheduled_day_hours) !== JSON.stringify(t.scheduled_day_hours)) {
          await saveTask({ ...orig, scheduled_day_hours: t.scheduled_day_hours });
        }
      }
    }
  }, [allActive, weeklyHours, sessionHours, allISOs, setTaskSchedule, saveTask, tasks, appData.savePreferences]);

  const handleClearAll = useCallback(async () => {
    if (!window.confirm('Remove all scheduled days from every task?')) return;
    for (const t of allActive) {
      if (t.scheduled_days && t.scheduled_days.length > 0) await setTaskSchedule(t.id, []);
    }
  }, [allActive, setTaskSchedule]);

  const onDragStart = (e, task) => { dragging.current = task; e.dataTransfer.effectAllowed = 'move'; };
  const onDragEnd   = () => { dragging.current = null; };

  const onDropDay = useCallback(async (e, iso) => {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    const t = dragging.current;
    if (!t) return;
    const days = t.scheduled_days || [];
    if (!days.includes(iso)) await setTaskSchedule(t.id, [...days, iso].sort());
    dragging.current = null;
  }, [setTaskSchedule]);

  const onDropSidebar = useCallback(async (e) => {
    e.preventDefault();
    const t = dragging.current;
    if (!t) return;
    await setTaskSchedule(t.id, []);
    dragging.current = null;
  }, [setTaskSchedule]);

  const removeDay = useCallback(async (task, iso) => {
    const days   = (task.scheduled_days || []).filter(d => d !== iso);
    const dayHrs = { ...(task.scheduled_day_hours || {}) };
    delete dayHrs[iso];
    await setTaskSchedule(task.id, days);
    if (JSON.stringify(task.scheduled_day_hours) !== JSON.stringify(dayHrs)) {
      await saveTask({ ...task, scheduled_day_hours: dayHrs });
    }
  }, [setTaskSchedule, saveTask]);

  const setDayHours = useCallback(async (task, iso, hrs) => {
    const dayHrs = { ...(task.scheduled_day_hours || {}), [iso]: Math.max(0, hrs) };
    await saveTask({ ...task, scheduled_day_hours: dayHrs });
    setOpenPopover(null);
  }, [saveTask]);

  const clearDayHours = useCallback(async (task, iso) => {
    const dayHrs = { ...(task.scheduled_day_hours || {}) };
    delete dayHrs[iso];
    await saveTask({ ...task, scheduled_day_hours: dayHrs });
    setOpenPopover(null);
  }, [saveTask]);

  // Open task panel (enrich with cat)
  const openPanel = (task) => {
    const cat = catMap[task.category_id];
    setPanelTask({ task, cat });
  };

  return (
    <div className="planner">
      {/* Controls */}
      <div className="planner-controls">
        <div className="planner-nav">
          <button className="btn btn-sm" onClick={() => setWeekOffset(w => w - 1)}>←</button>
          <button className="btn btn-sm" onClick={() => setWeekOffset(0)}>Today</button>
          <button className="btn btn-sm" onClick={() => setWeekOffset(w => w + 1)}>→</button>
        </div>
        <div className="planner-actions">
          <button className="btn btn-sm" onClick={handleAutoFill}>⚡ Auto-fill</button>
          <button className="btn btn-sm" onClick={handleClearAll}>Clear all</button>
        </div>
      </div>

      <div className="planner-layout">
        {/* Sidebar */}
        <div className="planner-sidebar" onDragOver={e => e.preventDefault()} onDrop={onDropSidebar}>
          <div className="sidebar-title">
            Unscheduled
            <span className="sidebar-count">{unscheduled.length}</span>
          </div>
          {unscheduled.length === 0 && <div className="sidebar-empty">All tasks scheduled ✔</div>}
          {unscheduled.map(task => (
            <SidebarCard
              key={task.id}
              task={task}
              cat={catMap[task.category_id]}
              allISOs={allISOs}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onRemoveDay={removeDay}
              onClick={() => openPanel(task)}
            />
          ))}
        </div>

        {/* Week grid */}
        <div className="planner-weeks">
          {Array.from({ length: SHOW_WEEKS }, (_, w) => {
            const weekISOs = allISOs.slice(w * 7, w * 7 + 7);
            return (
              <div key={w} className="planner-week">
                <div className="planner-day-headers">
                  {weekISOs.map((iso, i) => {
                    const isToday = iso === todayISO;
                    const isPast  = iso < todayISO;
                    return (
                      <div key={iso} className={`planner-day-header${isToday?' today':''}${isPast?' past':''}`}>
                        {DAY_NAMES[i]}<br />
                        <span className="planner-day-date">{fmtShort(iso)}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="planner-day-cols">
                  {weekISOs.map(iso => {
                    const load  = dayLoad[iso] || 0;
                    const over  = load > dayAvail + 0.05;
                    const isPast = iso < todayISO;
                    return (
                      <div
                        key={iso}
                        className={`planner-col${over?' over':''}${isPast?' past':''}`}
                        onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }}
                        onDragLeave={e => e.currentTarget.classList.remove('drag-over')}
                        onDrop={e => onDropDay(e, iso)}
                      >
                        {load > 0.05 && (
                          <div className={`day-load-badge${over?' over':''}`}>{load.toFixed(1)}h</div>
                        )}
                        {dueOnDay[iso]?.map(t => (
                          <div key={t.id} className="due-chip"
                            style={{ background: catMap[t.category_id]?.color || '#888' }}
                            title={`Due: ${t.name}`}>
                            📅 {t.name.slice(0, 12)}{t.name.length > 12 ? '…' : ''}
                          </div>
                        ))}
                        {scheduledOnDay[iso]?.map(t => {
                          const cat      = catMap[t.category_id];
                          const hrs      = hoursOnDay(t, iso, todayISO);
                          const isCustom = (t.scheduled_day_hours || {})[iso] !== undefined;
                          const popKey   = `${t.id}-${iso}`;
                          return (
                            <PlannerTaskCard
                              key={t.id}
                              task={t}
                              cat={cat}
                              iso={iso}
                              hrs={hrs}
                              isCustom={isCustom}
                              isPopoverOpen={openPopover === popKey}
                              hrsInput={hrsInput}
                              onDragStart={onDragStart}
                              onDragEnd={onDragEnd}
                              onRemove={() => removeDay(t, iso)}
                              onOpen={() => openPanel(t)}
                              onTogglePopover={() => {
                                if (openPopover === popKey) { setOpenPopover(null); }
                                else { setHrsInput(hrs.toFixed(1)); setOpenPopover(popKey); }
                              }}
                              onSetHours={() => setDayHours(t, iso, parseFloat(hrsInput))}
                              onClearHours={() => clearDayHours(t, iso)}
                              onHrsInputChange={setHrsInput}
                            />
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Task detail panel */}
      {panelTask && (
        <TaskPanel
          task={panelTask.task}
          cat={panelTask.cat}
          onClose={() => setPanelTask(null)}
          onSave={async (updated) => { await saveTask(updated); setPanelTask(null); }}
          onDelete={async (id) => { await removeTask(id); setPanelTask(null); }}
          onEdit={(task) => { setPanelTask(null); onEditTask(task); }}
        />
      )}
    </div>
  );
}

// ── PlannerTaskCard ──────────────────────────────────────────────────────────────
function PlannerTaskCard({
  task, cat, iso, hrs, isCustom,
  isPopoverOpen, hrsInput,
  onDragStart, onDragEnd, onRemove, onOpen,
  onTogglePopover, onSetHours, onClearHours, onHrsInputChange,
}) {
  const color = cat?.color || '#888';
  const due   = task.due_date ? ` · due ${fmtShort(task.due_date)}` : '';
  return (
    <div
      className="planner-task-card"
      style={{ background: color }}
      draggable
      onDragStart={e => onDragStart(e, task)}
      onDragEnd={onDragEnd}
    >
      <div className="card-body" onClick={onOpen} style={{ cursor:'pointer' }}>
        <div className="card-name">{task.name.slice(0,22)}{task.name.length>22?'…':''}</div>
        <div className="card-meta">
          <button
            className={`hrs-badge${isCustom?' hrs-custom':''}`}
            onClick={e => { e.stopPropagation(); onTogglePopover(); }}
            title="Click to adjust hours"
          >{hrs.toFixed(1)}h</button>
          {due && <span className="card-due">{due}</span>}
        </div>
        {isPopoverOpen && (
          <div className="hrs-popover" onClick={e => e.stopPropagation()}>
            <div className="hrs-popover-label">Hours on this day</div>
            <div className="hrs-popover-row">
              <input type="number" min="0" step="0.5"
                value={hrsInput}
                onChange={e => onHrsInputChange(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') onSetHours(); }}
                autoFocus />
              <button onClick={onSetHours}>Set</button>
              {isCustom && <button onClick={onClearHours} title="Reset to auto">↺</button>}
            </div>
          </div>
        )}
      </div>
      <button className="card-remove" onClick={e => { e.stopPropagation(); onRemove(); }} title="Remove from this day">×</button>
    </div>
  );
}

// ── SidebarCard ──────────────────────────────────────────────────────────────────
function SidebarCard({ task, cat, allISOs, onDragStart, onDragEnd, onRemoveDay, onClick }) {
  const color   = cat?.color || '#888';
  const due     = task.due_date ? `due ${fmtShort(task.due_date)}` : 'no deadline';
  const rem     = remainingHours(task);
  const visible = (task.scheduled_days || []).filter(d => allISOs.includes(d));
  return (
    <div
      className="sidebar-card"
      style={{ borderLeftColor: color }}
      draggable
      onDragStart={e => onDragStart(e, task)}
      onDragEnd={onDragEnd}
      onClick={onClick}
      title="Click to view · Drag to schedule"
    >
      <div className="sidebar-card-name">{task.name}</div>
      <div className="sidebar-card-meta">{rem.toFixed(1)}h remaining · {due}</div>
      {visible.length > 0 && (
        <div className="sidebar-days">
          {visible.map(d => (
            <span key={d} className="sidebar-day-chip">
              {fmtShort(d)}
              <button onClick={e => { e.stopPropagation(); onRemoveDay(task, d); }}>×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
