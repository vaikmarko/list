/**
 * Admin endpoint - fault_reports D1 logide vaatamine.
 *
 * GET /api/admin/fault-logs
 *   Headers: Authorization: Bearer <CF_ADMIN_KEY>   (voi ?key=...)
 *   Query parameters (koik valikulised):
 *     limit   - vaikimisi 100, max 1000
 *     offset  - vaikimisi 0
 *     email   - filter watcher_email (LIKE)
 *     event   - fault.ok / fault.duplicate / fault.upstream_error / fault.validation_error / fault.misconfig
 *     status  - filter hausing_status
 *     ticket  - filter hausing_ticket_number (LIKE)
 *     since   - ts >= ISO timestamp
 *
 * Koik kirjed terminalist:
 *   npx wrangler d1 execute list-parking-log --remote --command "SELECT * FROM fault_reports ORDER BY ts DESC LIMIT 100"
 */

interface Env {
  DB: D1Database;
  CF_ADMIN_KEY: string;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function timingSafeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx;
  const url = new URL(request.url);

  if (!env.CF_ADMIN_KEY) {
    return jsonResponse(500, { ok: false, error: "admin_not_configured" });
  }
  const auth = request.headers.get("Authorization") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  const provided = bearer || url.searchParams.get("key") || "";
  if (!provided || !timingSafeEquals(provided, env.CF_ADMIN_KEY)) {
    return jsonResponse(401, { ok: false, error: "unauthorized" });
  }
  if (!env.DB) {
    return jsonResponse(500, { ok: false, error: "db_not_bound" });
  }

  const limitRaw = parseInt(url.searchParams.get("limit") || "100", 10);
  const limit = Math.max(1, Math.min(1000, Number.isFinite(limitRaw) ? limitRaw : 100));
  const offsetRaw = parseInt(url.searchParams.get("offset") || "0", 10);
  const offset = Math.max(0, Number.isFinite(offsetRaw) ? offsetRaw : 0);
  const email = url.searchParams.get("email");
  const event = url.searchParams.get("event");
  const statusFilter = url.searchParams.get("status");
  const ticket = url.searchParams.get("ticket");
  const since = url.searchParams.get("since");

  const where: string[] = [];
  const args: unknown[] = [];
  if (email) {
    where.push("watcher_email LIKE ?");
    args.push(`%${email.toLowerCase()}%`);
  }
  if (event) {
    where.push("event = ?");
    args.push(event);
  }
  if (statusFilter) {
    where.push("hausing_status = ?");
    args.push(statusFilter);
  }
  if (ticket) {
    where.push("hausing_ticket_number LIKE ?");
    args.push(`%${ticket}%`);
  }
  if (since) {
    where.push("ts >= ?");
    args.push(since);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  try {
    const totalRes = await env.DB.prepare(`SELECT COUNT(*) AS c FROM fault_reports ${whereSql}`)
      .bind(...args)
      .first<{ c: number }>();
    const rowsRes = await env.DB.prepare(
      `SELECT id, ts, client_request_id, event, hausing_ticket_id, hausing_ticket_number,
              hausing_status, resolution, category, title, building_id, room_id,
              watcher_email, user_name, tenant_id, tenant_name,
              ip, country, error_code, error_message, duration_ms, updated_at
       FROM fault_reports
       ${whereSql}
       ORDER BY ts DESC, id DESC
       LIMIT ? OFFSET ?`,
    )
      .bind(...args, limit, offset)
      .all();

    return jsonResponse(200, {
      ok: true,
      total: totalRes?.c ?? 0,
      count: rowsRes.results?.length ?? 0,
      limit,
      offset,
      filters: { email, event, status: statusFilter, ticket, since },
      rows: rowsRes.results ?? [],
    });
  } catch (err) {
    console.error("admin.fault-logs: query failed", err);
    return jsonResponse(500, { ok: false, error: "query_failed", message: "Query failed. Check Function logs." });
  }
};

export const onRequest: PagesFunction<Env> = async ({ request }) => {
  if (request.method === "GET") {
    return jsonResponse(500, { ok: false, error: "routing" });
  }
  return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), {
    status: 405,
    headers: { "Content-Type": "application/json", Allow: "GET" },
  });
};
