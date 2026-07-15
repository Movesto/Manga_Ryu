import { describe, expect, it } from "vitest";
import { generateCsrfToken, getCsrfToken, verifyCsrf } from "./csrf.server";

function requestWithCookie(cookie?: string): Request {
  return new Request("https://example.test/", {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

describe("generateCsrfToken", () => {
  it("produces unique 64-char hex tokens", () => {
    const a = generateCsrfToken();
    const b = generateCsrfToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});

describe("getCsrfToken", () => {
  it("reads the csrf_token cookie", () => {
    expect(getCsrfToken(requestWithCookie("csrf_token=abc123"))).toBe("abc123");
  });

  it("returns null when absent", () => {
    expect(getCsrfToken(requestWithCookie())).toBeNull();
  });

  it("finds the cookie among others", () => {
    expect(getCsrfToken(requestWithCookie("a=1; csrf_token=tok; b=2"))).toBe("tok");
  });
});

describe("verifyCsrf", () => {
  it("accepts a matching token", () => {
    expect(verifyCsrf(requestWithCookie("csrf_token=tok"), "tok")).toBe(true);
  });

  it("rejects a mismatched token", () => {
    expect(verifyCsrf(requestWithCookie("csrf_token=tok"), "other")).toBe(false);
  });

  it("rejects a different-length token without throwing", () => {
    expect(verifyCsrf(requestWithCookie("csrf_token=tok"), "tok-longer")).toBe(false);
  });

  it("rejects when the cookie or submission is missing", () => {
    expect(verifyCsrf(requestWithCookie(), "tok")).toBe(false);
    expect(verifyCsrf(requestWithCookie("csrf_token=tok"), null)).toBe(false);
  });
});
