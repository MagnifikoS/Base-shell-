import { useCallback } from "react";
import type { StampAsset, Field } from "../utils/types";

const STORAGE_KEY = "signature-studio-state";

interface StoredState {
  assets: StampAsset[];
  fields: Field[];
}

export function useStudioStorage() {
  const saveToStorage = useCallback((assets: StampAsset[], fields: Field[]) => {
    try {
      const state: StoredState = { assets, fields };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      if (import.meta.env.DEV) console.warn("Failed to save to localStorage:", err);
    }
  }, []);

  const loadFromStorage = useCallback((): StoredState | null => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return null;
      return JSON.parse(stored) as StoredState;
    } catch (err) {
      if (import.meta.env.DEV) console.warn("Failed to load from localStorage:", err);
      return null;
    }
  }, []);

  const clearStorage = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return {
    saveToStorage,
    loadFromStorage,
    clearStorage,
  };
}
