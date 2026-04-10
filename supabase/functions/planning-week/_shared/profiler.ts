/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Mini-profiler for planning-week Edge Function
 * 
 * STEP 1 — Instrumentation (0 risk)
 * 
 * Measures wall-clock time for each named step within a request.
 * Outputs structured JSON log at the end. Does NOT change response payloads.
 * ═══════════════════════════════════════════════════════════════════════════
 */

interface Timing {
  name: string;
  ms: number;
}

export class RequestProfiler {
  private readonly requestId: string;
  private readonly action: string;
  private readonly start: number;
  private timings: Timing[] = [];
  private openTimers = new Map<string, number>();

  constructor(action: string, requestId?: string) {
    this.action = action;
    this.requestId = requestId || crypto.randomUUID().slice(0, 8);
    this.start = performance.now();
  }

  /** Start a named timer */
  startTimer(name: string): void {
    this.openTimers.set(name, performance.now());
  }

  /** End a named timer and record its duration */
  endTimer(name: string): number {
    const t0 = this.openTimers.get(name);
    if (t0 === undefined) return 0;
    const ms = Math.round((performance.now() - t0) * 100) / 100;
    this.timings.push({ name, ms });
    this.openTimers.delete(name);
    return ms;
  }

  /** Wrap an async operation with timing */
  async time<T>(name: string, fn: () => Promise<T>): Promise<T> {
    this.startTimer(name);
    try {
      return await fn();
    } finally {
      this.endTimer(name);
    }
  }

  /** Wrap multiple parallel operations — each individually timed */
  async timeAll<T extends readonly unknown[]>(
    entries: { [K in keyof T]: { name: string; fn: () => Promise<T[K]> } }
  ): Promise<T> {
    const groupName = entries.map((e: { name: string }) => e.name).join("+");
    this.startTimer(`parallel:${groupName}`);

    const results = await Promise.all(
      entries.map(async (entry: { name: string; fn: () => Promise<unknown> }) => {
        this.startTimer(entry.name);
        try {
          return await entry.fn();
        } finally {
          this.endTimer(entry.name);
        }
      })
    ) as unknown as T;

    this.endTimer(`parallel:${groupName}`);
    return results;
  }

  /** Log summary (call at end of request) */
  flush(): void {
    const totalMs = Math.round((performance.now() - this.start) * 100) / 100;
    const dbMs = this.timings
      .filter(t => !t.name.startsWith("parallel:"))
      .reduce((sum, t) => sum + t.ms, 0);
    const idleMs = Math.round((totalMs - dbMs) * 100) / 100;

    console.log(JSON.stringify({
      _profiler: true,
      requestId: this.requestId,
      action: this.action,
      totalMs,
      dbMs: Math.round(dbMs * 100) / 100,
      idleMs,
      steps: this.timings.length,
      timings: this.timings,
    }));
  }

  get id(): string {
    return this.requestId;
  }
}
