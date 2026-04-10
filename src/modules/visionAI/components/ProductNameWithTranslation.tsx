/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PRODUCT NAME WITH TRANSLATION TOOLTIP
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Displays product name with a hover tooltip showing French translation
 * if the product name is detected as non-French.
 *
 * Uses the translate-product-name edge function on hover (with caching).
 */

import { useState, useCallback, useRef } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Globe, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface ProductNameWithTranslationProps {
  name: string;
  className?: string;
}

// Simple in-memory cache for translations
const translationCache = new Map<
  string,
  {
    translation: string | null;
    sourceLanguage: string | null;
    isFrench: boolean;
  }
>();

export function ProductNameWithTranslation({ name, className }: ProductNameWithTranslationProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [translation, setTranslation] = useState<string | null>(null);
  const [sourceLanguage, setSourceLanguage] = useState<string | null>(null);
  const [isFrench, setIsFrench] = useState<boolean | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const fetchingRef = useRef(false);

  const fetchTranslation = useCallback(async () => {
    // Skip if already fetched or currently fetching
    if (hasFetched || fetchingRef.current) return;

    // Check cache first
    const cached = translationCache.get(name);
    if (cached) {
      setTranslation(cached.translation);
      setSourceLanguage(cached.sourceLanguage);
      setIsFrench(cached.isFrench);
      setHasFetched(true);
      return;
    }

    fetchingRef.current = true;
    setIsLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke("translate-product-name", {
        body: { product_name: name },
      });

      if (error) {
        if (import.meta.env.DEV) console.error("Translation error:", error);
        setIsFrench(true); // Assume French on error
      } else if (data) {
        const result = {
          translation: data.translation || null,
          sourceLanguage: data.detected_lang || null,
          isFrench: data.detected_lang === "fr" || !data.translation,
        };

        // Cache the result
        translationCache.set(name, result);

        setTranslation(result.translation);
        setSourceLanguage(result.sourceLanguage);
        setIsFrench(result.isFrench);
      }
    } catch (err) {
      if (import.meta.env.DEV) console.error("Translation fetch failed:", err);
      setIsFrench(true);
    } finally {
      setIsLoading(false);
      setHasFetched(true);
      fetchingRef.current = false;
    }
  }, [name, hasFetched]);

  // Language display names
  const getLanguageName = (code: string | null): string => {
    if (!code) return "Inconnu";
    const names: Record<string, string> = {
      en: "Anglais",
      it: "Italien",
      es: "Espagnol",
      de: "Allemand",
      pt: "Portugais",
      nl: "Néerlandais",
      pl: "Polonais",
      ar: "Arabe",
      zh: "Chinois",
      ja: "Japonais",
      ko: "Coréen",
    };
    return names[code] || code.toUpperCase();
  };

  return (
    <TooltipProvider>
      <Tooltip delayDuration={400}>
        <TooltipTrigger asChild>
          <span className={`cursor-help ${className || ""}`} onMouseEnter={fetchTranslation}>
            {name}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs p-3">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Détection de la langue...</span>
            </div>
          ) : isFrench ? (
            <div className="text-sm text-muted-foreground">🇫🇷 Produit en français</div>
          ) : translation ? (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Globe className="h-3 w-3" />
                <span>Langue détectée : {getLanguageName(sourceLanguage)}</span>
              </div>
              <div className="text-sm font-medium">🇫🇷 {translation}</div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">Survolez pour voir la traduction</div>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
