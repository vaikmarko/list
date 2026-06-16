/**
 * Hausingu staatuse poller (Sharry -> Hausing relay tagasivool).
 *
 * GET|POST /api/hausing-webhook
 *   Headers: Authorization: Bearer <POLL_SECRET>
 *
 * Valib avatud (mitte-terminaalsed) fault_reports kirjed, kusib igauhe
 * hetkeseisu Hausingust (GET /v1/general-tickets/{id}) ja uuendab D1-s
 * hausing_status / resolution / updated_at.
 *
 * NB: Cloudflare Pages Functions EI TOETA cron triggereid - seda endpointi
 * kutsub valine scheduler (GitHub Actions cron / cron-job.org) POLL_SECRET'iga.
 * Vt docs/superpowers/specs/2026-06-16-sharry-hausing-fault-relay-design.md §6.
 */

import {
  getGeneralTicket,
  HAUSING_TERMINAL_STATUSES,
  type HausingEnv,
  type HausingStatus,
} from "./_hausing";

interface Env extends HausingEnv {
  DB: D1Database;
  POLL_SECRET: string;
}

// Mitu ticketit korraga - hoiab jooksu lyhikese ja vordse Workers CPU limiidiga.
const POLL_BATCH = 25;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
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

interface OpenRow {
  id: number;
  hausing_ticket_id: number;
  hausing_status: string | null;
}

async function poll(env: Env): Promise<Response> {
  if (!env.DB) return jsonResponse(500, { ok: false, error: "db_not_bound" });
  if (!env.HAUSING_API_TOKEN || !env.HAUSING_COMPANY_ID) {
    return jsonResponse(500, { ok: false, error: "server_misconfigured" });
  }

  const terminalList = [...HAUSING_TERMINAL_STATUSES].map((s) => `'${s}'`).join(", ");
  let rows: OpenRow[];
  try {
    const res = await env.DB.prepare(
      `SELECT id, hausing_ticket_id, hausing_status
       FROM fault_reports
       WHERE event = 'fault.ok'
         AND hausing_ticket_id IS NOT NULL
         AND (hausing_status IS NULL OR hausing_status NOT IN (${terminalList}))
       ORDER BY updated_at ASC
       LIMIT ?`,
    )
      .bind(POLL_BATCH)
      .all<OpenRow>();
    rows = res.results ?? [];
  } catch (err) {
    console.error("poll: select failed", err instanceof Error ? err.message : String(err));
    return jsonResponse(500, { ok: false, error: "query_failed" });
  }

  let checked = 0;
  let updated = 0;
  let errors = 0;

  for (const row of rows) {
    checked++;
    const result = await getGeneralTicket(env, row.hausing_ticket_id);
    if (!result.ok) {
      errors++;
      console.error(JSON.stringify({
        event: "poll.upstream_error",
        ticket_id: row.hausing_ticket_id,
        errorCode: result.errorCode,
      }));
      continue;
    }
    const ticket = result.data;
    const newStatus: HausingStatus | null = ticket.status;
    if (newStatus && newStatus !== row.hausing_status) {
      try {
        await env.DB.prepare(
          `UPDATE fault_reports
           SET hausing_status = ?, resolution = ?, updated_at = ?
           WHERE id = ?`,
        )
          .bind(newStatus, ticket.resolution, new Date().toISOString(), row.id)
          .run();
        updated++;
      } catch (err) {
        errors++;
        console.error("poll: update failed", err instanceof Error ? err.message : String(err));
      }
    } else {
      // Puuduta updated_at, et roteerida ORDER BY updated_at ASC kaudu.
      try {
        await env.DB.prepare("UPDATE fault_reports SET updated_at = ? WHERE id = ?")
          .bind(new Date().toISOString(), row.id)
          .run();
      } catch {
        // mitte-kriitiline
      }
    }
  }

  console.log(JSON.stringify({ event: "poll.done", checked, updated, errors }));
  return jsonResponse(200, { ok: true, checked, updated, errors });
}

function authorized(request: Request, env: Env): boolean {
  if (!env.POLL_SECRET) return false;
  const auth = request.headers.get("Authorization") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  return !!bearer && timingSafeEquals(bearer, env.POLL_SECRET);
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx;
  if (request.method !== "GET" && request.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json", Allow: "GET, POST" },
    });
  }
  if (!authorized(request, env)) {
    return jsonResponse(401, { ok: false, error: "unauthorized" });
  }
  return poll(env);
};
