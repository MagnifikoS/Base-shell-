/**
 * Planning format helpers
 * Fonctions pures, pas de logique métier
 * V3.3: Uses Paris timezone source
 */

import { formatParisDayShort, formatParisDayNumber, formatParisLocale } from "@/lib/time/paris";

/**
 * Formate une date en "YYYY-MM-DD" en heure LOCALE (évite décalage UTC)
 * UTILISER PARTOUT pour shift_date, week_start, comparaisons
 */
export function formatDateLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Convertit des minutes en format "XXhYY" (ex: 450 -> "7h30")
 */
export function formatMinutesToHours(minutes: number): string {
  if (minutes <= 0) return "0h00";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h${m.toString().padStart(2, "0")}`;
}

/**
 * Formate une heure HH:mm
 */
export function formatTime(time: string): string {
  return time.substring(0, 5);
}

/**
 * Calcule la différence en minutes entre deux heures HH:mm
 */
export function timeDiffMinutes(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}

/**
 * Génère les dates de la semaine à partir du lundi (format YYYY-MM-DD LOCAL)
 */
export function getWeekDates(weekStart: string): string[] {
  const dates: string[] = [];
  const start = new Date(weekStart + "T00:00:00");
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    dates.push(formatDateLocal(d));
  }
  return dates;
}

/**
 * Formate une date en nom de jour court (Lun, Mar, etc.) - Paris timezone
 * V3.3: Uses central paris.ts helper
 */
export function formatDayShort(date: string): string {
  return formatParisDayShort(date);
}

/**
 * Formate une date en jour du mois (1, 2, 3...) - Paris timezone
 * V3.3: Uses central paris.ts helper
 */
export function formatDayNumber(date: string): string {
  return formatParisDayNumber(date);
}

/**
 * Formate une date complète pour affichage (ex: "Lun 15") - Paris timezone
 * V3.3: Uses central paris.ts helper
 */
export function formatDayFull(date: string): string {
  const day = formatParisDayShort(date);
  const num = formatParisDayNumber(date);
  return `${day} ${num}`;
}

/**
 * Retourne le lundi de la semaine pour une date donnée (format YYYY-MM-DD LOCAL)
 */
export function getMonday(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return formatDateLocal(d);
}

/**
 * Génère une liste de semaines (lundis) autour de la date actuelle
 * V3.3: Uses Paris timezone for labels
 */
export function generateWeekOptions(weeksBack: number = 52, weeksForward: number = 52): Array<{ value: string; label: string }> {
  const now = new Date();
  const currentMonday = getMonday(now);
  const options: Array<{ value: string; label: string }> = [];
  
  const startDate = new Date(currentMonday + "T00:00:00");
  startDate.setDate(startDate.getDate() - (weeksBack * 7));
  
  for (let i = 0; i < weeksBack + weeksForward + 1; i++) {
    const monday = new Date(startDate);
    monday.setDate(monday.getDate() + (i * 7));
    const sunday = new Date(monday);
    sunday.setDate(sunday.getDate() + 6);
    
    const value = formatDateLocal(monday);
    const mondayLabel = formatParisLocale(monday, { day: "numeric", month: "short" });
    const sundayLabel = formatParisLocale(sunday, { day: "numeric", month: "short", year: "numeric" });
    const label = `${mondayLabel} - ${sundayLabel}`;
    
    options.push({ value, label });
  }
  
  return options;
}
