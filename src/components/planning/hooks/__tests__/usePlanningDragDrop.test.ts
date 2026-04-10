import { describe, it, expect } from "vitest";
import {
  applyOptimisticAdd,
  applyOptimisticRemove,
  buildOptimisticShift,
} from "../usePlanningDragDrop";
import type { PlanningWeekData, PlanningShift } from "../../types/planning.types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePlanningWeekData(overrides?: Partial<PlanningWeekData>): PlanningWeekData {
  return {
    weekStart: "2026-02-16",
    weekEnd: "2026-02-22",
    timezone: "Europe/Paris",
    establishment: { id: "est-1", name: "Test Restaurant" },
    teams: [],
    employees: [
      { user_id: "user-a", full_name: "Alice", status: "active", team_id: null, team_name: null },
      { user_id: "user-b", full_name: "Bob", status: "active", team_id: null, team_name: null },
    ],
    shiftsByEmployee: {
      "user-a": [
        {
          id: "shift-1",
          user_id: "user-a",
          shift_date: "2026-02-16",
          start_time: "09:00",
          end_time: "17:00",
          net_minutes: 480,
          break_minutes: 0,
          updated_at: "2026-02-16T09:00:00Z",
        },
      ],
      "user-b": [],
    },
    totalsByEmployee: {
      "user-a": 480,
      "user-b": 0,
    },
    validation: {
      weekValidated: false,
      validatedDays: {},
      weekInvalidatedAt: null,
    },
    dayParts: {
      morning: { start_time: "06:00", end_time: "12:00", color: "#fff" },
      midday: { start_time: "12:00", end_time: "14:00", color: "#fff" },
      evening: { start_time: "14:00", end_time: "23:00", color: "#fff" },
    },
    openingByDate: {},
    ...overrides,
  };
}

const baseDragPayload = {
  start_time: "09:00",
  end_time: "17:00",
  fromShiftId: "shift-1",
  fromEmployeeId: "user-a",
};

// ---------------------------------------------------------------------------
// Tests: buildOptimisticShift
// ---------------------------------------------------------------------------

