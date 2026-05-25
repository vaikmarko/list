/**
 * Rotermann kulaliste parkimise proxy.
 *
 * POST /api/park
 *   Body: { floor: "5" | "6", plate: string }
 *
 * Kutsub Europark API-t Bearer Auth v6tmega serveri pool, et v6ti ei lekiks
 * browseri JavaScripti.
 *
 * Europark API:
 *   POST {EUROPARK_API_BASE}/partners/{partner}/products/{product}/sessions
 *   Authorization: Bearer <api_key>
 */

interface Env {
  EUROPARK_API_KEY_5: string;
  EUROPARK_API_KEY_6: string;
  EUROPARK_PARTNER_ID: string;
  EUROPARK_PRODUCT_ID_5: string;
  EUROPARK_PRODUCT_ID_6: string;
  EUROPARK_API_BASE: string;
  EUROPARK_COMMENT_PREFIX_5: string;
  EUROPARK_COMMENT_PREFIX_6: string;
  PARKING_HOURS: string;
  DB: D1Database;
}

// Audit log kirje D1-i salvestamiseks (parking_events tabel).
interface AuditEvent {
  event: "park.ok" | "park.upstream_error" | "park.validation_error" | "park.misconfig";
  floor: string | null;
  company: string | null;
  plate: string | null;
  europark_session_id: number | null;
  europark_status: string | null;
  start_time: string | null;
  end_time: string | null;
  cf: { ip: string; country: string; ua: string; referer: string };
  user: Record<string, string>;
  error_code: string | null;
  error_message: string | null;
  duration_ms: number;
}

