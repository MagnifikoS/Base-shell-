/**
 * Module-level store for bench import state.
 *
 * Survives React component unmount/remount (page navigation).
 * Uses useSyncExternalStore pattern for React integration.
 */

import type { ImportProgress } from "../types";

export interface ImportStoreState {
  /** True while an import is actively running */
  isImporting: boolean;
  /** Live progress data (updated during import) */
  progress: ImportProgress | null;
  /** Result from the last completed import (persists until next import or dismiss) */
  lastResult: { imported: number; skipped: number; errors: number } | null;
  /** Establishment ID for the current/last import */
  establishmentId: string | null;
}

// ── Module-level singleton state ─────────────────────────────────────────────

let state: ImportStoreState = {
  isImporting: false,
  progress: null,
  lastResult: null,
  establishmentId: null,
};

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Subscribe to state changes (for useSyncExternalStore). */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Get current snapshot (for useSyncExternalStore). */
export function getSnapshot(): ImportStoreState {
  return state;
}

/** Mark import as started. */
export function setImporting(establishmentId: string) {
  state = {
    isImporting: true,
    progress: null,
    lastResult: null,
    establishmentId,
  };
  emit();
}

/** Update progress during import. */
export function setProgress(progress: ImportProgress) {
  state = { ...state, progress };
  emit();
}

/** Mark import as finished with result. */
export function setDone(result: { imported: number; skipped: number; errors: number }) {
  state = {
    ...state,
    isImporting: false,
    lastResult: result,
    progress: state.progress ? { ...state.progress, done: true } : null,
  };
  emit();
}

/** Mark import as failed. */
export function setError(_message: string) {
  state = {
    ...state,
    isImporting: false,
    lastResult: { imported: 0, skipped: 0, errors: -1 },
    progress: null,
  };
  emit();
}

/** Dismiss the last result notification. */
export function dismissResult() {
  state = { ...state, lastResult: null };
  emit();
}
