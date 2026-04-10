/**
 * Tests for Agent 03 fix: Alert expected times in PresenceEmployeeRow
 *
 * Bug: "Départ non enregistré à 10:30" showed clock-in time (wrong)
 *       instead of planned shift end "à 15:00" (correct)
 *
 * The fix ensures:
 * - missing_clock_out => shows plannedEnd (shift END time)
 * - missing_clock_in  => shows plannedStart (shift START time)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { PresenceEmployeeCard, PresenceSession } from "@/lib/presence/presence.compute";

// ─── Mock dependencies ────────────────────────────────────────────────────────
vi.mock("@/hooks/presence/useAdminBadgeMutations", () => ({
  useAdminBadgeMutations: () => ({
    resetDay: { mutateAsync: vi.fn() },
    isResetting: false,
  }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null }),
    }),
  },
}));

import { PresenceEmployeeRow } from "../PresenceEmployeeRow";

// ─── Test wrapper ─────────────────────────────────────────────────────────────

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: 0 } },
});

function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<PresenceSession> = {}): PresenceSession {
  return {
    sequenceIndex: 1,
    plannedStart: "10:00",
    plannedEnd: "15:00",
    clockIn: null,
    clockOut: null,
    lateMinutes: 0,
    earlyDepartureMinutes: 0,
    status: "absent",
    isNotStartedYet: false,
    isFinishedWithoutClockIn: false,
    isFinishedWithoutClockOut: false,
    clockInEvent: null,
    clockOutEvent: null,
    hasMismatch: false,
    planningModifiedAfterBadge: false,
    ...overrides,
  };
}

function makeEmployee(
  sessions: PresenceSession[],
  overrides: Partial<PresenceEmployeeCard> = {}
): PresenceEmployeeCard {
  return {
    userId: "user-1",
    fullName: "Jean Dupont",
    sessions,
    allEvents: [],
    totalLateMinutes: 0,
    cumulativeLateMinutes: 0,
    source: "planning",
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("PresenceEmployeeRow — alert expected times", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
  });

  it("single shift missing clock-out — shows shift END time (plannedEnd) in message", () => {
    // Shift: 10:00 - 15:00, clocked IN at 10:05, never clocked out
    const session = makeSession({
      plannedStart: "10:00",
      plannedEnd: "15:00",
      clockIn: "10:05",
      clockOut: null,
      status: "present",
      isFinishedWithoutClockOut: true,
      clockInEvent: {
        id: "e1",
        user_id: "user-1",
        event_type: "clock_in",
        occurred_at: "2026-02-17T10:05:00+01:00",
        effective_at: "2026-02-17T10:00:00+01:00",
        day_date: "2026-02-17",
        sequence_index: 1,
      },
    });

    const employee = makeEmployee([session], {
      allEvents: [session.clockInEvent!],
    });

    render(<PresenceEmployeeRow employee={employee} />, { wrapper: Wrapper });

    // Must show "Départ non enregistré (prévu à 15:00)" — NOT "à 10:00" or "à 10:05"
    const alertText = screen.getByText(/Départ non enregistré/);
    expect(alertText.textContent).toContain("15:00");
    expect(alertText.textContent).not.toContain("10:05");
  });

  it("single shift missing clock-in (orphan clock-out) — shows shift START time (plannedStart) in message", () => {
    // Shift: 10:00 - 15:00, never clocked in, has clock_out at 15:00 (orphan)
    const session = makeSession({
      plannedStart: "10:00",
      plannedEnd: "15:00",
      clockIn: null,
      clockOut: "15:00",
      status: "unknown", // orphan clock_out = status "unknown"
      isFinishedWithoutClockIn: true,
      clockOutEvent: {
        id: "e2",
        user_id: "user-1",
        event_type: "clock_out",
        occurred_at: "2026-02-17T15:00:00+01:00",
        effective_at: "2026-02-17T15:00:00+01:00",
        day_date: "2026-02-17",
        sequence_index: 1,
      },
    });

    const employee = makeEmployee([session], {
      allEvents: [session.clockOutEvent!],
    });

    render(<PresenceEmployeeRow employee={employee} />, { wrapper: Wrapper });

    // There may be two "Arrivée non enregistrée" texts (session row + parent card badge)
    // The session row one has the time; find the one with plannedStart
    const allAlertTexts = screen.getAllByText(/Arrivée non enregistrée/);
    const sessionAlert = allAlertTexts.find((el) => el.textContent?.includes("10:00"));
    expect(sessionAlert).toBeDefined();
    expect(sessionAlert!.textContent).toContain("10:00");
    expect(sessionAlert!.textContent).not.toContain("15:00");
  });

  it("double shift: missing clock-out on shift 1 — shows shift 1 END time, not shift 2 START", () => {
    // Shift 1: 08:00 - 12:00, clocked in, no clock_out (finished without)
    // Shift 2: 14:00 - 18:00, normal
    const session1 = makeSession({
      sequenceIndex: 1,
      plannedStart: "08:00",
      plannedEnd: "12:00",
      clockIn: "08:05",
      clockOut: null,
      status: "present",
      isFinishedWithoutClockOut: true,
      clockInEvent: {
        id: "e1",
        user_id: "user-1",
        event_type: "clock_in",
        occurred_at: "2026-02-17T08:05:00+01:00",
        effective_at: "2026-02-17T08:00:00+01:00",
        day_date: "2026-02-17",
        sequence_index: 1,
      },
    });

    const session2 = makeSession({
      sequenceIndex: 2,
      plannedStart: "14:00",
      plannedEnd: "18:00",
      clockIn: "14:00",
      clockOut: "18:00",
      status: "present",
      isFinishedWithoutClockOut: false,
      clockInEvent: {
        id: "e2",
        user_id: "user-1",
        event_type: "clock_in",
        occurred_at: "2026-02-17T14:00:00+01:00",
        effective_at: "2026-02-17T14:00:00+01:00",
        day_date: "2026-02-17",
        sequence_index: 2,
      },
      clockOutEvent: {
        id: "e3",
        user_id: "user-1",
        event_type: "clock_out",
        occurred_at: "2026-02-17T18:00:00+01:00",
        effective_at: "2026-02-17T18:00:00+01:00",
        day_date: "2026-02-17",
        sequence_index: 2,
      },
    });

    const employee = makeEmployee([session1, session2], {
      allEvents: [session1.clockInEvent!, session2.clockInEvent!, session2.clockOutEvent!],
    });

    render(<PresenceEmployeeRow employee={employee} />, { wrapper: Wrapper });

    // Must show "Départ non enregistré (prévu à 12:00)" for shift 1
    // NOT "à 14:00" (shift 2 start) or "à 08:05" (shift 1 clock-in)
    const alertText = screen.getByText(/Départ non enregistré/);
    expect(alertText.textContent).toContain("12:00");
    expect(alertText.textContent).not.toContain("14:00");
    expect(alertText.textContent).not.toContain("08:05");
  });

  it("double shift: missing clock-in on shift 2 — shows shift 2 START time", () => {
    // Shift 1: 08:00 - 12:00, normal (present)
    // Shift 2: 14:00 - 18:00, orphan clock_out (missing clock_in)
    const session1 = makeSession({
      sequenceIndex: 1,
      plannedStart: "08:00",
      plannedEnd: "12:00",
      clockIn: "08:00",
      clockOut: "12:00",
      status: "present",
      clockInEvent: {
        id: "e1",
        user_id: "user-1",
        event_type: "clock_in",
        occurred_at: "2026-02-17T08:00:00+01:00",
        effective_at: "2026-02-17T08:00:00+01:00",
        day_date: "2026-02-17",
        sequence_index: 1,
      },
      clockOutEvent: {
        id: "e2",
        user_id: "user-1",
        event_type: "clock_out",
        occurred_at: "2026-02-17T12:00:00+01:00",
        effective_at: "2026-02-17T12:00:00+01:00",
        day_date: "2026-02-17",
        sequence_index: 1,
      },
    });

    const session2 = makeSession({
      sequenceIndex: 2,
      plannedStart: "14:00",
      plannedEnd: "18:00",
      clockIn: null,
      clockOut: "18:00",
      status: "unknown", // orphan clock_out = status "unknown"
      isFinishedWithoutClockIn: true,
      clockOutEvent: {
        id: "e3",
        user_id: "user-1",
        event_type: "clock_out",
        occurred_at: "2026-02-17T18:00:00+01:00",
        effective_at: "2026-02-17T18:00:00+01:00",
        day_date: "2026-02-17",
        sequence_index: 2,
      },
    });

    const employee = makeEmployee([session1, session2], {
      allEvents: [session1.clockInEvent!, session1.clockOutEvent!, session2.clockOutEvent!],
    });

    render(<PresenceEmployeeRow employee={employee} />, { wrapper: Wrapper });

    // There may be two "Arrivée non enregistrée" texts (session row + parent card badge)
    // The session row one has the planned time; find the one with plannedStart of shift 2
    const allAlertTexts = screen.getAllByText(/Arrivée non enregistrée/);
    const sessionAlert = allAlertTexts.find((el) => el.textContent?.includes("14:00"));
    expect(sessionAlert).toBeDefined();
    expect(sessionAlert!.textContent).toContain("14:00");
    expect(sessionAlert!.textContent).not.toContain("18:00");
  });
});
