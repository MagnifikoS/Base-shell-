/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PUSH NOTIF — Auto-prompt banner for employees to enable push notifications
 * 
 * Shows once per session if push is supported but not subscribed.
 * Dismissed state is stored in localStorage so it doesn't nag on every page.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useState, useEffect, useCallback } from "react";
import { BellRing, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PUSH_NOTIF_ENABLED } from "@/config/featureFlags";
import {
  isPushSupported,
  getPermissionStatus,
  requestNotificationPermission,
  subscribeToPush,
  getCurrentSubscription,
} from "../pushNotifClient";
import { saveSubscription } from "../pushNotifApi";
import { VAPID_PUBLIC_KEY } from "../vapidConfig";
import { useEstablishmentAccess } from "@/hooks/useEstablishmentAccess";
import { toast } from "sonner";

const DISMISS_KEY = "push-prompt-dismissed";
const DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

type BannerState = "hidden" | "visible" | "processing";

export function PushPromptBanner() {
  const [state, setState] = useState<BannerState>("hidden");
  const { activeEstablishmentId } = useEstablishmentAccess();

  const checkShouldShow = useCallback(async () => {
    // Feature gate
    if (!PUSH_NOTIF_ENABLED || !VAPID_PUBLIC_KEY) return;
    if (!isPushSupported()) return;

    // Already dismissed recently?
    const dismissedAt = localStorage.getItem(DISMISS_KEY);
    if (dismissedAt && Date.now() - Number(dismissedAt) < DISMISS_DURATION_MS) return;

    // Permission denied — can't ask again
    const permission = getPermissionStatus();
    if (permission === "denied") return;

    // Already subscribed?
    const sub = await getCurrentSubscription();
    if (sub) return;

    // Show the banner
    setState("visible");
  }, []);

  useEffect(() => {
    // Small delay to avoid showing immediately on page load
    const timer = setTimeout(checkShouldShow, 2000);
    return () => clearTimeout(timer);
  }, [checkShouldShow]);

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setState("hidden");
  };

  const handleEnable = async () => {
    setState("processing");
    try {
      const permission = await requestNotificationPermission();
      if (permission !== "granted") {
        toast.error("Permission refusée. Activez les notifications dans les paramètres de votre navigateur.");
        handleDismiss();
        return;
      }

      const keys = await subscribeToPush(VAPID_PUBLIC_KEY);
      if (!keys) {
        toast.error("Erreur lors de l'inscription aux notifications");
        setState("visible");
        return;
      }

      await saveSubscription(keys, activeEstablishmentId);
      toast.success("🔔 Notifications activées !");
      setState("hidden");
    } catch (err) {
      console.error("Push prompt subscribe error:", err);
      toast.error("Erreur lors de l'activation des notifications");
      setState("visible");
    }
  };

  if (state === "hidden") return null;

  return (
    <div className="mx-3 mt-2 mb-1 rounded-lg border border-primary/20 bg-primary/5 p-3 flex items-start gap-3 animate-in slide-in-from-top-2 duration-300">
      <BellRing className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">
          Activez les notifications
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Recevez une alerte quand vous oubliez de badger votre arrivée.
        </p>
        <Button
          size="sm"
          className="mt-2 gap-1.5"
          onClick={handleEnable}
          disabled={state === "processing"}
        >
          {state === "processing" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <BellRing className="h-3.5 w-3.5" />
          )}
          Activer
        </Button>
      </div>
      <button
        onClick={handleDismiss}
        className="text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Fermer"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
