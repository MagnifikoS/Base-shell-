/**
 * Tests for usePlanningFavorites V2 — Named favorites (max 2 per employee)
 *
 * Tests cover:
 * - Save favorite with custom name
 * - Max 2 favorites enforced
 * - Replace favorite at index
 * - Delete favorite
 * - matchesFavorite (star logic: filled vs outline)
 * - doShiftsMatchTemplate pure function
 * - Backward compat migration from V1 format
 * - resolveFavoriteForWeek produces correct dates
 * - getIsoDayOfWeek helper
 * - shiftsToTemplates helper
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  usePlanningFavorites,
  getIsoDayOfWeek,
  shiftsToTemplates,
  doShiftsMatchTemplate,
  MAX_FAVORITES_PER_EMPLOYEE,
  type FavoriteShiftTemplate,
} from "../usePlanningFavorites";
import type { PlanningShift } from "../../types/planning.types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeShift(overrides: Partial<PlanningShift> = {}): PlanningShift {
  return {
    id: "shift-1",
    user_id: "user-1",
    shift_date: "2026-02-16", // Monday
    start_time: "09:00",
    end_time: "17:00",
    net_minutes: 480,
    break_minutes: 0,
    updated_at: "2026-02-16T12:00:00Z",
    ...overrides,
  };
}

function makeWeekShifts(): PlanningShift[] {
  // Monday 2026-02-16 through Sunday 2026-02-22
  return [
    makeShift({ id: "s1", shift_date: "2026-02-16", start_time: "09:00", end_time: "17:00" }),
    makeShift({ id: "s2", shift_date: "2026-02-17", start_time: "10:00", end_time: "18:00" }),
    makeShift({ id: "s3", shift_date: "2026-02-18", start_time: "09:00", end_time: "17:00" }),
  ];
}

// ── localStorage mock ────────────────────────────────────────────────────────

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: () => {
      store = {};
    },
    getStore: () => store,
  };
})();

Object.defineProperty(window, "localStorage", { value: localStorageMock });

// ── Pure function tests ──────────────────────────────────────────────────────

describe("getIsoDayOfWeek", () => {
  it("returns 0 for Monday", () => {
    // 2026-02-16 is a Monday
    expect(getIsoDayOfWeek("2026-02-16")).toBe(0);
  });

  it("returns 1 for Tuesday", () => {
    expect(getIsoDayOfWeek("2026-02-17")).toBe(1);
  });

  it("returns 4 for Friday", () => {
    expect(getIsoDayOfWeek("2026-02-20")).toBe(4);
  });

  it("returns 5 for Saturday", () => {
    expect(getIsoDayOfWeek("2026-02-21")).toBe(5);
  });

  it("returns 6 for Sunday", () => {
    expect(getIsoDayOfWeek("2026-02-22")).toBe(6);
  });
});

describe("shiftsToTemplates", () => {
  it("converts PlanningShift[] to FavoriteShiftTemplate[]", () => {
    const shifts = makeWeekShifts();
    const templates = shiftsToTemplates(shifts);

    expect(templates).toHaveLength(3);
    expect(templates[0]).toEqual({ dayOfWeek: 0, start_time: "09:00", end_time: "17:00" });
    expect(templates[1]).toEqual({ dayOfWeek: 1, start_time: "10:00", end_time: "18:00" });
    expect(templates[2]).toEqual({ dayOfWeek: 2, start_time: "09:00", end_time: "17:00" });
  });

  it("returns empty array for empty input", () => {
    expect(shiftsToTemplates([])).toEqual([]);
  });
});

describe("doShiftsMatchTemplate", () => {
  const templates: FavoriteShiftTemplate[] = [
    { dayOfWeek: 0, start_time: "09:00", end_time: "17:00" },
    { dayOfWeek: 1, start_time: "10:00", end_time: "18:00" },
    { dayOfWeek: 2, start_time: "09:00", end_time: "17:00" },
  ];

  it("returns true when shifts match templates exactly", () => {
    const shifts = makeWeekShifts();
    expect(doShiftsMatchTemplate(shifts, templates)).toBe(true);
  });

  it("returns true regardless of order", () => {
    const shifts = [...makeWeekShifts()].reverse();
    expect(doShiftsMatchTemplate(shifts, templates)).toBe(true);
  });

  it("returns false when shift count differs", () => {
    const shifts = makeWeekShifts().slice(0, 2);
    expect(doShiftsMatchTemplate(shifts, templates)).toBe(false);
  });

  it("returns false when start_time differs", () => {
    const shifts = makeWeekShifts();
    shifts[0] = { ...shifts[0], start_time: "08:00" };
    expect(doShiftsMatchTemplate(shifts, templates)).toBe(false);
  });

  it("returns false when end_time differs", () => {
    const shifts = makeWeekShifts();
    shifts[1] = { ...shifts[1], end_time: "19:00" };
    expect(doShiftsMatchTemplate(shifts, templates)).toBe(false);
  });

  it("returns false when day differs (different week dates)", () => {
    const shifts = makeWeekShifts();
    // Change date to Thursday instead of Wednesday
    shifts[2] = { ...shifts[2], shift_date: "2026-02-19" };
    expect(doShiftsMatchTemplate(shifts, templates)).toBe(false);
  });

  it("returns false for empty arrays", () => {
    expect(doShiftsMatchTemplate([], [])).toBe(false);
  });
});

// ── Hook tests ───────────────────────────────────────────────────────────────

describe("usePlanningFavorites", () => {
  const establishmentId = "est-123";

  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it("returns empty favorites for a new employee", () => {
    const { result } = renderHook(() => usePlanningFavorites(establishmentId));
    expect(result.current.getFavorites("user-1")).toEqual([]);
  });

  it("saves a favorite with a custom name", () => {
    const { result } = renderHook(() => usePlanningFavorites(establishmentId));
    const shifts = makeWeekShifts();

    act(() => {
      result.current.saveFavorite("user-1", "Semaine normale", shifts, "2026-02-16");
    });

    const favs = result.current.getFavorites("user-1");
    expect(favs).toHaveLength(1);
    expect(favs[0].name).toBe("Semaine normale");
    expect(favs[0].shifts).toHaveLength(3);
    expect(favs[0].savedAt).toBeTruthy();
  });

  it("saves up to 2 favorites per employee", () => {
    const { result } = renderHook(() => usePlanningFavorites(establishmentId));
    const shifts = makeWeekShifts();

    act(() => {
      result.current.saveFavorite("user-1", "Favori 1", shifts, "2026-02-16");
    });
    act(() => {
      result.current.saveFavorite("user-1", "Favori 2", shifts, "2026-02-16");
    });

    expect(result.current.getFavorites("user-1")).toHaveLength(2);
  });

  it("enforces max 2 favorites — third save is ignored", () => {
    const { result } = renderHook(() => usePlanningFavorites(establishmentId));
    const shifts = makeWeekShifts();

    act(() => {
      result.current.saveFavorite("user-1", "Favori 1", shifts, "2026-02-16");
    });
    act(() => {
      result.current.saveFavorite("user-1", "Favori 2", shifts, "2026-02-16");
    });
    act(() => {
      result.current.saveFavorite("user-1", "Favori 3", shifts, "2026-02-16");
    });

    const favs = result.current.getFavorites("user-1");
    expect(favs).toHaveLength(MAX_FAVORITES_PER_EMPLOYEE);
    expect(favs[0].name).toBe("Favori 1");
    expect(favs[1].name).toBe("Favori 2");
  });

  it("replaces favorite at index 0", () => {
    const { result } = renderHook(() => usePlanningFavorites(establishmentId));
    const shifts = makeWeekShifts();

    act(() => {
      result.current.saveFavorite("user-1", "Original", shifts, "2026-02-16");
    });
    act(() => {
      result.current.saveFavorite("user-1", "Second", shifts, "2026-02-16");
    });

    const differentShifts = [
      makeShift({ shift_date: "2026-02-20", start_time: "08:00", end_time: "16:00" }),
    ];
    act(() => {
      result.current.replaceFavorite("user-1", 0, "Remplace", differentShifts, "2026-02-16");
    });

    const favs = result.current.getFavorites("user-1");
    expect(favs).toHaveLength(2);
    expect(favs[0].name).toBe("Remplace");
    expect(favs[0].shifts).toHaveLength(1);
    expect(favs[0].shifts[0].dayOfWeek).toBe(4); // Friday
    expect(favs[1].name).toBe("Second");
  });

  it("replaces favorite at index 1", () => {
    const { result } = renderHook(() => usePlanningFavorites(establishmentId));
    const shifts = makeWeekShifts();

    act(() => {
      result.current.saveFavorite("user-1", "First", shifts, "2026-02-16");
    });
    act(() => {
      result.current.saveFavorite("user-1", "Second", shifts, "2026-02-16");
    });

    const newShifts = [
      makeShift({ shift_date: "2026-02-21", start_time: "11:00", end_time: "19:00" }),
    ];
    act(() => {
      result.current.replaceFavorite("user-1", 1, "Nouveau", newShifts, "2026-02-16");
    });

    const favs = result.current.getFavorites("user-1");
    expect(favs[0].name).toBe("First");
    expect(favs[1].name).toBe("Nouveau");
    expect(favs[1].shifts[0].dayOfWeek).toBe(5); // Saturday
  });

  it("does not replace at invalid index", () => {
    const { result } = renderHook(() => usePlanningFavorites(establishmentId));
    const shifts = makeWeekShifts();

    act(() => {
      result.current.saveFavorite("user-1", "Only", shifts, "2026-02-16");
    });

    act(() => {
      result.current.replaceFavorite("user-1", 5, "Bad", shifts, "2026-02-16");
    });

    expect(result.current.getFavorites("user-1")).toHaveLength(1);
    expect(result.current.getFavorites("user-1")[0].name).toBe("Only");
  });

  it("deletes favorite at index 0", () => {
    const { result } = renderHook(() => usePlanningFavorites(establishmentId));
    const shifts = makeWeekShifts();

    act(() => {
      result.current.saveFavorite("user-1", "First", shifts, "2026-02-16");
    });
    act(() => {
      result.current.saveFavorite("user-1", "Second", shifts, "2026-02-16");
    });

    act(() => {
      result.current.deleteFavorite("user-1", 0);
    });

    const favs = result.current.getFavorites("user-1");
    expect(favs).toHaveLength(1);
    expect(favs[0].name).toBe("Second");
  });

  it("deletes last favorite and removes user from map", () => {
    const { result } = renderHook(() => usePlanningFavorites(establishmentId));
    const shifts = makeWeekShifts();

    act(() => {
      result.current.saveFavorite("user-1", "Only", shifts, "2026-02-16");
    });

    expect(result.current.employeesWithFavorites).toContain("user-1");

    act(() => {
      result.current.deleteFavorite("user-1", 0);
    });

    expect(result.current.getFavorites("user-1")).toEqual([]);
    expect(result.current.employeesWithFavorites).not.toContain("user-1");
  });

  it("does not delete at invalid index", () => {
    const { result } = renderHook(() => usePlanningFavorites(establishmentId));
    const shifts = makeWeekShifts();

    act(() => {
      result.current.saveFavorite("user-1", "Only", shifts, "2026-02-16");
    });

    act(() => {
      result.current.deleteFavorite("user-1", 3);
    });

    expect(result.current.getFavorites("user-1")).toHaveLength(1);
  });

  it("employeesWithFavorites returns correct userIds", () => {
    const { result } = renderHook(() => usePlanningFavorites(establishmentId));
    const shifts = makeWeekShifts();

    act(() => {
      result.current.saveFavorite("user-1", "Fav1", shifts, "2026-02-16");
    });
    act(() => {
      result.current.saveFavorite("user-2", "Fav2", shifts, "2026-02-16");
    });

    expect(result.current.employeesWithFavorites).toContain("user-1");
    expect(result.current.employeesWithFavorites).toContain("user-2");
    expect(result.current.employeesWithFavorites).toHaveLength(2);
  });

  describe("matchesFavorite", () => {
    it("returns matches: true when current shifts match a saved favorite", () => {
      const { result } = renderHook(() => usePlanningFavorites(establishmentId));
      const shifts = makeWeekShifts();

      act(() => {
        result.current.saveFavorite("user-1", "Normal", shifts, "2026-02-16");
      });

      const match = result.current.matchesFavorite("user-1", shifts);
      expect(match.matches).toBe(true);
      expect(match.matchedName).toBe("Normal");
    });

    it("returns matches: true for second favorite", () => {
      const { result } = renderHook(() => usePlanningFavorites(establishmentId));
      const shifts1 = makeWeekShifts();
      const shifts2 = [
        makeShift({ id: "x1", shift_date: "2026-02-20", start_time: "08:00", end_time: "16:00" }),
      ];

      act(() => {
        result.current.saveFavorite("user-1", "Fav1", shifts1, "2026-02-16");
      });
      act(() => {
        result.current.saveFavorite("user-1", "Fav2", shifts2, "2026-02-16");
      });

      const match = result.current.matchesFavorite("user-1", shifts2);
      expect(match.matches).toBe(true);
      expect(match.matchedName).toBe("Fav2");
    });

    it("returns matches: false when shifts differ", () => {
      const { result } = renderHook(() => usePlanningFavorites(establishmentId));
      const shifts = makeWeekShifts();

      act(() => {
        result.current.saveFavorite("user-1", "Normal", shifts, "2026-02-16");
      });

      const differentShifts = [
        makeShift({ shift_date: "2026-02-16", start_time: "08:00", end_time: "16:00" }),
      ];

      const match = result.current.matchesFavorite("user-1", differentShifts);
      expect(match.matches).toBe(false);
      expect(match.matchedName).toBeUndefined();
    });

    it("returns matches: false for employee with no favorites", () => {
      const { result } = renderHook(() => usePlanningFavorites(establishmentId));
      const match = result.current.matchesFavorite("user-nobody", makeWeekShifts());
      expect(match.matches).toBe(false);
    });

    it("matches across different weeks (same day-of-week pattern)", () => {
      const { result } = renderHook(() => usePlanningFavorites(establishmentId));

      // Save from week of 2026-02-16
      const shifts = makeWeekShifts();
      act(() => {
        result.current.saveFavorite("user-1", "Pattern", shifts, "2026-02-16");
      });

      // Check against the same day-of-week pattern in a different week (2026-02-23)
      const nextWeekShifts: PlanningShift[] = [
        makeShift({ id: "n1", shift_date: "2026-02-23", start_time: "09:00", end_time: "17:00" }), // Monday
        makeShift({ id: "n2", shift_date: "2026-02-24", start_time: "10:00", end_time: "18:00" }), // Tuesday
        makeShift({ id: "n3", shift_date: "2026-02-25", start_time: "09:00", end_time: "17:00" }), // Wednesday
      ];

      const match = result.current.matchesFavorite("user-1", nextWeekShifts);
      expect(match.matches).toBe(true);
      expect(match.matchedName).toBe("Pattern");
    });
  });

  describe("resolveFavoriteForWeek", () => {
    it("resolves template to concrete dates for the given week", () => {
      const { result } = renderHook(() => usePlanningFavorites(establishmentId));
      const shifts = makeWeekShifts();

      act(() => {
        result.current.saveFavorite("user-1", "Template", shifts, "2026-02-16");
      });

      // Resolve for a different week
      const resolved = result.current.resolveFavoriteForWeek("user-1", 0, "2026-02-23");
      expect(resolved).not.toBeNull();
      expect(resolved).toHaveLength(3);

      // Mon of week 2026-02-23
      expect(resolved![0].shiftDate).toBe("2026-02-23");
      expect(resolved![0].startTime).toBe("09:00");
      expect(resolved![0].endTime).toBe("17:00");

      // Tue
      expect(resolved![1].shiftDate).toBe("2026-02-24");
      expect(resolved![1].startTime).toBe("10:00");
      expect(resolved![1].endTime).toBe("18:00");

      // Wed
      expect(resolved![2].shiftDate).toBe("2026-02-25");
      expect(resolved![2].startTime).toBe("09:00");
      expect(resolved![2].endTime).toBe("17:00");
    });

    it("resolves second favorite (index 1)", () => {
      const { result } = renderHook(() => usePlanningFavorites(establishmentId));

      const shifts1 = makeWeekShifts();
      const shifts2 = [
        makeShift({ shift_date: "2026-02-20", start_time: "08:00", end_time: "16:00" }), // Friday
      ];

      act(() => {
        result.current.saveFavorite("user-1", "Fav1", shifts1, "2026-02-16");
      });
      act(() => {
        result.current.saveFavorite("user-1", "Fav2", shifts2, "2026-02-16");
      });

      const resolved = result.current.resolveFavoriteForWeek("user-1", 1, "2026-02-23");
      expect(resolved).toHaveLength(1);
      // Friday of week 2026-02-23 = 2026-02-27
      expect(resolved![0].shiftDate).toBe("2026-02-27");
      expect(resolved![0].startTime).toBe("08:00");
    });

    it("returns null for invalid index", () => {
      const { result } = renderHook(() => usePlanningFavorites(establishmentId));

      act(() => {
        result.current.saveFavorite("user-1", "Fav", makeWeekShifts(), "2026-02-16");
      });

      expect(result.current.resolveFavoriteForWeek("user-1", 5, "2026-02-23")).toBeNull();
    });

    it("returns null for user with no favorites", () => {
      const { result } = renderHook(() => usePlanningFavorites(establishmentId));
      expect(result.current.resolveFavoriteForWeek("nobody", 0, "2026-02-23")).toBeNull();
    });
  });

  describe("backward compatibility migration", () => {
    it("migrates V1 single-favorite format to V2 named array format", () => {
      // Set up V1 data in localStorage
      const v1Key = `planning-favorites-${establishmentId}`;
      const v1Data = {
        "user-1": {
          shifts: [
            { dayOfWeek: 0, start_time: "09:00", end_time: "17:00" },
            { dayOfWeek: 2, start_time: "10:00", end_time: "18:00" },
          ],
          savedAt: "2026-01-01T00:00:00Z",
        },
      };
      localStorageMock.setItem(v1Key, JSON.stringify(v1Data));

      const { result } = renderHook(() => usePlanningFavorites(establishmentId));

      // Should have migrated
      const favs = result.current.getFavorites("user-1");
      expect(favs).toHaveLength(1);
      expect(favs[0].name).toBe("Favori"); // default name for migrated
      expect(favs[0].shifts).toHaveLength(2);
      expect(favs[0].savedAt).toBe("2026-01-01T00:00:00Z");

      // V1 key should be deleted
      expect(localStorageMock.getItem(v1Key)).toBeNull();

      // V2 key should exist
      const v2Key = `planning-favorites-v2-${establishmentId}`;
      expect(localStorageMock.getItem(v2Key)).toBeTruthy();
    });

    it("does not re-migrate if V2 data already exists", () => {
      const v1Key = `planning-favorites-${establishmentId}`;
      const v2Key = `planning-favorites-v2-${establishmentId}`;

      // Set V1 data
      localStorageMock.setItem(
        v1Key,
        JSON.stringify({
          "user-old": {
            shifts: [{ dayOfWeek: 0, start_time: "08:00", end_time: "16:00" }],
            savedAt: "2025-01-01T00:00:00Z",
          },
        })
      );

      // Set V2 data (already migrated)
      localStorageMock.setItem(
        v2Key,
        JSON.stringify({
          "user-new": [
            {
              name: "Existing",
              shifts: [{ dayOfWeek: 1, start_time: "10:00", end_time: "18:00" }],
              savedAt: "2026-01-15T00:00:00Z",
            },
          ],
        })
      );

      const { result } = renderHook(() => usePlanningFavorites(establishmentId));

      // Should load V2 data, not migrate V1
      expect(result.current.getFavorites("user-new")).toHaveLength(1);
      expect(result.current.getFavorites("user-new")[0].name).toBe("Existing");
      expect(result.current.getFavorites("user-old")).toEqual([]);
    });
  });

  describe("persistence", () => {
    it("persists to localStorage on save", () => {
      const { result } = renderHook(() => usePlanningFavorites(establishmentId));
      const shifts = makeWeekShifts();

      act(() => {
        result.current.saveFavorite("user-1", "Persisted", shifts, "2026-02-16");
      });

      const stored = localStorageMock.getItem(`planning-favorites-v2-${establishmentId}`);
      expect(stored).toBeTruthy();
      const parsed = JSON.parse(stored!);
      expect(parsed["user-1"]).toHaveLength(1);
      expect(parsed["user-1"][0].name).toBe("Persisted");
    });

    it("persists deletions to localStorage", () => {
      const { result } = renderHook(() => usePlanningFavorites(establishmentId));
      const shifts = makeWeekShifts();

      act(() => {
        result.current.saveFavorite("user-1", "ToDelete", shifts, "2026-02-16");
      });
      act(() => {
        result.current.deleteFavorite("user-1", 0);
      });

      const stored = localStorageMock.getItem(`planning-favorites-v2-${establishmentId}`);
      const parsed = JSON.parse(stored!);
      expect(parsed["user-1"]).toBeUndefined();
    });
  });

  describe("null/undefined establishment", () => {
    it("returns empty data for null establishment", () => {
      const { result } = renderHook(() => usePlanningFavorites(null));
      expect(result.current.getFavorites("user-1")).toEqual([]);
      expect(result.current.employeesWithFavorites).toEqual([]);
    });

    it("does not save when establishment is null", () => {
      const { result } = renderHook(() => usePlanningFavorites(null));
      act(() => {
        result.current.saveFavorite("user-1", "Nope", makeWeekShifts(), "2026-02-16");
      });
      expect(result.current.getFavorites("user-1")).toEqual([]);
    });
  });
});
