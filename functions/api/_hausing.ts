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
