// Types pour le module horaires établissement
// Source de vérité unique pour les horaires

export interface WeeklyHour {
  id?: string;
  day_of_week: number; // 1=lundi ... 7=dimanche
  open_time: string | null;
  close_time: string | null;
  closed: boolean;
}

export interface OpeningException {
  id: string;
  date: string; // YYYY-MM-DD
  open_time: string | null;
  close_time: string | null;
  closed: boolean;
  reason?: string;
}

export interface DayPart {
  id?: string;
  part: "morning" | "midday" | "evening";
  start_time: string;
  end_time: string;
  color: string;
}

export const DAY_PART_LABELS: Record<string, string> = {
  morning: "Matin",
  midday: "Coupure",
  evening: "Soir",
};

// Palette pro/luxe sobre (non flashy) - ne jamais réutiliser pour départements
export const DAY_PART_COLORS = [
  "#0F172A", // Slate 900 - premium dark
  "#1E293B", // Slate 800
  "#334155", // Slate 700
  "#475569", // Slate 600
  "#1F2937", // Gray 800
  "#374151", // Gray 700
  "#4B5563", // Gray 600
  "#111827", // Gray 900 - near black
  "#18181B", // Zinc 900
  "#27272A", // Zinc 800
];

export const DEFAULT_DAY_PARTS: DayPart[] = [
  { part: "morning", start_time: "06:00", end_time: "12:00", color: "#0F172A" },
  { part: "midday", start_time: "12:00", end_time: "14:00", color: "#334155" },
  { part: "evening", start_time: "14:00", end_time: "22:00", color: "#111827" },
];

// Format simplifié pour le planning (lecture seule, pas de logique cachée)
export interface DayPartsNormalized {
  morning: { start: string; end: string; color: string } | null;
  midday: { start: string; end: string; color: string } | null;
  evening: { start: string; end: string; color: string } | null;
}

export function normalizeDayParts(parts: DayPart[]): DayPartsNormalized {
  const result: DayPartsNormalized = { morning: null, midday: null, evening: null };
  for (const p of parts) {
    if (p.part === "morning" || p.part === "midday" || p.part === "evening") {
      result[p.part] = { start: p.start_time, end: p.end_time, color: p.color };
    }
  }
  return result;
}

export interface DayHours {
  open: string | null;
  close: string | null;
  closed: boolean;
}

export interface NormalizedHours {
  timezone: string;
  openingHoursByDate: Record<string, DayHours>;
}

export const DAY_LABELS: Record<number, string> = {
  1: "Lundi",
  2: "Mardi",
  3: "Mercredi",
  4: "Jeudi",
  5: "Vendredi",
  6: "Samedi",
  7: "Dimanche",
};

export const DEFAULT_WEEKLY_HOURS: WeeklyHour[] = [
  { day_of_week: 1, open_time: "09:00", close_time: "18:00", closed: false },
  { day_of_week: 2, open_time: "09:00", close_time: "18:00", closed: false },
  { day_of_week: 3, open_time: "09:00", close_time: "18:00", closed: false },
  { day_of_week: 4, open_time: "09:00", close_time: "18:00", closed: false },
  { day_of_week: 5, open_time: "09:00", close_time: "18:00", closed: false },
  { day_of_week: 6, open_time: null, close_time: null, closed: true },
  { day_of_week: 7, open_time: null, close_time: null, closed: true },
];
