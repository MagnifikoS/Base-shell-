/**
 * Vision AI Bench — Module barrel export.
 *
 * Developer/researcher tool for benchmarking AI extraction models.
 * 100% independent: delete this folder + remove 4 wiring lines to uninstall.
 */

// Auto-capture (used via dynamic import from useVisionAIState)
export { benchAutoCapture } from "./services/benchCaptureService";

// Page (lazy-loaded from AppRoutes)
export { VisionAIBenchPage } from "./pages/VisionAIBenchPage";
