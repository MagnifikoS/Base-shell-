/**
 * Security test helpers for Restaurant OS
 *
 * Edge functions are tested via HTTP fetch to Supabase URL.
 * Frontend components tested via Testing Library.
 * Pure logic tested via direct import.
 */

// Edge function caller (authenticated)
export async function callEdgeFunction(
  functionName: string,
  options: {
    method?: string;
    body?: unknown;
    token?: string;
    headers?: Record<string, string>;
  } = {}
): Promise<Response> {
  const url = `${process.env.VITE_SUPABASE_URL}/functions/v1/${functionName}`;
  return fetch(url, {
    method: options.method ?? "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
}

// Edge function caller (unauthenticated)
export async function callEdgeFunctionNoAuth(
  functionName: string,
  body?: unknown
): Promise<Response> {
  return callEdgeFunction(functionName, { body });
}

// Login and get token
export async function getAuthToken(email: string, password: string): Promise<string> {
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY!
  );
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session.access_token;
}

/**
 * Read a file's content as string (for static analysis tests)
 */
export async function readSourceFile(relativePath: string): Promise<string> {
  const fs = await import("fs");
  const path = await import("path");
  const fullPath = path.resolve(process.cwd(), relativePath);
  return fs.readFileSync(fullPath, "utf-8");
}

/**
 * Search for a pattern in a file (returns all matches)
 */
export function findInSource(content: string, pattern: RegExp): RegExpMatchArray[] {
  const matches: RegExpMatchArray[] = [];
  let match: RegExpMatchArray | null;
  const regex = new RegExp(
    pattern.source,
    pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g"
  );
  while ((match = regex.exec(content)) !== null) {
    matches.push(match);
  }
  return matches;
}

/**
 * Glob source files (for scanning codebase)
 */
export async function globSourceFiles(pattern: string): Promise<string[]> {
  const { glob } = await import("glob");
  return glob(pattern, { cwd: process.cwd() });
}
