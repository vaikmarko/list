/**
 * Admin endpoint - parking_events D1 logide vaatamine.
 *
 * GET /api/admin/logs
 *   Headers: Authorization: Bearer <CF_ADMIN_KEY>
 *           (v6i query param ?key=...)
 *   Query parameters (k6ik valikulised):
 *     limit   - mitu kirjet tagastada (vaikimisi 100, max 1000)
 *     offset  - alusta N kirjest (vaikimisi 0)
 *     floor   - filter 5 v6i 6
 *     plate   - filter autonumber (osaline match LIKE)
 *     email   - filter user_email (osaline match LIKE)
 *     event   - filter event tyyp (park.ok / park.upstream_error / park.validation_error / park.misconfig)
 *     since   - filter ts >= ISO timestamp (nt 2026-05-25T00:00:00Z)
 *
 * Response:
 *   { ok: true, count: N, total: M, rows: [...] }
 *
 * KOIK kirjed - kasuta wrangler d1 execute kohaliku terminali kaudu:
 *   npx wrangler d1 execute list-parking-log --remote --command "SELECT * FROM parking_events ORDER BY ts DESC LIMIT 100"
 */

interface Env {
  DB: D1Database;
  CF_ADMIN_KEY: string;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
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

  // Auth: Bearer header v6i ?key= query param
  if (!env.CF_ADMIN_KEY) {
    return jsonResponse(500, { ok: false, error: "admin_not_configured" });
  }
  const auth = request.headers.get("Authorization") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  const queryKey = url.searchParams.get("key");
  const provided = bearer || queryKey || "";
  if (!provided || !timingSafeEquals(provided, env.CF_ADMIN_KEY)) {
    return jsonResponse(401, { ok: false, error: "unauthorized" });
  }

  if (!env.DB) {
    return jsonResponse(500, { ok: false, error: "db_not_bound" });
  }

  // Filtrid
  const limitRaw = parseInt(url.searchParams.get("limit") || "100", 10);
  const limit = Math.max(1, Math.min(1000, Number.isFinite(limitRaw) ? limitRaw : 100));
  const offsetRaw = parseInt(url.searchParams.get("offset") || "0", 10);
  const offset = Math.max(0, Number.isFinite(offsetRaw) ? offsetRaw : 0);
  const floor = url.searchParams.get("floor");
  const plate = url.searchParams.get("plate");
  const email = url.searchParams.get("email");
  const event = url.searchParams.get("event");
  const since = url.searchParams.get("since");

  const where: string[] = [];
  const args: unknown[] = [];
  if (floor === "5" || floor === "6") {
    where.push("floor = ?");
    args.push(floor);
  }
  if (plate) {
    where.push("plate LIKE ?");
    args.push(`%${plate.toUpperCase()}%`);
  }
  if (email) {
    where.push("user_email LIKE ?");
    args.push(`%${email.toLowerCase()}%`);
  }
  if (event) {
    where.push("event = ?");
    args.push(event);
  }
  if (since) {
    where.push("ts >= ?");
    args.push(since);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  try {
    const totalRes = await env.DB.prepare(`SELECT COUNT(*) AS c FROM parking_events ${whereSql}`)
      .bind(...args)
      .first<{ c: number }>();
    const rowsRes = await env.DB.prepare(
      `SELECT id, ts, event, floor, company, plate, europark_session_id, europark_status,
              start_time, end_time, user_email, user_name, user_id, tenant_id, tenant_name,
              ip, country, user_agent, referer, error_code, error_message, duration_ms
       FROM parking_events
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
      filters: { floor, plate, email, event, since },
      rows: rowsRes.results ?? [],
    });
  } catch (err) {
    // L\u00e4nelogi sisemine viga, aga kliendile lihtsalt geneeriline t\u00f5rge
    // (SQL/D1 vea s\u00f5num v\u00f5ib lekitada DB skeemi v\u00f5i path infi).
    console.error("admin.logs: query failed", err);
    return jsonResponse(500, {
      ok: false,
      error: "query_failed",
      message: "Query failed. Check Function logs.",
    });
  }
};

// Mistahes muu meetod -> 405
export const onRequest: PagesFunction<Env> = async ({ request }) => {
  if (request.method === "GET") {
    return jsonResponse(500, { ok: false, error: "routing" });
  }
  return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), {
    status: 405,
    headers: { "Content-Type": "application/json", Allow: "GET" },
  });
};
