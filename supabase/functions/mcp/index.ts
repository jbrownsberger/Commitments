/**
 * mcp — remote MCP server for TaskTriage (Streamable HTTP, stateless).
 *
 * Clients connect with a personal token from mcp-token (Authorization: Bearer cmt_…).
 * Exposes tools to list/create/update/delete tasks and list categories.
 *
 * Auth: personal MCP token (verify_jwt = false in config.toml)
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import {
  authenticateMcpToken,
  corsHeaders,
  hasAllowedOrigin,
  isJsonRpcRequest,
  isNotification,
  jsonResponse,
  respondJsonRpc,
  respondJsonRpcError,
  type JsonRpcRequest,
  wantsSse,
} from '../_shared/mcpAuth.ts';
import { TOOL_DEFINITIONS, callTool } from '../_shared/mcpTools.ts';

const SERVER_INFO = { name: 'task-triage', version: '1.0.0' };
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-03-26', '2025-06-18', '2025-11-25'];

function pickProtocolVersion(requested?: unknown): string {
  if (typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)) {
    return requested;
  }
  return SUPPORTED_PROTOCOL_VERSIONS.at(-1)!;
}

function hasSupportedProtocolVersion(req: Request): boolean {
  const version = req.headers.get('MCP-Protocol-Version');
  return !version || SUPPORTED_PROTOCOL_VERSIONS.includes(version);
}

async function handleJsonRpc(
  req: Request,
  message: JsonRpcRequest,
  userId: string,
  supabase: SupabaseClient,
): Promise<Response> {
  const { id, method, params } = message;

  // All JSON-RPC notifications are accepted with no response body.
  if (isNotification(message)) {
    return new Response(null, { status: 202, headers: corsHeaders });
  }

  switch (method) {
    case 'initialize':
      return respondJsonRpc(req, id, {
        protocolVersion: pickProtocolVersion(params?.protocolVersion),
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });

    case 'ping':
      return respondJsonRpc(req, id, {});

    case 'tools/list':
      return respondJsonRpc(req, id, { tools: TOOL_DEFINITIONS });

    case 'tools/call': {
      const toolName = params?.name;
      const toolArgs = (params?.arguments ?? {}) as Record<string, unknown>;
      if (typeof toolName !== 'string' || !toolName) {
        return respondJsonRpcError(req, id, -32602, 'tools/call requires params.name');
      }
      try {
        const result = await callTool(toolName, toolArgs, userId, supabase);
        return respondJsonRpc(req, id, result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return respondJsonRpcError(req, id, -32603, msg);
      }
    }

    default:
      return respondJsonRpcError(req, id, -32601, `Method not found: ${method ?? '(none)'}`);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (!hasAllowedOrigin(req)) {
    return jsonResponse({ error: 'Origin is not allowed' }, 403);
  }

  if (!hasSupportedProtocolVersion(req)) {
    return jsonResponse({
      error: 'Unsupported MCP protocol version',
      supported: SUPPORTED_PROTOCOL_VERSIONS,
    }, 400);
  }

  const auth = await authenticateMcpToken(req);
  if (!auth.ok) return auth.response;
  const { userId, supabase } = auth;

  // GET — optional SSE keepalive for clients that open a stream first.
  if (req.method === 'GET') {
    if (!wantsSse(req)) {
      return jsonResponse({
        name: SERVER_INFO.name,
        version: SERVER_INFO.version,
        transport: 'streamable-http',
        tools: TOOL_DEFINITIONS.map((t) => t.name),
      });
    }

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode(': connected\n\n'));
        // Stateless edge — close after priming; clients reconnect via POST.
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const contentType = req.headers.get('Content-Type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return jsonResponse({ error: 'Content-Type must be application/json' }, 415);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  if (Array.isArray(body)) {
    return respondJsonRpcError(req, null, -32600, 'MCP requests must not be batched');
  }

  if (!isJsonRpcRequest(body)) {
    return respondJsonRpcError(req, null, -32600, 'Invalid JSON-RPC request');
  }

  return handleJsonRpc(req, body as JsonRpcRequest, userId, supabase);
});
