/**
 * Additional tests for deviceId.ts — Device ID generation and persistence
 *
 * Supplements the existing deviceId.test.ts with:
 * - localStorage failure scenarios
 * - ID format stability
 * - Multiple calls behavior
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { getDeviceId, hasDeviceId } from "../deviceId";

describe("deviceId — additional edge cases", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("getDeviceId — localStorage unavailable", () => {
    it("returns a device ID even when localStorage.getItem throws", () => {
      const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("SecurityError");
      });
      const id = getDeviceId();
      expect(id.startsWith("dev_")).toBe(true);
      expect(id.length).toBeGreaterThan(4);
      spy.mockRestore();
    });

    it("returns a device ID even when localStorage.setItem throws", () => {
      const spyGet = vi.spyOn(Storage.prototype, "getItem").mockReturnValue(null);
      const spySet = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("QuotaExceeded");
      });
      const id = getDeviceId();
      expect(id.startsWith("dev_")).toBe(true);
      spyGet.mockRestore();
      spySet.mockRestore();
    });
  });

  describe("getDeviceId — format stability", () => {
    it("ID length is consistent (dev_ prefix + UUID = 40 chars)", () => {
      const id = getDeviceId();
      // "dev_" = 4 chars, UUID = 36 chars, total = 40
      expect(id.length).toBe(40);
    });

    it("persisted ID is retrieved across multiple calls", () => {
      const first = getDeviceId();
      const second = getDeviceId();
      const third = getDeviceId();
      expect(first).toBe(second);
      expect(second).toBe(third);
    });

    it("does not generate a new ID when one exists", () => {
      localStorage.setItem("badgeuse_device_id", "dev_test-id-12345678-1234-1234-1234");
      const spy = vi.spyOn(crypto, "randomUUID");
      const id = getDeviceId();
      expect(id).toBe("dev_test-id-12345678-1234-1234-1234");
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe("hasDeviceId — edge cases", () => {
    it("returns false when localStorage.getItem throws", () => {
      const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("SecurityError");
      });
      expect(hasDeviceId()).toBe(false);
      spy.mockRestore();
    });

    it("returns false for empty string in localStorage", () => {
      localStorage.setItem("badgeuse_device_id", "");
      expect(hasDeviceId()).toBe(false);
    });

    it("returns true for any non-empty value in localStorage", () => {
      localStorage.setItem("badgeuse_device_id", "any-value");
      expect(hasDeviceId()).toBe(true);
    });
  });
});
