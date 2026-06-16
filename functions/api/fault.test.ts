import { describe, it, expect } from "vitest";
import { decodePhoto } from "./fault";

describe("decodePhoto", () => {
  it("decodes a valid small base64 image", () => {
    const res = decodePhoto({ data: btoa("hi"), contentType: "image/jpeg", name: "x.jpg" });
    expect(res).not.toBeNull();
    expect(res!.bytes.length).toBe(2);
    expect(res!.contentType).toBe("image/jpeg");
    expect(res!.name).toBe("x.jpg");
  });

  it("normalizes the content type case and sanitizes the file name", () => {
    const res = decodePhoto({ data: btoa("hi"), contentType: "IMAGE/PNG", name: "../../evil name.png" });
    expect(res).not.toBeNull();
    expect(res!.contentType).toBe("image/png");
    expect(res!.name).not.toContain("/");
    expect(res!.name).not.toContain(" ");
  });

  it("rejects a disallowed content type", () => {
    expect(decodePhoto({ data: btoa("hi"), contentType: "application/pdf" })).toBeNull();
  });

  it("rejects malformed base64 (atob throws)", () => {
    expect(decodePhoto({ data: "@@@@not-base64@@@@", contentType: "image/jpeg" })).toBeNull();
  });

  it("rejects an oversized payload BEFORE decoding", () => {
    const tooBig = "A".repeat(11 * 1024 * 1024); // > ceil(8MB * 4/3)
    expect(decodePhoto({ data: tooBig, contentType: "image/jpeg" })).toBeNull();
  });

  it("rejects empty data and non-object input", () => {
    expect(decodePhoto({ data: "", contentType: "image/jpeg" })).toBeNull();
    expect(decodePhoto(null)).toBeNull();
    expect(decodePhoto("nope")).toBeNull();
    expect(decodePhoto({ contentType: "image/jpeg" })).toBeNull();
  });
});
