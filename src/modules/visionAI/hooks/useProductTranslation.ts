import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

interface TranslationResult {
  detected_lang: string;
  translation: string | null;
  original: string;
}

interface TranslationState {
  isLoading: boolean;
  detectedLang: string | null;
  translation: string | null;
  error: string | null;
}

/**
 * Hook for post-extraction product name translation
 *
 * RULES:
 * - Triggered AFTER extraction, UI-side only
 * - Does NOT impact Vision AI performance
 * - Non-blocking: failures are silent
 * - Translation is informational, never SSOT
 *
 * @param productName - The original product name (SOURCE OF TRUTH)
 * @param enabled - Whether to trigger translation (default: true)
 */
export function useProductTranslation(productName: string | null, enabled = true) {
  const [state, setState] = useState<TranslationState>({
    isLoading: false,
    detectedLang: null,
    translation: null,
    error: null,
  });

  // Editable translation value (user can modify)
  const [editedTranslation, setEditedTranslation] = useState<string | null>(null);

  const translate = useCallback(async (name: string) => {
    if (!name.trim()) return;

    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const { data, error } = await supabase.functions.invoke<TranslationResult>(
        "translate-product-name",
        { body: { product_name: name } }
      );

      if (error) {
        if (import.meta.env.DEV) console.error("Translation invoke error:", error);
        setState((prev) => ({
          ...prev,
          isLoading: false,
          detectedLang: null,
          translation: null,
          error: "Translation failed",
        }));
        return;
      }

      setState({
        isLoading: false,
        detectedLang: data?.detected_lang || null,
        translation: data?.translation || null,
        error: null,
      });

      // Pre-fill editable translation
      if (data?.translation) {
        setEditedTranslation(data.translation);
      }
    } catch (err) {
      if (import.meta.env.DEV) console.error("Translation error:", err);
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: "Translation failed",
      }));
    }
  }, []);

  // Trigger translation when productName changes
  // CRITICAL: Reset state IMMEDIATELY when productName changes to prevent stale data
  useEffect(() => {
    // Always reset state first - prevents showing previous product's translation
    setState({
      isLoading: false,
      detectedLang: null,
      translation: null,
      error: null,
    });
    setEditedTranslation(null);

    if (!enabled || !productName) {
      return;
    }

    // Then trigger new translation
    translate(productName);
  }, [productName, enabled, translate]);

  // Check if translation should be shown (non-French detected)
  const shouldShowTranslation =
    state.detectedLang !== null && state.detectedLang !== "fr" && state.detectedLang !== "unknown";

  return {
    isLoading: state.isLoading,
    detectedLang: state.detectedLang,
    translation: state.translation,
    editedTranslation,
    setEditedTranslation,
    shouldShowTranslation,
    error: state.error,
    retry: () => productName && translate(productName),
  };
}
