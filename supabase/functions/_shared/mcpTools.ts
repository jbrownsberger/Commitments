/**
 * MCP tool handlers — task and category CRUD scoped to one user.
 */
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
};

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'list_tasks',
    description:
      'List the user\'s tasks. Excludes hidden recurring series templates. Returns id, name, status, priority, due_date, category_id, notes, progress, and estimated_hours.',
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['not-started', 'in-progress', 'done'],
          description: 'Filter by task status',
        },
        due_before: { type: 'string', description: 'ISO date (YYYY-MM-DD) — tasks due on or before this date' },
        due_after: { type: 'string', description: 'ISO date (YYYY-MM-DD) — tasks due on or after this date' },
        limit: { type: 'number', description: 'Max rows to return (default 50, max 200)' },
      },
    },
  },
  {
    name: 'get_task',
    description: 'Get a single task by id, including substeps.',
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Task UUID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_task',
    description: 'Create a new task for the user.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Task title' },
        status: {
          type: 'string',
          enum: ['not-started', 'in-progress', 'done'],
          description: 'Defaults to not-started',
        },
        priority: { type: 'string', enum: ['low', 'med', 'high'], description: 'Defaults to med' },
        due_date: { type: 'string', description: 'Due date YYYY-MM-DD' },
        category_id: { type: 'string', description: 'Category UUID' },
        notes: { type: 'string' },
        estimated_hours: { type: 'number', description: 'Defaults to 1' },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_task',
    description: 'Update fields on an existing task. Only provided fields are changed.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Task UUID' },
        name: { type: 'string' },
        status: { type: 'string', enum: ['not-started', 'in-progress', 'done'] },
        priority: { type: 'string', enum: ['low', 'med', 'high'] },
        due_date: { type: 'string', description: 'YYYY-MM-DD or null to clear' },
        category_id: { type: 'string', description: 'Category UUID or null to clear' },
        notes: { type: 'string' },
        progress: { type: 'number', description: '0–100 manual progress' },
        estimated_hours: { type: 'number' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_task',
    description: 'Permanently delete a task by id.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Task UUID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'list_categories',
    description: 'List the user\'s task categories (id, name, color, position).',
    annotations: { readOnlyHint: true, openWorldHint: false },
    inputSchema: { type: 'object', properties: {} },
  },
];

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

function textResult(data: unknown, isError = false): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    isError,
  };
}

function errResult(message: string): ToolResult {
  return textResult({ error: message }, true);
}

const TASK_COLUMNS =
  'id, name, status, priority, due_date, category_id, notes, progress, estimated_hours, position, recurring, is_recurring_template, updated_at';

export async function callTool(
  name: string,
  args: Record<string, unknown>,
  userId: string,
  supabase: SupabaseClient,
): Promise<ToolResult> {
  switch (name) {
    case 'list_tasks':
      return listTasks(args, userId, supabase);
    case 'get_task':
      return getTask(args, userId, supabase);
    case 'create_task':
      return createTask(args, userId, supabase);
    case 'update_task':
      return updateTask(args, userId, supabase);
    case 'delete_task':
      return deleteTask(args, userId, supabase);
    case 'list_categories':
      return listCategories(userId, supabase);
    default:
      return errResult(`Unknown tool: ${name}`);
  }
}

async function listTasks(
  args: Record<string, unknown>,
  userId: string,
  supabase: SupabaseClient,
): Promise<ToolResult> {
  const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 200);

  let query = supabase
    .from('tasks')
    .select(TASK_COLUMNS)
    .eq('user_id', userId)
    .or('is_recurring_template.is.null,is_recurring_template.eq.false')
    .order('position')
    .limit(limit);

  if (args.status && typeof args.status === 'string') {
    query = query.eq('status', args.status);
  }
  if (args.due_before && typeof args.due_before === 'string') {
    query = query.lte('due_date', args.due_before);
  }
  if (args.due_after && typeof args.due_after === 'string') {
    query = query.gte('due_date', args.due_after);
  }

  const { data, error } = await query;
  if (error) return errResult(error.message);
  return textResult({ tasks: data ?? [], count: data?.length ?? 0 });
}

