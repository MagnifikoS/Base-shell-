/**
 * Vision AI Module - Entry Point
 * 
 * This module is fully decoupled and can be removed by:
 * 1. Deleting this folder (src/modules/visionAI)
 * 2. Removing the route from App.tsx
 * 3. Removing the sidebar entry from navRegistry.ts
 * 
 * V1/V2 SUPPRIMÉS — V3 est le seul chemin (SSOT products_v2)
 * 
 * @see docs/DO_NOT_TOUCH_VISION_AI_STABLE.md
 * @see docs/snapshots/vision-ai-stable-v10.6/README.md
 */

export { VisionAISettings } from "./components/VisionAISettings";
// ImportDialog SUPPRIMÉ — flux obsolète V1/V2
export { VISION_AI_SAFE_MODE, isVisionAISafeMode } from "./config/safeMode";
export type { MeasurementUnit, PackagingFormat, ExtractedProductLine } from "./types";
