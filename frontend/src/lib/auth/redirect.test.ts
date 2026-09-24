import { describe, expect, test } from "vitest";
import { safeRedirectTarget } from "./redirect";

describe("safeRedirectTarget", () => {
  test("accepts a normal same-origin path", () => {
    expect(safeRedirectTarget("/dashboard", "/fallback")).toBe("/dashboard");
    expect(safeRedirectTarget("/dashboard/items?x=1", "/fallback")).toBe("/dashboard/items?x=1");
  });

  test("falls back for a protocol-relative open-redirect target", () => {
    expect(safeRedirectTarget("//evil.com", "/fallback")).toBe("/fallback");
    expect(safeRedirectTarget("//evil.com/path", "/fallback")).toBe("/fallback");
  });

  test("falls back for a backslash open-redirect target some browsers normalize", () => {
    expect(safeRedirectTarget("/\\evil.com", "/fallback")).toBe("/fallback");
  });

  test("falls back for an absolute URL", () => {
    expect(safeRedirectTarget("https://evil.com", "/fallback")).toBe("/fallback");
    expect(safeRedirectTarget("http://evil.com", "/fallback")).toBe("/fallback");
  });

  test("falls back for a value not starting with a single slash", () => {
    expect(safeRedirectTarget("dashboard", "/fallback")).toBe("/fallback");
  });

  test("falls back for non-string or empty input", () => {
    expect(safeRedirectTarget(undefined, "/fallback")).toBe("/fallback");
    expect(safeRedirectTarget(null, "/fallback")).toBe("/fallback");
    expect(safeRedirectTarget("", "/fallback")).toBe("/fallback");
    expect(safeRedirectTarget(42, "/fallback")).toBe("/fallback");
  });
});
