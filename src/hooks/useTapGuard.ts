/**
 * useTapGuard — Distinguishes a tap from a scroll on touch devices.
 * Returns touch handlers + a guard function to wrap onClick.
 * If the finger moved > threshold px between touchstart and touchend, the click is suppressed.
 */

import { useRef, useCallback } from "react";

const MOVE_THRESHOLD = 20; // px — raised to avoid false taps while scrolling

export function useTapGuard() {
  const startY = useRef(0);
  const moved = useRef(false);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    startY.current = e.touches[0].clientY;
    moved.current = false;
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (Math.abs(e.touches[0].clientY - startY.current) > MOVE_THRESHOLD) {
      moved.current = true;
    }
  }, []);

  const guardedClick = useCallback((handler: () => void) => {
    return () => {
      if (!moved.current) {
        handler();
      }
    };
  }, []);

  return { onTouchStart, onTouchMove, guardedClick };
}
