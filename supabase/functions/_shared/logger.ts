/**
 * Structured JSON logging for Edge Functions (OBS-02).
 *
 * Usage:
 *   import { createLogger } from "../_shared/logger.ts";
 *   const log = createLogger("function-name");
 *   log.info("Processing request", { user_id: "abc" });
 *   log.warn("Deprecated action used");
 *   log.error("Insert failed", error, { table: "profiles" });
 */

interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error";
  function_name: string;
  request_id: string;
  user_id?: string;
  message: string;
  error?: string;
  duration_ms?: number;
  [key: string]: unknown;
}

export function createLogger(functionName: string) {
  const requestId = crypto.randomUUID();

  function build(
    level: "info" | "warn" | "error",
    message: string,
    extra?: Record<string, unknown>,
    error?: unknown
  ): string {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      function_name: functionName,
      request_id: requestId,
      message,
    };
    if (error !== undefined) {
      entry.error = error instanceof Error ? error.message : String(error);
    }
    if (extra) {
      for (const [k, v] of Object.entries(extra)) {
        if (!(k in entry)) {
          entry[k] = v;
        }
      }
    }
    return JSON.stringify(entry);
  }

  return {
    requestId,

    info(msg: string, extra?: Record<string, unknown>) {
      console.log(build("info", msg, extra));
    },

    warn(msg: string, extra?: Record<string, unknown>) {
      console.warn(build("warn", msg, extra));
    },

    error(msg: string, err?: unknown, extra?: Record<string, unknown>) {
      console.error(build("error", msg, extra, err));
    },
  };
}
