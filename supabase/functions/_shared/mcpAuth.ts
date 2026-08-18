/**
 * Shared helpers for MCP personal-token auth and HTTP responses.
 */
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, accept, mcp-session-id, mcp-protocol-version',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};

/**
 * The MCP Streamable HTTP transport requires Origin validation to prevent DNS
 * rebinding. Native/server-side MCP clients normally omit Origin. Browser
 * clients must be explicitly allow-listed through MCP_ALLOWED_ORIGINS.
 */
export function hasAllowedOrigin(req: Request): boolean {
  const origin = req.headers.get('Origin');
  if (!origin) return true;

  const allowedOrigins = (Deno.env.get('MCP_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return allowedOrigins.includes(origin);
}

export function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', ...extraHeaders },
  });
}

export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const b64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `cmt_${b64}`;
}

export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function extractBearerToken(req: Request): string | null {
  const auth = req.headers.get('Authorization') ?? '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export type McpAuthResult =
  | { ok: true; userId: string; tokenId: string; supabase: SupabaseClient }
  | { ok: false; response: Response };

/** Resolve a personal MCP token to a user_id (service-role DB access). */
export async function authenticateMcpToken(req: Request): Promise<McpAuthResult> {
  const token = extractBearerToken(req);
  if (!token) {
    return { ok: false, response: jsonResponse({ error: 'Missing Bearer token' }, 401) };
  }

  const tokenHash = await hashToken(token);
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: row, error } = await supabase
    .from('mcp_tokens')
    .select('id, user_id')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (error) {
    console.error('mcp token lookup failed:', error);
    return { ok: false, response: jsonResponse({ error: 'Token lookup failed' }, 500) };
  }
  if (!row) {
    return { ok: false, response: jsonResponse({ error: 'Invalid token' }, 401) };
  }

  // Best-effort last-used stamp; don't block the request on failure.
  supabase
    .from('mcp_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', row.id)
    .then(({ error: updateErr }) => {
      if (updateErr) console.warn('failed to update last_used_at:', updateErr);
    });

  return { ok: true, userId: row.user_id, tokenId: row.id, supabase };
}

export type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const message = value as JsonRpcRequest;
  return message.jsonrpc === '2.0' && typeof message.method === 'string';
}

export function isNotification(message: JsonRpcRequest): boolean {
  return message.id === undefined;
}

export function jsonRpcResult(id: string | number | null | undefined, result: unknown): Response {
  return jsonResponse({ jsonrpc: '2.0', id: id ?? null, result });
}

export function jsonRpcError(
  id: string | number | null | undefined,
  code: number,
  message: string,
  data?: unknown,
): Response {
  return jsonResponse({
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  });
}

/** Wrap a JSON-RPC response as a single SSE event when the client accepts streams. */
export function sseJsonRpcResponse(payload: Record<string, unknown>): Response {
  const body = `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
  return new Response(body, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

export function wantsSse(req: Request): boolean {
  const accept = req.headers.get('Accept') ?? '';
  return accept.includes('text/event-stream');
}

export function respondJsonRpc(
  req: Request,
  id: string | number | null | undefined,
  result: unknown,
): Response {
  const payload = { jsonrpc: '2.0', id: id ?? null, result };
  if (wantsSse(req)) return sseJsonRpcResponse(payload);
  return jsonResponse(payload);
}

export function respondJsonRpcError(
  req: Request,
  id: string | number | null | undefined,
  code: number,
  message: string,
  data?: unknown,
): Response {
  const payload = {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  };
  if (wantsSse(req)) return sseJsonRpcResponse(payload);
  return jsonResponse(payload);
}
