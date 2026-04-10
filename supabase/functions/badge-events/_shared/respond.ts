/**
 * Standard response helpers with dynamic CORS headers
 */

import { makeCorsHeaders } from "../../_shared/cors.ts";

const CORS = makeCorsHeaders("OPTIONS, GET, DELETE, PATCH, POST");

/**
 * Return a successful JSON response with CORS headers
 */
export function jsonOk<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

/**
 * Return an error JSON response with CORS headers
 */
export function jsonErr(
  error: string,
  status = 400,
  code?: string
): Response {
  const body: Record<string, unknown> = { error };
  if (code) body.code = code;
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