describe("buildOptimisticShift", () => {
  it("creates a shift with temp-dnd- prefix ID", () => {
    const shift = buildOptimisticShift("user-b", "2026-02-17", "est-1", baseDragPayload);

    expect(shift.id).toMatch(/^temp-dnd-/);
    expect(shift.user_id).toBe("user-b");
    expect(shift.shift_date).toBe("2026-02-17");
    expect(shift.start_time).toBe("09:00");
    expect(shift.end_time).toBe("17:00");
    expect(shift.net_minutes).toBe(480);
    expect(shift.break_minutes).toBe(0);
    expect(shift.updated_at).toBeDefined();
  });

  it("calculates net_minutes correctly for different times", () => {
    const shift = buildOptimisticShift("user-b", "2026-02-17", "est-1", {
      ...baseDragPayload,
      start_time: "14:00",
      end_time: "18:30",
    });

    expect(shift.net_minutes).toBe(270); // 4h30 = 270 minutes
  });

  it("clamps net_minutes to zero for invalid time ranges", () => {
    const shift = buildOptimisticShift("user-b", "2026-02-17", "est-1", {
      ...baseDragPayload,
      start_time: "18:00",
      end_time: "09:00",
    });

    expect(shift.net_minutes).toBe(0);
  });

  it("generates unique IDs for rapid successive calls", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const shift = buildOptimisticShift("user-b", "2026-02-17", "est-1", baseDragPayload);
      ids.add(shift.id);
    }
    expect(ids.size).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Tests: applyOptimisticAdd
// ---------------------------------------------------------------------------

describe("applyOptimisticAdd", () => {
  it("adds a shift to an employee with no existing shifts", () => {
    const data = makePlanningWeekData();
    const newShift: PlanningShift = {
      id: "temp-dnd-new",
      user_id: "user-b",
      shift_date: "2026-02-17",
      start_time: "10:00",
      end_time: "14:00",
      net_minutes: 240,
      break_minutes: 0,
      updated_at: new Date().toISOString(),
    };

    const result = applyOptimisticAdd(data, "user-b", newShift);

    expect(result.shiftsByEmployee["user-b"]).toHaveLength(1);
    expect(result.shiftsByEmployee["user-b"][0].id).toBe("temp-dnd-new");
    expect(result.totalsByEmployee["user-b"]).toBe(240);
  });

  it("appends a shift to an employee with existing shifts", () => {
    const data = makePlanningWeekData();
    const newShift: PlanningShift = {
      id: "temp-dnd-new",
      user_id: "user-a",
      shift_date: "2026-02-17",
      start_time: "10:00",
      end_time: "14:00",
      net_minutes: 240,
      break_minutes: 0,
      updated_at: new Date().toISOString(),
    };

    const result = applyOptimisticAdd(data, "user-a", newShift);

    expect(result.shiftsByEmployee["user-a"]).toHaveLength(2);
    expect(result.shiftsByEmployee["user-a"][0].id).toBe("shift-1"); // Original
    expect(result.shiftsByEmployee["user-a"][1].id).toBe("temp-dnd-new"); // New
    expect(result.totalsByEmployee["user-a"]).toBe(720); // 480 + 240
  });

  it("does not mutate the original data", () => {
    const data = makePlanningWeekData();
    const originalShiftsRef = data.shiftsByEmployee["user-a"];
    const newShift: PlanningShift = {
      id: "temp-dnd-new",
      user_id: "user-a",
      shift_date: "2026-02-17",
      start_time: "10:00",
      end_time: "14:00",
      net_minutes: 240,
      break_minutes: 0,
      updated_at: new Date().toISOString(),
    };

    applyOptimisticAdd(data, "user-a", newShift);

    // Original data should be unchanged
    expect(data.shiftsByEmployee["user-a"]).toBe(originalShiftsRef);
    expect(data.shiftsByEmployee["user-a"]).toHaveLength(1);
    expect(data.totalsByEmployee["user-a"]).toBe(480);
  });

  it("handles employee with undefined shifts array", () => {
    const data = makePlanningWeekData({
      shiftsByEmployee: {},
      totalsByEmployee: {},
    });
    const newShift: PlanningShift = {
      id: "temp-dnd-new",
      user_id: "user-c",
      shift_date: "2026-02-17",
      start_time: "10:00",
      end_time: "14:00",
      net_minutes: 240,
      break_minutes: 0,
      updated_at: new Date().toISOString(),
    };

    const result = applyOptimisticAdd(data, "user-c", newShift);

    expect(result.shiftsByEmployee["user-c"]).toHaveLength(1);
    expect(result.totalsByEmployee["user-c"]).toBe(240);
  });
});

// ---------------------------------------------------------------------------
// Tests: applyOptimisticRemove
// ---------------------------------------------------------------------------

describe("applyOptimisticRemove", () => {
  it("removes a shift from an employee", () => {
    const data = makePlanningWeekData();

    const result = applyOptimisticRemove(data, "user-a", "shift-1");

    expect(result.shiftsByEmployee["user-a"]).toHaveLength(0);
    expect(result.totalsByEmployee["user-a"]).toBe(0);
  });

  it("does nothing if shiftId does not exist", () => {
    const data = makePlanningWeekData();

    const result = applyOptimisticRemove(data, "user-a", "nonexistent-shift");

    expect(result.shiftsByEmployee["user-a"]).toHaveLength(1);
    expect(result.totalsByEmployee["user-a"]).toBe(480);
  });

  it("does not mutate the original data", () => {
    const data = makePlanningWeekData();
    const originalShiftsRef = data.shiftsByEmployee["user-a"];

    applyOptimisticRemove(data, "user-a", "shift-1");

    expect(data.shiftsByEmployee["user-a"]).toBe(originalShiftsRef);
    expect(data.shiftsByEmployee["user-a"]).toHaveLength(1);
  });

  it("correctly recalculates total after removal with multiple shifts", () => {
    const data = makePlanningWeekData({
      shiftsByEmployee: {
        "user-a": [
          {
            id: "shift-1",
            user_id: "user-a",
            shift_date: "2026-02-16",
            start_time: "09:00",
            end_time: "13:00",
            net_minutes: 240,
            break_minutes: 0,
            updated_at: "2026-02-16T09:00:00Z",
          },
          {
            id: "shift-2",
            user_id: "user-a",
            shift_date: "2026-02-16",
            start_time: "14:00",
            end_time: "18:00",
            net_minutes: 240,
            break_minutes: 0,
            updated_at: "2026-02-16T14:00:00Z",
          },
        ],
        "user-b": [],
      },
      totalsByEmployee: {
        "user-a": 480,
        "user-b": 0,
      },
    });

    const result = applyOptimisticRemove(data, "user-a", "shift-1");

    expect(result.shiftsByEmployee["user-a"]).toHaveLength(1);
    expect(result.shiftsByEmployee["user-a"][0].id).toBe("shift-2");
    expect(result.totalsByEmployee["user-a"]).toBe(240);
  });

  it("handles employee with no shifts gracefully", () => {
    const data = makePlanningWeekData();

    const result = applyOptimisticRemove(data, "user-b", "nonexistent");

    expect(result.shiftsByEmployee["user-b"]).toHaveLength(0);
    expect(result.totalsByEmployee["user-b"]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: Move semantics (combined add + remove)
// ---------------------------------------------------------------------------

describe("Move semantics (add + remove combined)", () => {
  it("same employee drag: removes source and adds at target date", () => {
    const data = makePlanningWeekData();
    const newShift = buildOptimisticShift("user-a", "2026-02-17", "est-1", baseDragPayload);

    // Apply add then remove (move within same employee)
    let result = applyOptimisticAdd(data, "user-a", newShift);
    result = applyOptimisticRemove(result, "user-a", "shift-1");

    // Should have exactly 1 shift (the new one, at the new date)
    expect(result.shiftsByEmployee["user-a"]).toHaveLength(1);
    expect(result.shiftsByEmployee["user-a"][0].shift_date).toBe("2026-02-17");
    expect(result.shiftsByEmployee["user-a"][0].id).toMatch(/^temp-dnd-/);
    // Total stays 480 (same duration shift moved)
    expect(result.totalsByEmployee["user-a"]).toBe(480);
  });

  it("different employee drag: keeps source and adds to target", () => {
    const data = makePlanningWeekData();
    const newShift = buildOptimisticShift("user-b", "2026-02-17", "est-1", baseDragPayload);

    // Apply add only (copy to different employee)
    const result = applyOptimisticAdd(data, "user-b", newShift);

    // Source employee unchanged
    expect(result.shiftsByEmployee["user-a"]).toHaveLength(1);
    expect(result.totalsByEmployee["user-a"]).toBe(480);
    // Target employee has new shift
    expect(result.shiftsByEmployee["user-b"]).toHaveLength(1);
    expect(result.totalsByEmployee["user-b"]).toBe(480);
  });
});

// ---------------------------------------------------------------------------
// Tests: Cache snapshot and revert
// ---------------------------------------------------------------------------

describe("Cache snapshot and revert", () => {
  it("revert restores original data after add", () => {
    const original = makePlanningWeekData();
    const snapshot = makePlanningWeekData(); // Independent copy

    const newShift = buildOptimisticShift("user-a", "2026-02-17", "est-1", baseDragPayload);
    const modified = applyOptimisticAdd(original, "user-a", newShift);

    // Modified has 2 shifts
    expect(modified.shiftsByEmployee["user-a"]).toHaveLength(2);

    // Snapshot is still pristine (simulates queryClient.setQueryData(key, snapshot))
    expect(snapshot.shiftsByEmployee["user-a"]).toHaveLength(1);
    expect(snapshot.totalsByEmployee["user-a"]).toBe(480);
  });

  it("revert restores original data after remove", () => {
    const original = makePlanningWeekData();
    const snapshot = makePlanningWeekData();

    const modified = applyOptimisticRemove(original, "user-a", "shift-1");

    expect(modified.shiftsByEmployee["user-a"]).toHaveLength(0);
    expect(snapshot.shiftsByEmployee["user-a"]).toHaveLength(1);
    expect(snapshot.totalsByEmployee["user-a"]).toBe(480);
  });
});

// ---------------------------------------------------------------------------
// Tests: Edge cases
// ---------------------------------------------------------------------------

describe("Edge cases", () => {
  it("handles multiple rapid add operations without data corruption", () => {
    let data = makePlanningWeekData();

    // Simulate 5 rapid drops
    for (let i = 0; i < 5; i++) {
      const shift = buildOptimisticShift("user-b", `2026-02-${17 + i}`, "est-1", {
        ...baseDragPayload,
        fromShiftId: `shift-source-${i}`,
      });
      data = applyOptimisticAdd(data, "user-b", shift);
    }

    expect(data.shiftsByEmployee["user-b"]).toHaveLength(5);
    expect(data.totalsByEmployee["user-b"]).toBe(480 * 5);

    // All shifts have unique IDs
    const ids = data.shiftsByEmployee["user-b"].map((s) => s.id);
    expect(new Set(ids).size).toBe(5);
  });

  it("add then remove different shifts does not affect each other", () => {
    const data = makePlanningWeekData({
      shiftsByEmployee: {
        "user-a": [
          {
            id: "shift-1",
            user_id: "user-a",
            shift_date: "2026-02-16",
            start_time: "09:00",
            end_time: "13:00",
            net_minutes: 240,
            break_minutes: 0,
            updated_at: "2026-02-16T09:00:00Z",
          },
          {
            id: "shift-2",
            user_id: "user-a",
            shift_date: "2026-02-17",
            start_time: "14:00",
            end_time: "18:00",
            net_minutes: 240,
            break_minutes: 0,
            updated_at: "2026-02-17T14:00:00Z",
          },
        ],
        "user-b": [],
      },
      totalsByEmployee: { "user-a": 480, "user-b": 0 },
    });

    // Add a new shift
    const newShift: PlanningShift = {
      id: "temp-dnd-new",
      user_id: "user-a",
      shift_date: "2026-02-18",
      start_time: "10:00",
      end_time: "14:00",
      net_minutes: 240,
      break_minutes: 0,
      updated_at: new Date().toISOString(),
    };

    let result = applyOptimisticAdd(data, "user-a", newShift);
    // Remove shift-1 (different from the one added)
    result = applyOptimisticRemove(result, "user-a", "shift-1");

    expect(result.shiftsByEmployee["user-a"]).toHaveLength(2);
    expect(result.shiftsByEmployee["user-a"].map((s) => s.id)).toEqual(["shift-2", "temp-dnd-new"]);
    expect(result.totalsByEmployee["user-a"]).toBe(480); // 240 + 240
  });

  it("preserves other fields of PlanningWeekData", () => {
    const data = makePlanningWeekData();
    const newShift = buildOptimisticShift("user-b", "2026-02-17", "est-1", baseDragPayload);

    const result = applyOptimisticAdd(data, "user-b", newShift);

    // All other fields preserved
    expect(result.weekStart).toBe("2026-02-16");
    expect(result.weekEnd).toBe("2026-02-22");
    expect(result.timezone).toBe("Europe/Paris");
    expect(result.establishment).toEqual({ id: "est-1", name: "Test Restaurant" });
    expect(result.employees).toHaveLength(2);
    expect(result.validation.weekValidated).toBe(false);
  });
});
