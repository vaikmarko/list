/**
 * GET /api/fault/status?id=<client_request_id>[&email=<watcher_email>]
 *
 * Tagastab elaniku veateate hetkeseisu (D1 cache'ist, mida poller uuendab).
 * Ei kutsu Hausingut sunkroonselt - staatus varskendatakse /api/hausing-webhook poolt.
 *
 * Staatus on mapitud eestikeelseks sildiks.
 */

interface Env {
  DB: D1Database;
}

// Hausing staatus -> eestikeelne kasutajasilt.
const STATUS_ET: Record<string, string> = {
  BACKLOG: "Vastu võetud",
  TO_DO: "Vastu võetud",
  WAITING: "Ootel",
  IN_PROGRESS: "Töös",
  REVIEW: "Ülevaatamisel",
  DONE: "Lahendatud",
  NOT_DONE: "Ei lahendatud",
  REJECTED: "Tagasi lükatud",
};

const TERMINAL = new Set(["DONE", "NOT_DONE", "REJECTED"]);

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

interface Row {
  hausing_ticket_number: string | null;
  hausing_status: string | null;
  resolution: string | null;
  updated_at: string | null;
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx;
  const url = new URL(request.url);
  const id = (url.searchParams.get("id") || "").slice(0, 64);
  const email = (url.searchParams.get("email") || "").slice(0, 200).toLowerCase();

  if (!id) {
    return jsonResponse(400, { ok: false, error: "missing_id", message: "Päringus puudub veateate id." });
  }
  if (!env.DB) {
    return jsonResponse(500, { ok: false, error: "db_not_bound" });
  }

  // Scope email'iga kui antud (kerge kaitse - client_request_id on niigi elaniku enda oma).
  const where = email
    ? "client_request_id = ? AND event = 'fault.ok' AND lower(watcher_email) = ?"
    : "client_request_id = ? AND event = 'fault.ok'";
  const args = email ? [id, email] : [id];

  try {
    const row = await env.DB.prepare(
      `SELECT hausing_ticket_number, hausing_status, resolution, updated_at
       FROM fault_reports WHERE ${where} ORDER BY ts DESC LIMIT 1`,
    )
      .bind(...args)
      .first<Row>();

    if (!row) {
      return jsonResponse(404, { ok: false, error: "not_found", message: "Veateadet ei leitud." });
    }

    const status = row.hausing_status || "TO_DO";
    return jsonResponse(200, {
      ok: true,
      ticketNumber: row.hausing_ticket_number,
      status,
      statusLabel: STATUS_ET[status] || status,
      resolved: TERMINAL.has(status),
      resolution: TERMINAL.has(status) ? row.resolution : null,
      updatedAt: row.updated_at,
    });
  } catch (err) {
    console.error("fault.status: query failed", err instanceof Error ? err.message : String(err));
    return jsonResponse(500, { ok: false, error: "query_failed", message: "Päring ebaõnnestus." });
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
