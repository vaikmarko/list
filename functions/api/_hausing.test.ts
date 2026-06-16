import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createGeneralTicket,
  getGeneralTicket,
  getFileUploadUrl,
  linkFileToTicket,
  uploadTicketPhoto,
  HAUSING_TERMINAL_STATUSES,
  type HausingEnv,
} from "./_hausing";

const env: HausingEnv = {
  HAUSING_API_TOKEN: "test-token",
  HAUSING_COMPANY_ID: "42",
  HAUSING_API_BASE: "https://api.example.test",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createGeneralTicket", () => {
  it("sends Authentication bearer + X-Hausing-Company headers and parses { data }", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("Authentication")).toBe("Bearer test-token");
      expect(headers.get("X-Hausing-Company")).toBe("42");
      return jsonResponse(201, { data: { id: 7, number: "VT-7", status: "TO_DO" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await createGeneralTicket(env, { title: "Lekib kraan", description: "WC" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.id).toBe(7);
      expect(res.data.number).toBe("VT-7");
      expect(res.data.status).toBe("TO_DO");
    }
    // default = ai-categorized endpoint
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/v1/general-tickets/ai-categorized",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("uses the plain endpoint when aiCategorized is false and strips undefined fields", async () => {
    let sentBody: Record<string, unknown> = {};
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body));
      expect(url).toContain("/v1/general-tickets");
      expect(url).not.toContain("ai-categorized");
      return jsonResponse(201, { data: { id: 1, number: "VT-1", status: "BACKLOG" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    await createGeneralTicket(env, { title: "X", aiCategorized: false });
    expect(sentBody).toEqual({ title: "X" });
    expect("description" in sentBody).toBe(false);
  });

  it("returns a typed error on non-2xx without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(401, { id: "e1", message: "nope" })));
    const res = await createGeneralTicket(env, { title: "X" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(401);
      expect(res.errorCode).toBe("upstream_401");
      expect(res.raw).toContain("nope");
    }
  });

  it("returns upstream_unreachable when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down");
    }));
    const res = await createGeneralTicket(env, { title: "X" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errorCode).toBe("upstream_unreachable");
  });

  it("handles a non-JSON 2xx body as unparseable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("OK", { status: 200, headers: { "content-type": "text/plain" } }),
    ));
    const res = await createGeneralTicket(env, { title: "X" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errorCode).toBe("unparseable_response");
  });
});

describe("getGeneralTicket", () => {
  it("parses status from { data }", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse(200, { data: { id: 9, number: "VT-9", status: "DONE", resolution: "Tehtud" } }),
    ));
    const res = await getGeneralTicket(env, 9);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.status).toBe("DONE");
      expect(res.data.resolution).toBe("Tehtud");
    }
  });
});

describe("file upload", () => {
  it("getFileUploadUrl parses { data: { uploadUrl, fileName } }", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse(200, { data: { uploadUrl: "https://upload.test/abc", fileName: "abc123" } }),
    ));
    const res = await getFileUploadUrl(env);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.uploadUrl).toBe("https://upload.test/abc");
      expect(res.data.fileName).toBe("abc123");
    }
  });

  it("getFileUploadUrl returns unparseable_response when fields missing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { data: {} })));
    const res = await getFileUploadUrl(env);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errorCode).toBe("unparseable_response");
  });

  it("linkFileToTicket posts GENERAL_TICKET entity with visibilities", async () => {
    let sentBody: Record<string, unknown> = {};
    let sentUrl = "";
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      sentUrl = url;
      sentBody = JSON.parse(String(init?.body));
      return jsonResponse(201, { data: { id: "f1" } });
    }));
    const res = await linkFileToTicket(env, {
      ticketId: 7,
      fileName: "abc123",
      originalFileName: "foto.jpg",
      tenantId: "t9",
      creatorName: "Mari",
    });
    expect(res.ok).toBe(true);
    expect(sentUrl).toBe("https://api.example.test/v1/files");
    expect(sentBody.entity).toBe("GENERAL_TICKET");
    expect(sentBody.entityId).toBe("7");
    expect(sentBody.creatorContext).toEqual({ tenantId: "t9" });
    expect(Array.isArray(sentBody.visibilities)).toBe(true);
  });

  it("uploadTicketPhoto runs all three steps in order", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method || "GET"} ${url}`);
      if (url.endsWith("/v1/files/upload-url")) {
        return jsonResponse(200, { data: { uploadUrl: "https://upload.test/put-here", fileName: "abc123" } });
      }
      if (url === "https://upload.test/put-here") {
        return new Response(null, { status: 200 });
      }
      return jsonResponse(201, { data: { id: "f1" } });
    }));
    const res = await uploadTicketPhoto(env, {
      ticketId: 7,
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/jpeg",
      originalFileName: "foto.jpg",
    });
    expect(res.ok).toBe(true);
    expect(calls).toEqual([
      "GET https://api.example.test/v1/files/upload-url",
      "PUT https://upload.test/put-here",
      "POST https://api.example.test/v1/files",
    ]);
  });

  it("uploadTicketPhoto returns file_put_failed when PUT fails (no link call)", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method || "GET"} ${url}`);
      if (url.endsWith("/v1/files/upload-url")) {
        return jsonResponse(200, { data: { uploadUrl: "https://upload.test/put-here", fileName: "abc123" } });
      }
      if (url === "https://upload.test/put-here") {
        return new Response("denied", { status: 403 });
      }
      return jsonResponse(201, { data: { id: "f1" } });
    }));
    const res = await uploadTicketPhoto(env, {
      ticketId: 7,
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/jpeg",
      originalFileName: "foto.jpg",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errorCode).toBe("file_put_failed");
    expect(calls).not.toContain("POST https://api.example.test/v1/files");
  });
});

describe("HAUSING_TERMINAL_STATUSES", () => {
  it("contains the closing statuses and excludes open ones", () => {
    expect(HAUSING_TERMINAL_STATUSES.has("DONE")).toBe(true);
    expect(HAUSING_TERMINAL_STATUSES.has("REJECTED")).toBe(true);
    expect(HAUSING_TERMINAL_STATUSES.has("NOT_DONE")).toBe(true);
    expect(HAUSING_TERMINAL_STATUSES.has("IN_PROGRESS")).toBe(false);
    expect(HAUSING_TERMINAL_STATUSES.has("TO_DO")).toBe(false);
  });
});
