/**
 * usePlanningFavorites — V2: Named favorites (max 2 per employee)
 *
 * Storage: localStorage (no new DB table)
 * Key: `planning-favorites-v2-${establishmentId}`
 * Value: Record<userId, NamedFavorite[]> (max 2 per user)
 *
 * Backward compat: migrates old `planning-favorites-${establishmentId}` format on first load.
 */
import { useState, useCallback, useMemo, useEffect } from "react";
import type { PlanningShift } from "../types/planning.types";
import { getWeekDates } from "@/lib/planning-engine/format";

// ── Types ────────────────────────────────────────────────────────────────────

export interface FavoriteShiftTemplate {
  /** Day of week: 0 = Monday, 1 = Tuesday, ..., 6 = Sunday (ISO week order) */
  dayOfWeek: number;
  start_time: string;
  end_time: string;
}

export interface NamedFavorite {
  name: string;
  shifts: FavoriteShiftTemplate[];
  /** ISO timestamp when the favorite was saved */
  savedAt: string;
}

/** Per employee: up to 2 named favorites */
type EmployeeFavorites = NamedFavorite[];

/** Storage map: userId -> EmployeeFavorites */
type FavoritesMapV2 = Record<string, EmployeeFavorites>;

export interface FavoriteMatchResult {
  matches: boolean;
  matchedName?: string;
}

export interface ResolvedShift {
  shiftDate: string;
  startTime: string;
  endTime: string;
}

// ── Legacy types (for migration) ──────────────────────────────────────────────

interface LegacyFavoriteTemplate {
  shifts: FavoriteShiftTemplate[];
  savedAt: string;
}

type LegacyFavoritesMap = Record<string, LegacyFavoriteTemplate>;

// ── Constants ────────────────────────────────────────────────────────────────

export const MAX_FAVORITES_PER_EMPLOYEE = 2;

// ── Storage helpers ──────────────────────────────────────────────────────────

function getV2StorageKey(establishmentId: string): string {
  return `planning-favorites-v2-${establishmentId}`;
}

function getV1StorageKey(establishmentId: string): string {
  return `planning-favorites-${establishmentId}`;
}

function loadFavoritesV2(establishmentId: string): FavoritesMapV2 {
  try {
    const raw = localStorage.getItem(getV2StorageKey(establishmentId));
    if (!raw) return {};
    return JSON.parse(raw) as FavoritesMapV2;
  } catch {
    return {};
  }
}

function persistFavoritesV2(establishmentId: string, favorites: FavoritesMapV2): void {
  try {
    localStorage.setItem(getV2StorageKey(establishmentId), JSON.stringify(favorites));
  } catch {
    // localStorage full or unavailable — silently fail
  }
}

/**
 * Migrate old V1 format (single FavoriteTemplate per userId) to V2 (array of NamedFavorite).
 * Returns the migrated map, or null if no V1 data found.
 */
function migrateV1ToV2(establishmentId: string): FavoritesMapV2 | null {
  try {
    const raw = localStorage.getItem(getV1StorageKey(establishmentId));
    if (!raw) return null;

    const v1Data = JSON.parse(raw) as LegacyFavoritesMap;
    const v2Data: FavoritesMapV2 = {};

    for (const userId of Object.keys(v1Data)) {
      const legacy = v1Data[userId];
      if (legacy?.shifts?.length) {
        v2Data[userId] = [
          {
            name: "Favori",
            shifts: legacy.shifts,
            savedAt: legacy.savedAt,
          },
        ];
      }
    }

    // Persist migrated data to V2 key
    persistFavoritesV2(establishmentId, v2Data);

    // Delete old V1 key
    localStorage.removeItem(getV1StorageKey(establishmentId));

    return v2Data;
  } catch {
    return null;
  }
}

/**
 * Load V2 data, attempting migration from V1 if V2 is empty.
 */
