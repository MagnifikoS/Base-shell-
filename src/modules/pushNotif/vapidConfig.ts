/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PUSH NOTIF — VAPID Configuration
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The VAPID public key is PUBLISHABLE (safe to include in client code).
 * It must match the VAPID_PUBLIC_KEY secret stored for the edge function.
 *
 * To update: replace the value below with your VAPID public key.
 * Generate keys at: https://vapidkeys.com/
 * ═══════════════════════════════════════════════════════════════════════════
 */

// VAPID public key (base64url-encoded) — safe for client-side use
export const VAPID_PUBLIC_KEY = "BMMlIUSnCPhimOyCYmyRtafOrR9kz0d_cI-mSfpGHtrP1ggrBk43lfcMYKVEAnYVf557HEDN3O87wCQyXuetGzM";
