import { describe, it, expect, vi, beforeEach } from "vitest";
import { getDeviceId, hasDeviceId } from "../deviceId";

describe("deviceId", () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
  });

  describe("getDeviceId", () => {
    it("generates an ID with the 'dev_' prefix", () => {
      const id = getDeviceId();
      expect(id.startsWith("dev_")).toBe(true);
    });

    it("uses crypto.randomUUID for the ID suffix", () => {
      const mockUUID = "550e8400-e29b-41d4-a716-446655440000";
      const spy = vi
        .spyOn(crypto, "randomUUID")
        .mockReturnValue(mockUUID as `${string}-${string}-${string}-${string}-${string}`);
      // Clear any existing ID so a new one is generated
      localStorage.clear();
      const id = getDeviceId();
      expect(id).toBe(`dev_${mockUUID}`);
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it("generates a UUID-format suffix (not Math.random)", () => {
      const id = getDeviceId();
      // Remove the "dev_" prefix and check UUID format
      const suffix = id.replace("dev_", "");
      // UUID v4 format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
      expect(suffix).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it("persists the ID in localStorage", () => {
      const id = getDeviceId();
      expect(localStorage.getItem("badgeuse_device_id")).toBe(id);
    });

    it("returns the same ID on subsequent calls", () => {
      const first = getDeviceId();
      const second = getDeviceId();
      expect(first).toBe(second);
    });

    it("returns an existing ID from localStorage without generating a new one", () => {
      const existingId = "dev_existing-uuid-1234-5678-abcdefabcdef";
      localStorage.setItem("badgeuse_device_id", existingId);
      const spy = vi.spyOn(crypto, "randomUUID");
      const id = getDeviceId();
      expect(id).toBe(existingId);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe("hasDeviceId", () => {
    it("returns false when no device ID has been generated", () => {
      expect(hasDeviceId()).toBe(false);
    });

    it("returns true after a device ID has been generated", () => {
      getDeviceId();
      expect(hasDeviceId()).toBe(true);
    });

    it("returns true when a device ID exists in localStorage", () => {
      localStorage.setItem("badgeuse_device_id", "dev_some-id");
      expect(hasDeviceId()).toBe(true);
    });
  });
});
