/**
 * Hausing Gateway API klient (Sharry -> Hausing veateadete relay).
 *
 * Referents: docs/integrations/HAUSING_API.md
 *
 * NB:
 *  - Auth header on `Authentication: Bearer <token>` (MITTE Authorization).
 *  - Iga paring vajab ka `X-Hausing-Company` headerit.
 *  - Vastused on kujul { data: ... }.
 *  - Vastuseid parsime defensiivselt (json voi text, try/catch), kuna live
 *    kaitumine pole veel API-votmetega kinnitatud.
 */

export interface HausingEnv {
  HAUSING_API_TOKEN: string;
  HAUSING_COMPANY_ID: string;
  HAUSING_API_BASE?: string;
}

export type HausingStatus =
  | "BACKLOG"
  | "TO_DO"
  | "WAITING"
  | "IN_PROGRESS"
  | "REVIEW"
  | "DONE"
  | "NOT_DONE"
  | "REJECTED";

export const HAUSING_TERMINAL_STATUSES: ReadonlySet<HausingStatus> = new Set<HausingStatus>([
  "DONE",
  "NOT_DONE",
  "REJECTED",
]);

export interface GeneralTicket {
  id: number;
  number: string | null;
  status: HausingStatus | null;
  title: string | null;
  description: string | null;
  resolution: string | null;
  watcherEmail: string | null;
  createdDate: string | null;
  doneDate: string | null;
}

export interface CreateTicketInput {
  title: string;
  description?: string;
  watcherEmail?: string;
  buildingId?: string;
  roomId?: string;
  tenantId?: string;
  categoryId?: number;
  /** Kui seatud, kasutab AI-kategoriseerimise endpointi. */
  censoredDescription?: string;
  /** Kasuta /ai-categorized endpointi (categoryId valikuline). Default: true. */
  aiCategorized?: boolean;
}

export type HausingResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      /** HTTP staatus, voi 0 kui vork ebaonnestus. */
      status: number;
      errorCode: string;
      /** Toore vastus logimiseks (mitte kunagi kliendile). */
      raw: string | null;
    };

const DEFAULT_BASE = "https://gateway-api.prod.hausing.ee";

function baseUrl(env: HausingEnv): string {
  return (env.HAUSING_API_BASE || DEFAULT_BASE).replace(/\/$/, "");
}

function authHeaders(env: HausingEnv): Record<string, string> {
  return {
    Authentication: `Bearer ${env.HAUSING_API_TOKEN}`,
    "X-Hausing-Company": env.HAUSING_COMPANY_ID,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

/** Loe vastuse keha defensiivselt: proovi JSON, kuku tagasi text peale. */
async function readBody(res: Response): Promise<{ json: unknown; text: string | null }> {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try {
      const json = await res.json();
      return { json, text: null };
    } catch {
      return { json: null, text: null };
    }
  }
  const text = await res.text().catch(() => null);
  return { json: null, text };
}

function mapTicket(raw: unknown): GeneralTicket | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  const idNum = typeof t.id === "number" ? t.id : Number(t.id);
  if (!Number.isFinite(idNum)) return null;
  return {
    id: idNum,
    number: t.number != null ? String(t.number) : null,
    status: (typeof t.status === "string" ? (t.status as HausingStatus) : null),
    title: t.title != null ? String(t.title) : null,
    description: t.description != null ? String(t.description) : null,
    resolution: t.resolution != null ? String(t.resolution) : null,
    watcherEmail: t.watcherEmail != null ? String(t.watcherEmail) : null,
    createdDate: t.createdDate != null ? String(t.createdDate) : null,
    doneDate: t.doneDate != null ? String(t.doneDate) : null,
  };
}

function unwrapData(json: unknown): unknown {
  if (json && typeof json === "object" && "data" in (json as Record<string, unknown>)) {
    return (json as Record<string, unknown>).data;
  }
  return json;
}

/** Loo veateade (general ticket). */
export async function createGeneralTicket(
  env: HausingEnv,
  input: CreateTicketInput,
): Promise<HausingResult<GeneralTicket>> {
  const useAi = input.aiCategorized !== false;
  const path = useAi ? "/v1/general-tickets/ai-categorized" : "/v1/general-tickets";
  const body: Record<string, unknown> = {
    title: input.title,
    description: input.description,
    watcherEmail: input.watcherEmail,
    buildingId: input.buildingId,
    roomId: input.roomId,
    tenantId: input.tenantId,
    categoryId: input.categoryId,
  };
  if (useAi && input.censoredDescription) body.censoredDescription = input.censoredDescription;
  // Eemalda undefined valjad (Hausing ei pruugi neid sallida).
  for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];

  let res: Response;
  try {
    res = await fetch(`${baseUrl(env)}${path}`, {
      method: "POST",
      headers: authHeaders(env),
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      errorCode: "upstream_unreachable",
      raw: err instanceof Error ? err.message : String(err),
    };
  }

  const { json, text } = await readBody(res);
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      errorCode: `upstream_${res.status}`,
      raw: json != null ? JSON.stringify(json).slice(0, 1000) : (text ?? null),
    };
  }
  const ticket = mapTicket(unwrapData(json));
  if (!ticket) {
    return { ok: false, status: res.status, errorCode: "unparseable_response", raw: text };
  }
  return { ok: true, data: ticket };
}

// ─────────────────────────────────────────────────────────────────────────────
// Failide (fotode) uleslaadimine - kaheastmeline (upload-url -> PUT -> link).
// Vt docs/integrations/HAUSING_API.md "Attachments".
// ─────────────────────────────────────────────────────────────────────────────

