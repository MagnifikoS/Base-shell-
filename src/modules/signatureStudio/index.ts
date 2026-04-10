/**
 * Signature Studio Module - Isolated Prototype (Phase 0)
 * 
 * This module is 100% isolated from the rest of the application:
 * - No database writes
 * - No edge functions
 * - No imports from business modules
 * - Local state only (with optional localStorage persistence)
 * 
 * To remove this module:
 * 1. Delete this entire folder (src/modules/signatureStudio/)
 * 2. Remove the route from App.tsx
 * 3. Remove the sidebar entry from AppSidebar.tsx
 * 4. Remove the mobile entry from MobileHome.tsx
 */

export { SignatureStudioPage } from './SignatureStudioPage';
// SIGNATURE_STUDIO_ENABLED re-export removed (PH3-Short) — 0 external consumers.
// SSOT: import directly from @/config/featureFlags.
