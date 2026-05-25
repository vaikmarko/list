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
}

type Floor = "5" | "6";

interface ParkRequest {
  floor?: Floor;
  plate?: string;
}

const PLATE_REGEX = /^[A-Z0-9]{2,10}$/;

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
      comment: env.EUROPARK_COMMENT_PREFIX_5 || "USRE kulaline",
    };
  }
  return {
    productId: env.EUROPARK_PRODUCT_ID_6,
    apiKey: env.EUROPARK_API_KEY_6,
    comment: env.EUROPARK_COMMENT_PREFIX_6 || "6. korrus kulaline",
  };
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  // 1) Parsi ja valideeri body
  let body: ParkRequest;
  try {
    body = (await request.json()) as ParkRequest;
  } catch {
    return jsonResponse(400, { ok: false, error: "invalid_json", message: "Vigane päring." });
  }

  const floor = body.floor;
  const plateRaw = (body.plate ?? "").toString().trim().toUpperCase();

  if (floor !== "5" && floor !== "6") {
    return jsonResponse(400, { ok: false, error: "invalid_floor", message: "Vigane korruse parameeter." });
  }
  if (!PLATE_REGEX.test(plateRaw)) {
    return jsonResponse(400, {
      ok: false,
      error: "invalid_plate",
      message: "Autonumber peab olema 2-10 t2hem2rki (A-Z, 0-9).",
    });
  }

  // 2) Vali credentialsid + arvuta ajad
  const { productId, apiKey, comment } = selectCredentials(floor, env);

  if (!apiKey || !productId || !env.EUROPARK_PARTNER_ID || !env.EUROPARK_API_BASE) {
    console.error("park: missing config", {
      hasKey: !!apiKey,
      productId,
      partnerId: env.EUROPARK_PARTNER_ID,
      base: env.EUROPARK_API_BASE,
    });
    return jsonResponse(500, { ok: false, error: "server_misconfigured", message: "Serveri konfiguratsiooni viga." });
  }

  const hours = Math.max(1, Math.min(24, parseInt(env.PARKING_HOURS || "3", 10) || 3));
  // Europark n6uab start_time olema rangelt "after now" - lisame 60 sek puhvri,
  // et v2ltida server clock drift'i vigu ("The start time must be a date after now.")
  const startDate = new Date(Date.now() + 60 * 1000);
  const endDate = new Date(startDate.getTime() + hours * 60 * 60 * 1000);
  const startTime = toEuroparkTime(startDate);
  const endTime = toEuroparkTime(endDate);

  // 3) Kutsu Europark API
  const url = `${env.EUROPARK_API_BASE.replace(/\/$/, "")}/partners/${env.EUROPARK_PARTNER_ID}/products/${productId}/sessions`;
  const payload = {
    vehicle_reg: plateRaw,
    start_time: startTime,
    end_time: endTime,
    comment,
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
    return jsonResponse(502, {
      ok: false,
      error: "upstream_unreachable",
      message: "Europark API ei vasta. Proovi mone hetke parast uuesti.",
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
    console.error("park: upstream non-ok", {
      status: upstream.status,
      plate: plateRaw,
      floor,
      body: upstreamBody,
    });
    let message = "Parkimine eba6nnestus.";
    if (upstream.status === 401 || upstream.status === 403) {
      message = "Serveri autoriseerimise viga. Palun teavita administraatorit.";
    } else if (upstream.status === 422) {
      message = "Auto number ei sobi Europarki s2steemiga. Kontrolli ja proovi uuesti.";
    } else if (upstream.status === 404) {
      message = "Parkimisteenust ei leitud. Palun teavita administraatorit.";
    }
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
  console.log("park: ok", { id: session.id, plate: plateRaw, floor });

  return jsonResponse(200, {
    ok: true,
    session_id: session.id ?? null,
    plate: session.vehicle_reg ?? plateRaw,
    start_time: session.start_time ?? startTime,
    end_time: session.end_time ?? endTime,
    status: session.status ?? "active",
  });
};

// K6ik teised meetodid - 405
export const onRequest: PagesFunction<Env> = async ({ request }) => {
  if (request.method === "POST") {
    // Ei tohiks siia jouda, sest onRequestPost katab POST-i.
    return jsonResponse(500, { ok: false, error: "routing", message: "Routing error" });
  }
  return new Response(JSON.stringify({ ok: false, error: "method_not_allowed", message: "Kasuta POST." }), {
    status: 405,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Allow: "POST",
    },
  });
};