export interface FileUploadTarget {
  /** Presigned URL, kuhu failibaidid PUT-itakse. */
  uploadUrl: string;
  /** Serveri-poolne failinimi, mis seotakse ticketiga. */
  fileName: string;
}

/** Samm 1: kysi presigned upload URL. */
export async function getFileUploadUrl(env: HausingEnv): Promise<HausingResult<FileUploadTarget>> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl(env)}/v1/files/upload-url`, {
      method: "GET",
      headers: authHeaders(env),
    });
  } catch (err) {
    return { ok: false, status: 0, errorCode: "upstream_unreachable", raw: err instanceof Error ? err.message : String(err) };
  }
  const { json, text } = await readBody(res);
  if (!res.ok) {
    return { ok: false, status: res.status, errorCode: `upstream_${res.status}`, raw: text };
  }
  const data = unwrapData(json) as Record<string, unknown> | null;
  const uploadUrl = data && typeof data.uploadUrl === "string" ? data.uploadUrl : null;
  const fileName = data && typeof data.fileName === "string" ? data.fileName : null;
  if (!uploadUrl || !fileName) {
    return { ok: false, status: res.status, errorCode: "unparseable_response", raw: text };
  }
  return { ok: true, data: { uploadUrl, fileName } };
}

/** Samm 2: PUT failibaidid presigned URL-ile (auth puudub - URL on juba allkirjastatud). */
export async function putFileBytes(
  uploadUrl: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<{ ok: boolean; status: number; raw: string | null }> {
  try {
    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: bytes,
    });
    if (!res.ok) {
      const raw = await res.text().catch(() => null);
      return { ok: false, status: res.status, raw };
    }
    return { ok: true, status: res.status, raw: null };
  } catch (err) {
    return { ok: false, status: 0, raw: err instanceof Error ? err.message : String(err) };
  }
}

export interface LinkFileInput {
  ticketId: number | string;
  /** Serveri-poolne nimi getFileUploadUrl vastusest. */
  fileName: string;
  /** Kasutaja algne failinimi (kuvamiseks). */
  originalFileName: string;
  tenantId?: string;
  creatorName?: string;
}

// Nahtavus: ka ROOM_OWNER (elanik) naeb faili.
const FILE_VISIBILITIES = ["ADMIN_MANAGER", "MANAGER", "TECHNICIAN", "ROOM_OWNER", "EXTERNAL"];

/** Samm 3: seo uleslaetud fail general ticketiga. */
export async function linkFileToTicket(
  env: HausingEnv,
  input: LinkFileInput,
): Promise<HausingResult<unknown>> {
  const body: Record<string, unknown> = {
    entity: "GENERAL_TICKET",
    entityId: String(input.ticketId),
    fileName: input.fileName,
    originalFileName: input.originalFileName,
    visibilities: FILE_VISIBILITIES,
  };
  if (input.tenantId) body.creatorContext = { tenantId: input.tenantId };
  if (input.creatorName) body.creatorName = input.creatorName;

  let res: Response;
  try {
    res = await fetch(`${baseUrl(env)}/v1/files`, {
      method: "POST",
      headers: authHeaders(env),
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, status: 0, errorCode: "upstream_unreachable", raw: err instanceof Error ? err.message : String(err) };
  }
  const { json, text } = await readBody(res);
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      errorCode: `upstream_${res.status}`,
      raw: json != null ? JSON.stringify(json).slice(0, 1000) : text,
    };
  }
  return { ok: true, data: unwrapData(json) };
}

export interface UploadPhotoInput {
  ticketId: number | string;
  bytes: Uint8Array;
  contentType: string;
  originalFileName: string;
  tenantId?: string;
  creatorName?: string;
}

/**
 * Kogu pildi uleslaadimine + sidumine ticketiga (3 sammu).
 * Best-effort: kutsuja otsustab, et viga siin ei kukuta kogu veateadet.
 */
export async function uploadTicketPhoto(
  env: HausingEnv,
  input: UploadPhotoInput,
): Promise<HausingResult<{ fileName: string }>> {
  const target = await getFileUploadUrl(env);
  if (!target.ok) return target;

  const put = await putFileBytes(target.data.uploadUrl, input.bytes, input.contentType);
  if (!put.ok) {
    return { ok: false, status: put.status, errorCode: "file_put_failed", raw: put.raw };
  }

  const link = await linkFileToTicket(env, {
    ticketId: input.ticketId,
    fileName: target.data.fileName,
    originalFileName: input.originalFileName,
    tenantId: input.tenantId,
    creatorName: input.creatorName,
  });
  if (!link.ok) {
    return { ok: false, status: link.status, errorCode: link.errorCode, raw: link.raw };
  }
  return { ok: true, data: { fileName: target.data.fileName } };
}

/** Loe uhe veateate hetkeseis (poller). */
export async function getGeneralTicket(
  env: HausingEnv,
  id: number | string,
): Promise<HausingResult<GeneralTicket>> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl(env)}/v1/general-tickets/${encodeURIComponent(String(id))}`, {
      method: "GET",
      headers: authHeaders(env),
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      errorCode: "upstream_unreachable",
      raw: err instanceof Error ? err.message : String(err),
    };
  }

  const { json, text } = await readBody(res);
  if (!res.ok) {
    return { ok: false, status: res.status, errorCode: `upstream_${res.status}`, raw: text };
  }
  const ticket = mapTicket(unwrapData(json));
  if (!ticket) {
    return { ok: false, status: res.status, errorCode: "unparseable_response", raw: text };
  }
  return { ok: true, data: ticket };
}
