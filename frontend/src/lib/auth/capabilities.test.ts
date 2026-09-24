import { describe, expect, test } from "vitest";
import { CAPABILITIES, hasCapability, isCapability } from "./capabilities";

describe("capabilities", () => {
  test("CAPABILITIES only contains technical keys, never a Bureau title", () => {
    // Regression guard for the M1 authorization boundary: these are the only capability
    // keys the app foundation may reference until HB-4/HB-5/HB-6/HB-7 are resolved.
    expect(CAPABILITIES).toEqual([
      "inventory.view",
      "inventory.receive",
      "inventory.issue",
      "inventory.transfer",
      "inventory.count",
      "inventory.adjust",
      "inventory.approve",
      "master.manage",
      "reports.view",
      "admin.manage_users",
      "audit.read",
    ]);
  });

  test("isCapability accepts a known key", () => {
    expect(isCapability("inventory.view")).toBe(true);
  });

  test("isCapability rejects an unknown key", () => {
    expect(isCapability("storekeeper.approve")).toBe(false);
    expect(isCapability("")).toBe(false);
  });

  test("hasCapability is true when the capability is granted", () => {
    expect(hasCapability(["inventory.view", "inventory.receive"], "inventory.view")).toBe(
      true,
    );
  });

  test("hasCapability is false when the capability is not granted", () => {
    expect(hasCapability(["inventory.view"], "admin.manage_users")).toBe(false);
  });

  test("hasCapability is false for an empty grant set", () => {
    expect(hasCapability([], "inventory.view")).toBe(false);
  });
});