function loadWithMigration(establishmentId: string): FavoritesMapV2 {
  const v2 = loadFavoritesV2(establishmentId);
  if (Object.keys(v2).length > 0) return v2;

  // Attempt migration from V1
  const migrated = migrateV1ToV2(establishmentId);
  return migrated ?? {};
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * Get the ISO day-of-week index (0=Mon, 1=Tue, ..., 6=Sun) from a date string.
 */
export function getIsoDayOfWeek(dateStr: string): number {
  const jsDay = new Date(dateStr + "T00:00:00").getDay(); // 0=Sun
  return jsDay === 0 ? 6 : jsDay - 1; // convert to 0=Mon
}

/**
 * Convert PlanningShift[] to FavoriteShiftTemplate[] (extracting day-of-week pattern).
 */
export function shiftsToTemplates(shifts: PlanningShift[]): FavoriteShiftTemplate[] {
  return shifts.map((shift) => ({
    dayOfWeek: getIsoDayOfWeek(shift.shift_date),
    start_time: shift.start_time,
    end_time: shift.end_time,
  }));
}

/**
 * Compare a set of current shifts against a favorite template.
 * Match is based on: same number of shifts, and for each shift the dayOfWeek + start_time + end_time match.
 */
export function doShiftsMatchTemplate(
  currentShifts: PlanningShift[],
  template: FavoriteShiftTemplate[]
): boolean {
  if (currentShifts.length !== template.length) return false;
  if (currentShifts.length === 0) return false;

  // Sort both by dayOfWeek then start_time for comparison
  const currentSorted = [...currentShifts]
    .map((s) => ({
      dayOfWeek: getIsoDayOfWeek(s.shift_date),
      start_time: s.start_time,
      end_time: s.end_time,
    }))
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.start_time.localeCompare(b.start_time));

  const templateSorted = [...template].sort(
    (a, b) => a.dayOfWeek - b.dayOfWeek || a.start_time.localeCompare(b.start_time)
  );

  return currentSorted.every(
    (curr, i) =>
      curr.dayOfWeek === templateSorted[i].dayOfWeek &&
      curr.start_time === templateSorted[i].start_time &&
      curr.end_time === templateSorted[i].end_time
  );
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function usePlanningFavorites(establishmentId: string | null | undefined) {
  const [favorites, setFavorites] = useState<FavoritesMapV2>(() =>
    establishmentId ? loadWithMigration(establishmentId) : {}
  );

  // Reload when establishment changes
  useEffect(() => {
    if (establishmentId) {
      setFavorites(loadWithMigration(establishmentId));
    } else {
      setFavorites({});
    }
  }, [establishmentId]);

  /** Get all favorites for an employee (0-2 items) */
  const getFavorites = useCallback(
    (userId: string): NamedFavorite[] => {
      return favorites[userId] ?? [];
    },
    [favorites]
  );

  /** Save a new named favorite for an employee. Caller must ensure < 2 exist. */
  const saveFavorite = useCallback(
    (userId: string, name: string, shifts: PlanningShift[], _weekStart: string): void => {
      if (!establishmentId) return;

      const existing = favorites[userId] ?? [];
      if (existing.length >= MAX_FAVORITES_PER_EMPLOYEE) return;

      const templates = shiftsToTemplates(shifts);
      const newFav: NamedFavorite = {
        name,
        shifts: templates,
        savedAt: new Date().toISOString(),
      };

      const updated: FavoritesMapV2 = {
        ...favorites,
        [userId]: [...existing, newFav],
      };

      setFavorites(updated);
      persistFavoritesV2(establishmentId, updated);
    },
    [establishmentId, favorites]
  );

  /** Replace favorite at a specific index (0 or 1) */
  const replaceFavorite = useCallback(
    (
      userId: string,
      index: number,
      name: string,
      shifts: PlanningShift[],
      _weekStart: string
    ): void => {
      if (!establishmentId) return;

      const existing = [...(favorites[userId] ?? [])];
      if (index < 0 || index >= existing.length) return;

      const templates = shiftsToTemplates(shifts);
      existing[index] = {
        name,
        shifts: templates,
        savedAt: new Date().toISOString(),
      };

      const updated: FavoritesMapV2 = {
        ...favorites,
        [userId]: existing,
      };

      setFavorites(updated);
      persistFavoritesV2(establishmentId, updated);
    },
    [establishmentId, favorites]
  );

  /** Delete a favorite at a specific index */
  const deleteFavorite = useCallback(
    (userId: string, index: number): void => {
      if (!establishmentId) return;

      const existing = [...(favorites[userId] ?? [])];
      if (index < 0 || index >= existing.length) return;

      existing.splice(index, 1);

      const updated: FavoritesMapV2 = { ...favorites };
      if (existing.length === 0) {
        delete updated[userId];
      } else {
        updated[userId] = existing;
      }

      setFavorites(updated);
      persistFavoritesV2(establishmentId, updated);
    },
    [establishmentId, favorites]
  );

  /** List of userIds that have at least one favorite */
  const employeesWithFavorites = useMemo(() => {
    return Object.keys(favorites).filter((userId) => (favorites[userId]?.length ?? 0) > 0);
  }, [favorites]);

  /**
   * Check if current week's shifts match any of the employee's saved favorites.
   * Returns { matches: true, matchedName } if a match is found, { matches: false } otherwise.
   */
  const matchesFavorite = useCallback(
    (userId: string, currentShifts: PlanningShift[]): FavoriteMatchResult => {
      const userFavs = favorites[userId];
      if (!userFavs?.length) return { matches: false };

      for (const fav of userFavs) {
        if (doShiftsMatchTemplate(currentShifts, fav.shifts)) {
          return { matches: true, matchedName: fav.name };
        }
      }
      return { matches: false };
    },
    [favorites]
  );

  /**
   * Resolve a favorite template into concrete dates for a given weekStart.
   * Returns array of { shiftDate, startTime, endTime } or null if favorite doesn't exist.
   */
  const resolveFavoriteForWeek = useCallback(
    (userId: string, favoriteIndex: number, weekStart: string): ResolvedShift[] | null => {
      const userFavs = favorites[userId];
      if (!userFavs || favoriteIndex < 0 || favoriteIndex >= userFavs.length) return null;

      const template = userFavs[favoriteIndex];
      if (!template?.shifts?.length) return null;

      const dates = getWeekDates(weekStart);

      return template.shifts.map((t) => ({
        shiftDate: dates[t.dayOfWeek],
        startTime: t.start_time,
        endTime: t.end_time,
      }));
    },
    [favorites]
  );

  return {
    favorites,
    getFavorites,
    saveFavorite,
    replaceFavorite,
    deleteFavorite,
    employeesWithFavorites,
    matchesFavorite,
    resolveFavoriteForWeek,
  };
}
