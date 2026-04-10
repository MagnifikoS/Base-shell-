import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * Shared authentication middleware for Edge Functions.
 *
 * Usage:
 *   const { user, supabase } = await requireAuth(req);
 *
 * Throws AuthError (with .status) if auth fails.
 * Returns the authenticated user and a Supabase client scoped to that user's JWT.
 */
export async function requireAuth(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    throw new AuthError("Missing authorization", 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    throw new AuthError("Unauthorized", 401);
  }

  return { user, supabase };
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
