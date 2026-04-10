/**
 * Safe JSON body parsing for edge functions
 */

export interface ParsedBody<T> {
  data: T | null;
  error: string | null;
}

/**
 * Safely parse JSON body from request
 * Returns { data, error } - never throws
 */
export async function parseJsonSafe<T = Record<string, unknown>>(
  req: Request
): Promise<ParsedBody<T>> {
  try {
    const text = await req.text();
    if (!text || text.trim() === "") {
      return { data: null, error: "Empty body" };
    }
    const data = JSON.parse(text) as T;
    return { data, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Invalid JSON";
    return { data: null, error: message };
  }
}