async function writeAuditLog(db: D1Database | undefined, ev: AuditEvent): Promise<void> {
  if (!db) {
    console.warn("audit: no DB binding, skipping persistent log");
    return;
  }
  const lower: Record<string, string> = {};
  for (const k of Object.keys(ev.user)) lower[k.toLowerCase()] = ev.user[k];
  const userEmail =
    lower["user e-mail"] || lower["user_email"] || lower["email"] || lower["e"] || lower["user-email"] || null;
  const userName = lower["user name"] || lower["user_name"] || lower["name"] || lower["n"] || null;
  const userId = lower["user id"] || lower["user_id"] || lower["userid"] || lower["u"] || null;
  const tenantId = lower["tenant id"] || lower["tenant_id"] || lower["tenantid"] || lower["t"] || null;
  const tenantName = lower["tenant name"] || lower["tenant_name"] || lower["tn"] || null;
  try {
    await db
      .prepare(
        `INSERT INTO parking_events (
          ts, event, floor, company, plate,
          europark_session_id, europark_status, start_time, end_time,
          user_email, user_name, user_id, tenant_id, tenant_name,
          ip, country, user_agent, referer, raw_context,
          error_code, error_message, duration_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        new Date().toISOString(),
        ev.event,
        ev.floor,
        ev.company,
        ev.plate,
        ev.europark_session_id,
        ev.europark_status,
        ev.start_time,
        ev.end_time,
        userEmail,
        userName,
        userId,
        tenantId,
        tenantName,
        ev.cf.ip,
        ev.cf.country,
        ev.cf.ua,
        ev.cf.referer,
        Object.keys(ev.user).length ? JSON.stringify(ev.user) : null,
        ev.error_code,
        ev.error_message,
        ev.duration_ms,
      )
      .run();
  } catch (err) {
    // Audit log kunagi ei tohi katkestada parkimise t66d.
    console.error("audit: D1 INSERT failed", err instanceof Error ? err.message : String(err));
  }
}

function companyForFloor(floor: string | null): string | null {
  if (floor === "5") return "U.S. Real Estate";
  if (floor === "6") return "U.S. Invest";
  return null;
}

type Floor = "5" | "6";

interface ParkRequest {
  floor?: Floor;
  plate?: string;
  // Sharry app passes user context as URL query parameters; the form
  // collects them and forwards here for audit logging.
  context?: Record<string, string>;
}

const PLATE_REGEX = /^[A-Z0-9]{2,10}$/;
const MAX_CONTEXT_KEYS = 20;
const MAX_CONTEXT_VALUE_LEN = 200;

// Sanitize context: keep only string values, cap length, limit number of keys.
function sanitizeContext(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object") return {};
  const out: Record<string, string> = {};
  let count = 0;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (count >= MAX_CONTEXT_KEYS) break;
    if (typeof key !== "string" || key.length > 60) continue;
    if (value === null || value === undefined) continue;
    const str = String(value).slice(0, MAX_CONTEXT_VALUE_LEN);
    if (!str || str === "undefined" || str === "null") continue;
    out[key] = str;
    count++;
  }
  return out;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function toEuroparkTime(date: Date): string {
  // ISO 8601 UTC, sekundi tapsusega, ilma millisekunditeta.
  // Naide: "2026-05-25T08:30:00Z"
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function selectCredentials(floor: Floor, env: Env): { productId: string; apiKey: string; comment: string } {
  if (floor === "5") {
    return {
      productId: env.EUROPARK_PRODUCT_ID_5,
      apiKey: env.EUROPARK_API_KEY_5,
      comment: env.EUROPARK_COMMENT_PREFIX_5 || "U.S. Real Estate guest",
    };
  }
  return {
    productId: env.EUROPARK_PRODUCT_ID_6,
    apiKey: env.EUROPARK_API_KEY_6,
    comment: env.EUROPARK_COMMENT_PREFIX_6 || "U.S. Invest guest",
  };
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx;
  const requestStart = Date.now();

  // Capture network-level audit info from Cloudflare headers (always present).
  const cfMeta = {
    ip: request.headers.get("CF-Connecting-IP") || "",
    country: request.headers.get("CF-IPCountry") || "",
    ua: (request.headers.get("User-Agent") || "").slice(0, 200),
    referer: (request.headers.get("Referer") || "").slice(0, 200),
  };

  // 1) Parse and validate body
  let body: ParkRequest;
  try {
    body = (await request.json()) as ParkRequest;
  } catch {
    return jsonResponse(400, { ok: false, error: "invalid_json", message: "Invalid request." });
  }

  const floor = body.floor;
  const plateRaw = (body.plate ?? "").toString().trim().toUpperCase();
  const userContext = sanitizeContext(body.context);

  // Helper - logi audit D1-i taustal, blokeerimata vastust.
  const logAudit = (ev: Omit<AuditEvent, "cf" | "user" | "duration_ms">) => {
    ctx.waitUntil(
      writeAuditLog(env.DB, {
        ...ev,
        cf: cfMeta,
        user: userContext,
        duration_ms: Date.now() - requestStart,
      }),
    );
  };

  if (floor !== "5" && floor !== "6") {
    logAudit({
      event: "park.validation_error",
      floor: floor ? String(floor) : null,
      company: null,
      plate: plateRaw || null,
      europark_session_id: null,
      europark_status: null,
      start_time: null,
      end_time: null,
      error_code: "invalid_floor",
      error_message: "Invalid floor.",
    });
    return jsonResponse(400, { ok: false, error: "invalid_floor", message: "Invalid floor." });
  }
  if (!PLATE_REGEX.test(plateRaw)) {
    logAudit({
      event: "park.validation_error",
      floor,
      company: companyForFloor(floor),
      plate: plateRaw || null,
      europark_session_id: null,
      europark_status: null,
      start_time: null,
      end_time: null,
      error_code: "invalid_plate",
      error_message: "License plate must be 2-10 characters (A-Z, 0-9).",
    });
    return jsonResponse(400, {
      ok: false,
      error: "invalid_plate",
      message: "License plate must be 2-10 characters (A-Z, 0-9).",
    });
  }

  // 2) Pick credentials + compute times
  const { productId, apiKey, comment } = selectCredentials(floor, env);

  if (!apiKey || !productId || !env.EUROPARK_PARTNER_ID || !env.EUROPARK_API_BASE) {
    console.error("park: missing config", {
      hasKey: !!apiKey,
      productId,
      partnerId: env.EUROPARK_PARTNER_ID,
      base: env.EUROPARK_API_BASE,
    });
    logAudit({
      event: "park.misconfig",
      floor,
      company: companyForFloor(floor),
      plate: plateRaw,
      europark_session_id: null,
      europark_status: null,
      start_time: null,
      end_time: null,
      error_code: "server_misconfigured",
      error_message: "Server configuration error.",
    });
    return jsonResponse(500, { ok: false, error: "server_misconfigured", message: "Server configuration error." });
  }

  const hours = Math.max(1, Math.min(24, parseInt(env.PARKING_HOURS || "3", 10) || 3));
  // Europark n6uab start_time olema rangelt "after now" - lisame 60 sek puhvri,
  // et v2ltida server clock drift'i vigu ("The start time must be a date after now.")
  const startDate = new Date(Date.now() + 60 * 1000);
  const endDate = new Date(startDate.getTime() + hours * 60 * 60 * 1000);
  const startTime = toEuroparkTime(startDate);
  const endTime = toEuroparkTime(endDate);

  // 3) Kutsu Europark API
  // Lisame kasutaja info comment'i, et Europark dashboardis oleks selge audit:
  //   "U.S. Real Estate guest (by marko@usre.ee)"
  // Eelistame email > name > id. Sharry võib saata erineva keele/case'iga.
  function pickUserLabel(c: Record<string, string>): string | null {
    const lower: Record<string, string> = {};
    for (const k of Object.keys(c)) lower[k.toLowerCase()] = c[k];
    const email =
      lower["user e-mail"] || lower["user_email"] || lower["email"] || lower["e"] || lower["user-email"];
    if (email) return email;
    const name = lower["user name"] || lower["user_name"] || lower["name"] || lower["n"];
    if (name) return name;
    const id = lower["user id"] || lower["user_id"] || lower["userid"] || lower["u"];
    if (id) return `user#${id}`;
    return null;
  }
  const userLabel = pickUserLabel(userContext);
  const fullComment = userLabel
    ? `${comment} (by ${userLabel.slice(0, 80)})`
    : comment;

  const url = `${env.EUROPARK_API_BASE.replace(/\/$/, "")}/partners/${env.EUROPARK_PARTNER_ID}/products/${productId}/sessions`;
  const payload = {
    vehicle_reg: plateRaw,
    start_time: startTime,
    end_time: endTime,
    comment: fullComment,
  };

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error("park: upstream fetch failed", err);
    logAudit({
      event: "park.upstream_error",
      floor,
      company: companyForFloor(floor),
      plate: plateRaw,
      europark_session_id: null,
      europark_status: null,
      start_time: startTime,
      end_time: endTime,
      error_code: "upstream_unreachable",
      error_message: err instanceof Error ? err.message : String(err),
    });
    return jsonResponse(502, {
      ok: false,
      error: "upstream_unreachable",
      message: "Europark service is not responding. Please try again in a moment.",
    });
  }

  // 4) Loe vastus
  let upstreamBody: unknown = null;
  const contentType = upstream.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      upstreamBody = await upstream.json();
    } catch {
      upstreamBody = null;
    }
  } else {
    upstreamBody = await upstream.text().catch(() => null);
  }

  if (!upstream.ok) {
    console.error(JSON.stringify({
      event: "park.upstream_error",
      status: upstream.status,
      floor,
      plate: plateRaw,
      cf: cfMeta,
      user: userContext,
      upstream: upstreamBody,
      duration_ms: Date.now() - requestStart,
    }));
    let message = "Parking failed.";
    if (upstream.status === 401 || upstream.status === 403) {
      message = "Server authorization error. Please notify the administrator.";
    } else if (upstream.status === 422) {
      message = "License plate not accepted. Please check and try again.";
    } else if (upstream.status === 404) {
      message = "Parking service not found. Please notify the administrator.";
    }
    logAudit({
      event: "park.upstream_error",
      floor,
      company: companyForFloor(floor),
      plate: plateRaw,
      europark_session_id: null,
      europark_status: null,
      start_time: startTime,
      end_time: endTime,
      error_code: `upstream_${upstream.status}`,
      error_message: typeof upstreamBody === "object" && upstreamBody !== null
        ? JSON.stringify(upstreamBody).slice(0, 500)
        : String(upstreamBody).slice(0, 500),
    });
    return jsonResponse(upstream.status >= 500 ? 502 : 400, {
      ok: false,
      error: `upstream_${upstream.status}`,
      message,
      upstream: upstreamBody,
    });
  }

  // 5) Edu - tagasta puhastatud andmed kliendile
  type EuroparkSession = {
    data?: {
      id?: string;
      vehicle_reg?: string;
      start_time?: string;
      end_time?: string;
      status?: string;
    };
  };
  const session = (upstreamBody as EuroparkSession)?.data ?? {};

  // AUDIT LOG: kogu info kes-millal-mida pargitud.
  // (1) console.log -> Cloudflare Real-time logs (kuvatakse ~3 paeva)
  // (2) D1 INSERT -> parking_events tabel (persistent, queryable)
  console.log(JSON.stringify({
    event: "park.ok",
    session_id: session.id ?? null,
    floor,
    plate: plateRaw,
    europark_status: session.status ?? null,
    start_time: session.start_time ?? startTime,
    end_time: session.end_time ?? endTime,
    cf: cfMeta,
    user: userContext,
    duration_ms: Date.now() - requestStart,
  }));
  const sessionIdNum = session.id != null ? Number(session.id) : null;
  logAudit({
    event: "park.ok",
    floor,
    company: companyForFloor(floor),
    plate: plateRaw,
    europark_session_id: Number.isFinite(sessionIdNum) ? sessionIdNum : null,
    europark_status: session.status ?? null,
    start_time: session.start_time ?? startTime,
    end_time: session.end_time ?? endTime,
    error_code: null,
    error_message: null,
  });

  return jsonResponse(200, {
    ok: true,
    session_id: session.id ?? null,
    plate: session.vehicle_reg ?? plateRaw,
    start_time: session.start_time ?? startTime,
    end_time: session.end_time ?? endTime,
    status: session.status ?? "active",
  });
};

// Any other method -> 405
export const onRequest: PagesFunction<Env> = async ({ request }) => {
  if (request.method === "POST") {
    // Shouldn't reach here since onRequestPost covers POST.
    return jsonResponse(500, { ok: false, error: "routing", message: "Routing error" });
  }
  return new Response(JSON.stringify({ ok: false, error: "method_not_allowed", message: "Use POST." }), {
    status: 405,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Allow: "POST",
    },
  });
};
