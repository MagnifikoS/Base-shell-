/**
 * Hook for amount visibility toggle with auto-reset
 * Amounts are hidden by default and reset when the user leaves the page/tab.
 */

import { useState, useEffect, useCallback } from "react";

export function useAmountVisibility() {
  const [visible, setVisible] = useState(false);

  const toggle = useCallback(() => setVisible((v) => !v), []);

  // Auto-reset on tab/app switch
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) setVisible(false);
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  return { visible, toggle };
}
