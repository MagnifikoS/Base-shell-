/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE BRAIN — Events Service (brain_events read/write)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Extracted from theBrainService.ts for file size compliance.
 * Handles: logEvent, brainSafeLog, getHealthSummary, getSubjectsSummary, getRecentEvents
 */

import { THE_BRAIN_DISABLED } from "../constants";
import { brainDb } from "./brainDb";
import type {
  BrainEvent,
  LogEventParams,
  HealthSummary,
  SubjectSummary,
  DateRange,
} from "../types";

/**
 * Calcule la date de début selon la plage
 */
function getStartDate(range: DateRange): string {
  const now = new Date();
  const days = range === "7d" ? 7 : 30;
  now.setDate(now.getDate() - days);
  return now.toISOString();
}

/**
 * Log un événement dans brain_events (append-only)
 */
export async function logEvent(
  params: LogEventParams
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await brainDb.from("brain_events").insert([
      {
        establishment_id: params.establishmentId,
        subject: params.subject,
        action: params.action,
        context: params.context ?? {},
        actor_user_id: params.actorUserId ?? null,
      },
    ]);

    if (error) {
      if (import.meta.env.DEV) console.error("[THE BRAIN] logEvent error:", error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    if (import.meta.env.DEV) console.error("[THE BRAIN] logEvent exception:", err);
    return { success: false, error: String(err) };
  }
}

/**
 * Helper sécurisé : ne casse jamais l'app, silencieux en cas d'erreur
 */
export function brainSafeLog(params: LogEventParams): void {
  // Si désactivé, on ne fait rien
  if (THE_BRAIN_DISABLED) return;

  // Fire and forget, pas de await
  logEvent(params).catch(() => {
    // Silencieux - ne jamais throw
  });
}

/**
 * Récupère le résumé de santé globale
 */
export async function getHealthSummary(
  establishmentId: string,
  range: DateRange
): Promise<HealthSummary> {
  const startDate = getStartDate(range);

  const { data: events, error } = await brainDb
    .from("brain_events")
    .select("subject, action")
    .eq("establishment_id", establishmentId)
    .gte("created_at", startDate);

  if (error || !events) {
    if (import.meta.env.DEV) console.error("[THE BRAIN] getHealthSummary error:", error);
    return {
      totalEvents: 0,
      activeSubjects: 0,
      acceptanceRate: 0,
      topSubjects: [],
    };
  }

  // BrainEventRow already has subject and action as string
  const typedEvents = events;

  // Calculs simples
  const totalEvents = typedEvents.length;
  const subjectsSet = new Set(typedEvents.map((e) => e.subject));
  const activeSubjects = subjectsSet.size;

  const confirmedCount = typedEvents.filter((e) => e.action === "confirmed").length;
  const correctedCount = typedEvents.filter((e) => e.action === "corrected").length;
  const denominator = confirmedCount + correctedCount;
  const acceptanceRate = denominator > 0 ? confirmedCount / denominator : 0;

  // Top 5 sujets par volume
  const subjectCounts: Record<string, { total: number; confirmed: number; corrected: number }> = {};
  for (const event of typedEvents) {
    if (!subjectCounts[event.subject]) {
      subjectCounts[event.subject] = { total: 0, confirmed: 0, corrected: 0 };
    }
    subjectCounts[event.subject].total++;
    if (event.action === "confirmed") subjectCounts[event.subject].confirmed++;
    if (event.action === "corrected") subjectCounts[event.subject].corrected++;
  }

  const topSubjects: SubjectSummary[] = Object.entries(subjectCounts)
    .map(([subject, counts]) => {
      const denom = counts.confirmed + counts.corrected;
      return {
        subject,
        eventCount: counts.total,
        confirmedCount: counts.confirmed,
        correctedCount: counts.corrected,
        acceptanceRate: denom > 0 ? counts.confirmed / denom : 0,
      };
    })
    .sort((a, b) => b.eventCount - a.eventCount)
    .slice(0, 5);

  return {
    totalEvents,
    activeSubjects,
    acceptanceRate,
    topSubjects,
  };
}

/**
 * Récupère le résumé par sujet
 */
export async function getSubjectsSummary(
  establishmentId: string,
  range: DateRange
): Promise<SubjectSummary[]> {
  const startDate = getStartDate(range);

  const { data: events, error } = await brainDb
    .from("brain_events")
    .select("subject, action")
    .eq("establishment_id", establishmentId)
    .gte("created_at", startDate);

  if (error || !events) {
    if (import.meta.env.DEV) console.error("[THE BRAIN] getSubjectsSummary error:", error);
    return [];
  }

  // BrainEventRow already has subject and action as string
  const typedEvents = events;

  // Agrégation par sujet
  const subjectCounts: Record<string, { total: number; confirmed: number; corrected: number }> = {};
  for (const event of typedEvents) {
    if (!subjectCounts[event.subject]) {
      subjectCounts[event.subject] = { total: 0, confirmed: 0, corrected: 0 };
    }
    subjectCounts[event.subject].total++;
    if (event.action === "confirmed") subjectCounts[event.subject].confirmed++;
    if (event.action === "corrected") subjectCounts[event.subject].corrected++;
  }

  return Object.entries(subjectCounts)
    .map(([subject, counts]) => {
      const denom = counts.confirmed + counts.corrected;
      return {
        subject,
        eventCount: counts.total,
        confirmedCount: counts.confirmed,
        correctedCount: counts.corrected,
        acceptanceRate: denom > 0 ? counts.confirmed / denom : 0,
      };
    })
    .sort((a, b) => b.eventCount - a.eventCount);
}

/**
 * Récupère les événements récents
 */
export async function getRecentEvents(
  establishmentId: string,
  limit: number = 50
): Promise<BrainEvent[]> {
  const { data, error } = await brainDb
    .from("brain_events")
    .select("id, establishment_id, subject, action, context, actor_user_id, created_at")
    .eq("establishment_id", establishmentId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (import.meta.env.DEV) console.error("[THE BRAIN] getRecentEvents error:", error);
    return [];
  }

  return (data ?? []) as unknown as BrainEvent[];
}
