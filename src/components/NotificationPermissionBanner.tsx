/**
 * Banner that asks the user to enable push notifications.
 * Shows only once per session, only if permission is "default" (never asked).
 * Dismissable — respects user choice.
 */

import { useState } from "react";
import { Bell, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePushNotifications } from "@/hooks/usePushNotifications";

const DISMISSED_KEY = "push_notification_banner_dismissed";

export function NotificationPermissionBanner() {
  const { permission, isSupported, requestPermission } = usePushNotifications();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISSED_KEY) === "1";
    } catch {
      return false;
    }
  });

  // Don't show if: not supported, already granted/denied, or dismissed this session
  if (!isSupported || permission !== "default" || dismissed) {
    return null;
  }

  const handleEnable = async () => {
    await requestPermission();
    handleDismiss();
  };

  const handleDismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // sessionStorage unavailable
    }
  };

  return (
    <div className="bg-primary/10 border border-primary/20 rounded-lg p-3 mx-4 mt-2 flex items-center gap-3">
      <Bell className="h-5 w-5 text-primary flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">Activer les notifications</p>
        <p className="text-xs text-muted-foreground">
          Recevez des alertes pour les pointages, congés et changements de planning.
        </p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <Button size="sm" variant="default" onClick={handleEnable}>
          Activer
        </Button>
        <button
          onClick={handleDismiss}
          className="p-1 rounded-md hover:bg-muted transition-colors"
          aria-label="Fermer"
        >
          <X className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}
