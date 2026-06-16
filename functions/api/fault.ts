/**
 * Sharry -> Hausing veateadete relay.
 *
 * POST /api/fault
 *   Body: {
 *     description: string,            // kohustuslik
 *     category?: string,             // valikuline (AI-kategoriseerimine vaikimisi)
 *     client_request_id: string,     // UUID, idempotentsuse votme
 *     buildingId?: string,           // valikuline override (pilot/test)
 *     context?: Record<string,string>, // Sharry user-context (email/nimi/tenant/site)
 *     photo?: { data: base64, contentType: "image/jpeg"|..., name?: string } // valikuline foto
 *   }
 *
 * Foto: klient skaleerib pildi alla ja saadab base64. Ticket luuakse esmalt,
 * seejarel laetakse foto best-effort'ina (uploadTicketPhoto) - foto viga ei kukuta veateadet.
 *
 * Loob Hausingus general ticketi, salvestab mapping + audit D1-i (fault_reports).
 * Vastus ei sisalda kunagi tooret Hausing vastust.
 *
 * Muster: functions/api/park.ts (D1 audit, rate-limit, sanitiseerimine, fail-open).
 * Vt ka: docs/integrations/HAUSING_API.md, docs/integrations/SHARRY_INTEGRATION.md
 */

import {
  createGeneralTicket,
  uploadTicketPhoto,
  type HausingEnv,
  type GeneralTicket,
} from "./_hausing";

interface Env extends HausingEnv {
  DB: D1Database;
}

type FaultEvent =
  | "fault.ok"
  | "fault.duplicate"
  | "fault.upstream_error"
  | "fault.validation_error"
  | "fault.misconfig";

interface AuditEvent {
  event: FaultEvent;
  client_request_id: string | null;
  hausing_ticket_id: number | null;
  hausing_ticket_number: string | null;
  hausing_status: string | null;
  category: string | null;
  title: string | null;
  description: string | null;
  building_id: string | null;
  room_id: string | null;
  attachment_count: number | null;
  cf: { ip: string; country: string; ua: string; referer: string };
  user: Record<string, string>;
  error_code: string | null;
  error_message: string | null;
  duration_ms: number;
}

const DESCRIPTION_MAX = 2000;
const MAX_CONTEXT_KEYS = 20;
const MAX_CONTEXT_VALUE_LEN = 200;
// Foto: klient skaleerib pildi alla (~JPEG), aga hoiame serveris turvalimiidi.
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

interface DecodedPhoto {
  bytes: Uint8Array;
  contentType: string;
  name: string;
}

// Dekodeeri base64 -> baidid (Workers atob). Tagastab null vigase/liiga suure korral.
function decodePhoto(input: unknown): DecodedPhoto | null {
  if (!input || typeof input !== "object") return null;
  const p = input as Record<string, unknown>;
  const data = typeof p.data === "string" ? p.data : null;
  const contentType = typeof p.contentType === "string" ? p.contentType.toLowerCase() : "";
  if (!data || !ALLOWED_PHOTO_TYPES.has(contentType)) return null;
  // base64 pikkus -> ligikaudne baidiarv; lukka tagasi enne dekodeerimist kui liiga suur.
  if (data.length > Math.ceil((MAX_PHOTO_BYTES * 4) / 3) + 4) return null;
  let bin: string;
  try {
    bin = atob(data);
  } catch {
    return null;
  }
  if (bin.length === 0 || bin.length > MAX_PHOTO_BYTES) return null;
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const rawName = typeof p.name === "string" ? p.name.slice(0, 120) : "foto.jpg";
  const name = rawName.replace(/[^\w.\-]/g, "_") || "foto.jpg";
  return { bytes, contentType, name };
}

// Rate limit 1: per IP - max 20 paringut 5 min jooksul (koik eventid).
const RL_IP_MAX = 20;
const RL_IP_WINDOW_MIN = 5;
// Rate limit 2: per email - max 10 edukat veateadet tunnis (ainult fault.ok).
const RL_EMAIL_MAX = 10;
const RL_EMAIL_WINDOW_MIN = 60;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function lowerKeys(ctx: Record<string, string>): Record<string, string> {
  const lower: Record<string, string> = {};
  for (const k of Object.keys(ctx)) lower[k.toLowerCase()] = ctx[k];
  return lower;
}

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

