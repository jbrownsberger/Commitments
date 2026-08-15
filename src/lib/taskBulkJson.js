/**
 * New-task JSON template + parser.
 * Distinct from backup import: always creates new tasks (new ids).
 */

const STATUSES = new Set(['not started', 'in progress', 'done', 'not-started', 'in-progress']);
const PRIORITIES = new Set(['low', 'med', 'medium', 'high', 'critical']);

export function buildNewTasksTemplate() {
  return {
    tasks: [
      {
        name: 'Example paper draft',
        due_date: '2026-08-24',
        estimatedHours: 8,
        category: '',
        notes: '',
        status: 'not started',
        priority: 'med',
        substeps: [
          { text: 'Outline', weight: 1 },
          { text: 'Draft', weight: 2 },
        ],
      },
      {
        name: 'Second task',
        due_date: '',
        estimatedHours: 2,
        category: '',
        notes: '',
        status: 'not started',
        priority: 'med',
        substeps: [],
      },
    ],
  };
}

export function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function pickName(raw) {
  const n = raw?.name ?? raw?.title ?? raw?.text;
  return typeof n === 'string' ? n.trim() : '';
}

function pickDue(raw) {
  const d = raw?.due_date ?? raw?.dueDate ?? raw?.deadline ?? '';
  if (!d || typeof d !== 'string') return null;
  const s = d.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return s.slice(0, 10);
}

function pickHours(raw) {
  const h = raw?.estimatedHours ?? raw?.estimated_hours ?? raw?.hours;
  const n = parseFloat(h);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function pickStatus(raw) {
  const s = String(raw?.status || 'not started').trim().toLowerCase().replace(/_/g, ' ');
  if (s === 'not-started') return 'not started';
  if (s === 'in-progress') return 'in progress';
  if (STATUSES.has(s)) return s === 'not-started' ? 'not started' : s;
  return 'not started';
}

function pickPriority(raw) {
  let p = String(raw?.priority || 'med').trim().toLowerCase();
  if (p === 'medium') p = 'med';
  return PRIORITIES.has(p) ? (p === 'medium' ? 'med' : p) : 'med';
}

function pickSubsteps(raw) {
  const list = raw?.substeps;
  if (!Array.isArray(list)) return [];
  return list
    .map((s, i) => {
      const text = String(s?.text ?? s?.title ?? s?.name ?? '').trim();
      if (!text) return null;
      const weight = parseFloat(s?.weight);
      return {
        text,
        done: !!s?.done,
        weight: Number.isFinite(weight) && weight > 0 ? weight : 1,
        position: s?.position ?? i,
      };
    })
    .filter(Boolean);
}

function resolveCategoryId(raw, categories) {
  const cats = categories || [];
  if (raw?.category_id) {
    const byId = cats.find(c => c.id === raw.category_id);
    if (byId) return byId.id;
  }
  const label = String(raw?.category ?? raw?.categoryName ?? raw?.cat ?? '').trim();
  if (label) {
    const byName = cats.find(c => c.name.toLowerCase() === label.toLowerCase());
    if (byName) return byName.id;
  }
  return cats[0]?.id ?? null;
}

export function extractTaskList(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.tasks)) return data.tasks;
  return null;
}

export function isBackupPayload(data) {
  return !!(data && !Array.isArray(data) && (data.exportedAt || data.version || data.categories || data.preferences));
}

/**
 * @returns {{ payloads: object[], errors: string[] }}
 */
export function parseNewTasksJson(data, categories) {
  const rows = extractTaskList(data);
  if (!rows) {
    return { payloads: [], errors: ['Invalid format: expected a tasks array or { "tasks": [...] }'] };
  }

  const errors = [];
  const payloads = [];

  rows.forEach((raw, i) => {
    const loc = `Task ${i + 1}`;
    if (!raw || typeof raw !== 'object') {
      errors.push(`${loc}: not an object`);
      return;
    }
    const name = pickName(raw);
    if (!name) {
      errors.push(`${loc}: missing name`);
      return;
    }
    const category_id = resolveCategoryId(raw, categories);
    if (!category_id) {
      errors.push(`${loc} (${name}): no category (add a category in the app, or set category)`);
      return;
    }
    payloads.push({
      category_id,
      name,
      status: pickStatus(raw),
      priority: pickPriority(raw),
      due_date: pickDue(raw),
      estimatedHours: pickHours(raw),
      notes: raw.notes ? String(raw.notes) : '',
      manual_progress: 0,
      recurring: false,
      substeps: pickSubsteps(raw),
      scheduled_days: [],
    });
  });

  return { payloads, errors };
}
