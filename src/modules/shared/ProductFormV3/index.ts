/**
 * ===============================================================================
 * SHARED — ProductFormV3 (Wizard Modal)
 * ===============================================================================
 *
 * This module breaks the circular dependency between produitsV2 and visionAI.
 *
 * BEFORE: produitsV2 -> visionAI/ProductFormV3 -> produitsV2 (circular)
 * AFTER:  produitsV2 -> shared/ProductFormV3 (no cycle)
 *         visionAI   -> shared/ProductFormV3 (no cycle)
 *
 * The actual implementation lives in visionAI/components/ProductFormV3/.
 * This module re-exports the public API so consumers never import
 * directly from visionAI for the wizard.
 *
 * ===============================================================================
 */

// Re-export the wizard modal and its types from the implementation location.
// Both produitsV2 and visionAI MUST import through this file.
export { ProductFormV3Modal } from "@/modules/visionAI/components/ProductFormV3/ProductFormV3Modal";
export type {
  ProductV3InitialData,
  ProductFormV3ModalProps,
} from "@/modules/visionAI/components/ProductFormV3/types";
export type { WizardMode } from "@/modules/visionAI/components/ProductFormV3/ProductFormV3Modal";