function extractUserEmail(ctx: Record<string, string>): string | null {
  const lower = lowerKeys(ctx);
  return (
    lower["user e-mail"] ||
    lower["user_email"] ||
    lower["email"] ||
    lower["e"] ||
    lower["user-email"] ||
    null
  );
}

function pick(ctx: Record<string, string>, keys: string[]): string | null {
  const lower = lowerKeys(ctx);
  for (const k of keys) if (lower[k]) return lower[k];
  return null;
}

async function writeAuditLog(db: D1Database | undefined, ev: AuditEvent): Promise<void> {
  if (!db) {
    console.warn("audit: no DB binding, skipping persistent log");
    return;
  }
  const user = ev.user;
  const userName = pick(user, ["user name", "user_name", "name", "n"]);
  const userId = pick(user, ["user id", "user_id", "userid", "u"]);
  const tenantId = pick(user, ["tenant id", "tenant_id", "tenantid", "t"]);
  const tenantName = pick(user, ["tenant name", "tenant_name", "tn"]);
  try {
    await db
      .prepare(
        `INSERT INTO fault_reports (
          ts, client_request_id, event,
          hausing_ticket_id, hausing_ticket_number, hausing_status, resolution,
          category, title, description, building_id, room_id,
          watcher_email, user_name, user_id, tenant_id, tenant_name,
          ip, country, user_agent, referer, raw_context,
          error_code, error_message, duration_ms, updated_at, attachment_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        new Date().toISOString(),
        ev.client_request_id,
        ev.event,
        ev.hausing_ticket_id,
        ev.hausing_ticket_number,
        ev.hausing_status,
        null,
        ev.category,
        ev.title,
        ev.description,
        ev.building_id,
        ev.room_id,
        extractUserEmail(user),
        userName,
        userId,
        tenantId,
        tenantName,
        ev.cf.ip,
        ev.cf.country,
        ev.cf.ua,
        ev.cf.referer,
        Object.keys(user).length ? JSON.stringify(user) : null,
        ev.error_code,
        ev.error_message,
        ev.duration_ms,
        new Date().toISOString(),
        ev.attachment_count,
      )
      .run();
  } catch (err) {
    // Audit ei tohi kunagi katkestada kasutaja vastust.
    console.error("audit: D1 INSERT failed", err instanceof Error ? err.message : String(err));
  }
}

async function checkIpRateLimit(db: D1Database | undefined, ip: string): Promise<{ allowed: boolean; count: number }> {
  if (!ip || !db) return { allowed: true, count: 0 };
  const sinceIso = new Date(Date.now() - RL_IP_WINDOW_MIN * 60 * 1000).toISOString();
  try {
    const res = await db
      .prepare("SELECT COUNT(*) AS c FROM fault_reports WHERE ip = ? AND ts >= ?")
      .bind(ip, sinceIso)
      .first<{ c: number }>();
    const count = res?.c ?? 0;
    return { allowed: count < RL_IP_MAX, count };
  } catch (err) {
    console.error("rate_limit.ip: query failed", err instanceof Error ? err.message : String(err));
    return { allowed: true, count: 0 };
  }
}

async function checkEmailRateLimit(db: D1Database | undefined, email: string | null): Promise<{ allowed: boolean; count: number }> {
  if (!email || !db) return { allowed: true, count: 0 };
  const sinceIso = new Date(Date.now() - RL_EMAIL_WINDOW_MIN * 60 * 1000).toISOString();
  try {
    const res = await db
      .prepare("SELECT COUNT(*) AS c FROM fault_reports WHERE event = 'fault.ok' AND watcher_email = ? AND ts >= ?")
      .bind(email, sinceIso)
      .first<{ c: number }>();
    const count = res?.c ?? 0;
    return { allowed: count < RL_EMAIL_MAX, count };
  } catch (err) {
    console.error("rate_limit.email: query failed", err instanceof Error ? err.message : String(err));
    return { allowed: true, count: 0 };
  }
}

interface ExistingFault {
  hausing_ticket_id: number | null;
  hausing_ticket_number: string | null;
  hausing_status: string | null;
}

async function findByClientRequestId(db: D1Database | undefined, id: string): Promise<ExistingFault | null> {
  if (!db || !id) return null;
  try {
    return await db
      .prepare(
        "SELECT hausing_ticket_id, hausing_ticket_number, hausing_status FROM fault_reports WHERE client_request_id = ? AND event = 'fault.ok' LIMIT 1",
      )
      .bind(id)
      .first<ExistingFault>();
  } catch (err) {
    console.error("dedup: query failed", err instanceof Error ? err.message : String(err));
    return null;
  }
}

interface LocationMap {
  hausing_building_id: string | null;
  hausing_room_id: string | null;
}

async function resolveLocation(db: D1Database | undefined, siteId: string | null): Promise<LocationMap | null> {
  if (!db || !siteId) return null;
  try {
    return await db
      .prepare("SELECT hausing_building_id, hausing_room_id FROM hausing_location_map WHERE sharry_site_id = ? LIMIT 1")
      .bind(siteId)
      .first<LocationMap>();
  } catch (err) {
    console.error("location_map: query failed", err instanceof Error ? err.message : String(err));
    return null;
  }
}

interface FaultRequest {
  description?: string;
  category?: string;
  client_request_id?: string;
  buildingId?: string;
  context?: Record<string, string>;
  photo?: { data?: string; contentType?: string; name?: string };
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx;
  const requestStart = Date.now();

  const cfMeta = {
    ip: request.headers.get("CF-Connecting-IP") || "",
    country: request.headers.get("CF-IPCountry") || "",
    ua: (request.headers.get("User-Agent") || "").slice(0, 200),
    referer: (request.headers.get("Referer") || "").slice(0, 200),
  };

  let body: FaultRequest;
  try {
    body = (await request.json()) as FaultRequest;
  } catch {
    return jsonResponse(400, { ok: false, error: "invalid_json", message: "Vigane päring." });
  }

  const description = (body.description ?? "").toString().trim().slice(0, DESCRIPTION_MAX);
  const category = body.category ? String(body.category).slice(0, 120) : null;
  const clientRequestId = body.client_request_id ? String(body.client_request_id).slice(0, 64) : null;
  const buildingOverride = body.buildingId ? String(body.buildingId).slice(0, 64) : null;
  const userContext = sanitizeContext(body.context);
  const userEmail = extractUserEmail(userContext);
  const photo = decodePhoto(body.photo);

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

  const baseAudit = {
    client_request_id: clientRequestId,
    hausing_ticket_id: null,
    hausing_ticket_number: null,
    hausing_status: null,
    category,
    title: null as string | null,
    description: description || null,
    building_id: buildingOverride,
    room_id: null as string | null,
    attachment_count: null as number | null,
  };

  // Rate limit 1: per IP.
  const rlIp = await checkIpRateLimit(env.DB, cfMeta.ip);
  if (!rlIp.allowed) {
    logAudit({
      ...baseAudit,
      event: "fault.validation_error",
      error_code: "rate_limited_ip",
      error_message: `${rlIp.count} requests in last ${RL_IP_WINDOW_MIN} min from this IP (max ${RL_IP_MAX})`,
    });
    return jsonResponse(429, {
      ok: false,
      error: "rate_limited_ip",
      message: "Liiga palju päringuid. Palun oota mõni minut ja proovi uuesti.",
    });
  }

  // Rate limit 2: per email (ainult kui Sharry email olemas).
  const rlEmail = await checkEmailRateLimit(env.DB, userEmail);
  if (!rlEmail.allowed) {
    logAudit({
      ...baseAudit,
      event: "fault.validation_error",
      error_code: "rate_limited_email",
      error_message: `${rlEmail.count} reports in last ${RL_EMAIL_WINDOW_MIN} min from ${userEmail} (max ${RL_EMAIL_MAX})`,
    });
    return jsonResponse(429, {
      ok: false,
      error: "rate_limited_email",
      message: `Liiga palju veateateid (max ${RL_EMAIL_MAX} tunnis). Palun proovi hiljem uuesti.`,
    });
  }

  // Validatsioon.
  if (description.length < 3) {
    logAudit({
      ...baseAudit,
      event: "fault.validation_error",
      error_code: "invalid_description",
      error_message: "Description too short.",
    });
    return jsonResponse(400, {
      ok: false,
      error: "invalid_description",
      message: "Palun kirjelda viga (vähemalt 3 tähemärki).",
    });
  }

  // Config kontroll.
  if (!env.HAUSING_API_TOKEN || !env.HAUSING_COMPANY_ID) {
    console.error("fault: missing Hausing config", {
      hasToken: !!env.HAUSING_API_TOKEN,
      hasCompany: !!env.HAUSING_COMPANY_ID,
    });
    logAudit({
      ...baseAudit,
      event: "fault.misconfig",
      error_code: "server_misconfigured",
      error_message: "Hausing credentials missing.",
    });
    return jsonResponse(500, {
      ok: false,
      error: "server_misconfigured",
      message: "Serveri seadistuse viga. Palun teata haldurile.",
    });
  }

  // Idempotentsus: kui sama client_request_id juba edukalt loodud, tagasta olemasolev.
  if (clientRequestId) {
    const existing = await findByClientRequestId(env.DB, clientRequestId);
    if (existing && existing.hausing_ticket_id != null) {
      logAudit({
        ...baseAudit,
        event: "fault.duplicate",
        hausing_ticket_id: existing.hausing_ticket_id,
        hausing_ticket_number: existing.hausing_ticket_number,
        hausing_status: existing.hausing_status,
        error_code: null,
        error_message: null,
      });
      return jsonResponse(200, {
        ok: true,
        ticketNumber: existing.hausing_ticket_number,
        status: existing.hausing_status,
        duplicate: true,
      });
    }
  }

  // Asukoha mapping: Sharry site id -> Hausing building/room. buildingId override voidab.
  const siteId = pick(userContext, ["s", "site id", "site_id", "siteid", "primary site", "base location id", "b"]);
  const mapped = await resolveLocation(env.DB, siteId);
  const buildingId = buildingOverride || mapped?.hausing_building_id || undefined;
  const roomId = mapped?.hausing_room_id || undefined;

  const title = `Veateade: ${description.slice(0, 60)}${description.length > 60 ? "…" : ""}`;

  // Elaniku valitud kategooria-silt ei ole Hausingu categoryId - et see infona
  // ticketile jouaks (AI-kategoriseerimine voib erineda), lisame selle kirjeldusse.
  const numericCategoryId = category && /^\d+$/.test(category) ? Number(category) : undefined;
  const hausingDescription =
    category && numericCategoryId === undefined ? `[${category}] ${description}` : description;

  // Kutsu Hausing API.
  const result = await createGeneralTicket(env, {
    title,
    description: hausingDescription,
    censoredDescription: hausingDescription,
    watcherEmail: userEmail ?? undefined,
    buildingId,
    roomId,
    categoryId: numericCategoryId,
    aiCategorized: true,
  });

  if (!result.ok) {
    console.error(JSON.stringify({
      event: "fault.upstream_error",
      status: result.status,
      errorCode: result.errorCode,
      raw: result.raw,
      cf: cfMeta,
      user: userContext,
      duration_ms: Date.now() - requestStart,
    }));
    logAudit({
      ...baseAudit,
      title,
      building_id: buildingId ?? null,
      room_id: roomId ?? null,
      event: "fault.upstream_error",
      error_code: result.errorCode,
      error_message: result.raw ? result.raw.slice(0, 500) : null,
    });
    let message = "Veateate saatmine ebaõnnestus. Palun proovi hetke pärast uuesti.";
    if (result.status === 401 || result.status === 403) {
      message = "Serveri autoriseerimise viga. Palun teata haldurile.";
    }
    // Kliendile ei tagasta kunagi tooret Hausing vastust.
    return jsonResponse(result.status >= 500 || result.status === 0 ? 502 : 400, {
      ok: false,
      error: result.errorCode,
      message,
    });
  }

  const ticket: GeneralTicket = result.data;

  // Foto (valikuline) - best-effort. Ticket on juba loodud, seega pildi
  // uleslaadimise ebaonnestumine EI kukuta veateadet (logime ja laheme edasi).
  let attachmentCount = 0;
  if (photo) {
    const up = await uploadTicketPhoto(env, {
      ticketId: ticket.id,
      bytes: photo.bytes,
      contentType: photo.contentType,
      originalFileName: photo.name,
      tenantId: pick(userContext, ["tenant id", "tenant_id", "tenantid", "t"]) ?? undefined,
      creatorName: pick(userContext, ["user name", "user_name", "name", "n"]) ?? undefined,
    });
    if (up.ok) {
      attachmentCount = 1;
    } else {
      console.error(JSON.stringify({
        event: "fault.photo_error",
        ticket_id: ticket.id,
        errorCode: up.errorCode,
        raw: up.raw ? up.raw.slice(0, 300) : null,
      }));
    }
  }

  // Salvesta mapping + audit. INSERT voib race'i korral UNIQUE'i vastu kukkuda ->
  // sel juhul tagasta olemasolev (writeAuditLog neelab vea, seega kontrolli eraldi).
  ctx.waitUntil(
    (async () => {
      try {
        await env.DB.prepare(
          `INSERT INTO fault_reports (
            ts, client_request_id, event,
            hausing_ticket_id, hausing_ticket_number, hausing_status, resolution,
            category, title, description, building_id, room_id,
            watcher_email, user_name, user_id, tenant_id, tenant_name,
            ip, country, user_agent, referer, raw_context,
            error_code, error_message, duration_ms, updated_at, attachment_count
          ) VALUES (?, ?, 'fault.ok', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(
            new Date().toISOString(),
            clientRequestId,
            ticket.id,
            ticket.number,
            ticket.status,
            ticket.resolution,
            category,
            title,
            description,
            buildingId ?? null,
            roomId ?? null,
            userEmail,
            pick(userContext, ["user name", "user_name", "name", "n"]),
            pick(userContext, ["user id", "user_id", "userid", "u"]),
            pick(userContext, ["tenant id", "tenant_id", "tenantid", "t"]),
            pick(userContext, ["tenant name", "tenant_name", "tn"]),
            cfMeta.ip,
            cfMeta.country,
            cfMeta.ua,
            cfMeta.referer,
            Object.keys(userContext).length ? JSON.stringify(userContext) : null,
            null,
            null,
            Date.now() - requestStart,
            new Date().toISOString(),
            attachmentCount,
          )
          .run();
      } catch (err) {
        // Tonaoliselt UNIQUE(client_request_id) race - ticket on juba loodud.
        console.error("fault: mapping INSERT failed (likely dup race)", err instanceof Error ? err.message : String(err));
      }
    })(),
  );

  console.log(JSON.stringify({
    event: "fault.ok",
    ticket_id: ticket.id,
    ticket_number: ticket.number,
    status: ticket.status,
    attachment_count: attachmentCount,
    cf: cfMeta,
    user: userContext,
    duration_ms: Date.now() - requestStart,
  }));

  return jsonResponse(200, {
    ok: true,
    ticketNumber: ticket.number,
    status: ticket.status ?? "TO_DO",
    photoAttached: attachmentCount > 0,
    // Kui kasutaja saatis pildi, aga see ei laetud (best-effort), anna kliendile teada.
    photoFailed: !!photo && attachmentCount === 0,
  });
};

export const onRequest: PagesFunction<Env> = async ({ request }) => {
  if (request.method === "POST") {
    return jsonResponse(500, { ok: false, error: "routing", message: "Routing error" });
  }
  return new Response(JSON.stringify({ ok: false, error: "method_not_allowed", message: "Use POST." }), {
    status: 405,
    headers: { "Content-Type": "application/json; charset=utf-8", Allow: "POST" },
  });
};