async function getTask(
  args: Record<string, unknown>,
  userId: string,
  supabase: SupabaseClient,
): Promise<ToolResult> {
  const id = args.id;
  if (typeof id !== 'string' || !id) return errResult('id is required');

  const { data: task, error } = await supabase
    .from('tasks')
    .select(`${TASK_COLUMNS}, substeps(id, text, done, weight, position)`)
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) return errResult(error.message);
  if (!task) return errResult('Task not found');
  return textResult({ task });
}

async function createTask(
  args: Record<string, unknown>,
  userId: string,
  supabase: SupabaseClient,
): Promise<ToolResult> {
  const name = args.name;
  if (typeof name !== 'string' || !name.trim()) return errResult('name is required');

  const { data: maxPosRow } = await supabase
    .from('tasks')
    .select('position')
    .eq('user_id', userId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();

  const row: Record<string, unknown> = {
    user_id: userId,
    name: name.trim(),
    status: typeof args.status === 'string' ? args.status : 'not-started',
    priority: typeof args.priority === 'string' ? args.priority : 'med',
    estimated_hours: typeof args.estimated_hours === 'number' ? args.estimated_hours : 1,
    progress: 0,
    position: (maxPosRow?.position ?? 0) + 1,
    recurring: false,
    is_recurring_template: false,
  };

  if (typeof args.due_date === 'string') row.due_date = args.due_date;
  if (typeof args.category_id === 'string') row.category_id = args.category_id;
  if (typeof args.notes === 'string') row.notes = args.notes;

  const { data, error } = await supabase.from('tasks').insert(row).select(TASK_COLUMNS).single();
  if (error) return errResult(error.message);
  return textResult({ task: data });
}

async function updateTask(
  args: Record<string, unknown>,
  userId: string,
  supabase: SupabaseClient,
): Promise<ToolResult> {
  const id = args.id;
  if (typeof id !== 'string' || !id) return errResult('id is required');

  const fields: Record<string, unknown> = {};
  if (typeof args.name === 'string') fields.name = args.name.trim();
  if (typeof args.status === 'string') fields.status = args.status;
  if (typeof args.priority === 'string') fields.priority = args.priority;
  if (typeof args.notes === 'string') fields.notes = args.notes;
  if (typeof args.progress === 'number') fields.progress = args.progress;
  if (typeof args.estimated_hours === 'number') fields.estimated_hours = args.estimated_hours;
  if (args.due_date === null) fields.due_date = null;
  else if (typeof args.due_date === 'string') fields.due_date = args.due_date;
  if (args.category_id === null) fields.category_id = null;
  else if (typeof args.category_id === 'string') fields.category_id = args.category_id;

  if (Object.keys(fields).length === 0) return errResult('No fields to update');

  const { data, error } = await supabase
    .from('tasks')
    .update(fields)
    .eq('id', id)
    .eq('user_id', userId)
    .select(TASK_COLUMNS)
    .maybeSingle();

  if (error) return errResult(error.message);
  if (!data) return errResult('Task not found');
  return textResult({ task: data });
}

async function deleteTask(
  args: Record<string, unknown>,
  userId: string,
  supabase: SupabaseClient,
): Promise<ToolResult> {
  const id = args.id;
  if (typeof id !== 'string' || !id) return errResult('id is required');

  const { error, count } = await supabase
    .from('tasks')
    .delete({ count: 'exact' })
    .eq('id', id)
    .eq('user_id', userId);

  if (error) return errResult(error.message);
  if (!count) return errResult('Task not found');
  return textResult({ ok: true, id });
}

async function listCategories(userId: string, supabase: SupabaseClient): Promise<ToolResult> {
  const { data, error } = await supabase
    .from('categories')
    .select('id, name, color, position')
    .eq('user_id', userId)
    .order('position');

  if (error) return errResult(error.message);
  return textResult({ categories: data ?? [], count: data?.length ?? 0 });
}
