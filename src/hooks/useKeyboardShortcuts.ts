import { useEffect } from "react";

/**
 * Returns true if the active element is an input, textarea, or contenteditable.
 * In these cases, single-key shortcuts (like "?") should be suppressed
 * to avoid interfering with typing.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (target.isContentEditable) return true;
  // cmdk input is also a typing target
  if (target.getAttribute("cmdk-input") !== null) return true;
  return false;
}

interface UseKeyboardShortcutsOptions {
  /** Callback to toggle the command palette open/close */
  onToggleCommandPalette: () => void;
  /** Callback to show keyboard shortcuts help */
  onShowShortcutsHelp: () => void;
}

/**
 * Registers global keyboard shortcuts for the application.
 *
 * Shortcuts:
 * - Cmd+K / Ctrl+K: Open command palette (also handled inside CommandPalette)
 * - ?: Show keyboard shortcuts help (only when not typing in an input)
 *
 * Mounts event listeners on document and cleans up on unmount.
 */
export function useKeyboardShortcuts({
  onToggleCommandPalette,
  onShowShortcutsHelp,
}: UseKeyboardShortcutsOptions): void {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Cmd+K / Ctrl+K — toggle command palette
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onToggleCommandPalette();
        return;
      }

      // "?" — show shortcuts help (only when not typing)
      if (e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (!isTypingTarget(e.target)) {
          e.preventDefault();
          onShowShortcutsHelp();
          return;
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onToggleCommandPalette, onShowShortcutsHelp]);
}
