/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PUSH NOTIF — Settings card (minimal, safe UI)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * lockMode=true (employee):
 *   - If already subscribed → show "Activé" read-only, no unsubscribe button
 *   - If not subscribed → show activation button
 *   - Test button hidden
 */

import { useState, useEffect, useCallback } from "react";
import { Bell, BellOff, BellRing, AlertTriangle, Loader2, Send, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PUSH_NOTIF_ENABLED, PUSH_NOTIF_DEBUG } from "@/config/featureFlags";
import {
  isPushSupported,
  getPermissionStatus,
  requestNotificationPermission,
  subscribeToPush,
  unsubscribeFromPush,
  getCurrentSubscription,
} from "../pushNotifClient";
import { saveSubscription, deleteSubscription, sendTestNotification } from "../pushNotifApi";
import { VAPID_PUBLIC_KEY } from "../vapidConfig";
import { useEstablishmentAccess } from "@/hooks/useEstablishmentAccess";
import { toast } from "sonner";

type SubscriptionState = "loading" | "unsupported" | "disabled" | "no-key" | "prompt" | "denied" | "subscribed" | "unsubscribed";

interface PushNotifSettingsCardProps {
  /** When true (employee), hide unsubscribe & test buttons */
  lockMode?: boolean;
}

export function PushNotifSettingsCard({ lockMode = false }: PushNotifSettingsCardProps) {
  const [state, setState] = useState<SubscriptionState>("loading");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSendingTest, setIsSendingTest] = useState(false);
  const { activeEstablishmentId } = useEstablishmentAccess();

  const refreshState = useCallback(async () => {
    if (!PUSH_NOTIF_ENABLED) {
      setState("disabled");
      return;
    }
    if (!isPushSupported()) {
      setState("unsupported");
      return;
    }
    if (!VAPID_PUBLIC_KEY) {
      setState("no-key");
      return;
    }

    const permission = getPermissionStatus();
    if (permission === "denied") {
      setState("denied");
      return;
    }

    const sub = await getCurrentSubscription();
    setState(sub ? "subscribed" : "unsubscribed");
  }, []);

  useEffect(() => {
    refreshState();
  }, [refreshState]);

  const handleSubscribe = async () => {
    setIsProcessing(true);
    try {
      const permission = await requestNotificationPermission();
      if (permission !== "granted") {
        setState("denied");
        toast.error("Permission refusée pour les notifications");
        return;
      }

      const keys = await subscribeToPush(VAPID_PUBLIC_KEY);
      if (!keys) {
        toast.error("Erreur lors de l'inscription aux notifications");
        return;
      }

      await saveSubscription(keys, activeEstablishmentId);
      setState("subscribed");
      toast.success("Notifications activées !");
    } catch (err) {
      console.error("Push subscribe error:", err);
      toast.error("Erreur lors de l'activation des notifications");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUnsubscribe = async () => {
    setIsProcessing(true);
    try {
      const sub = await getCurrentSubscription();
      if (sub) {
        await deleteSubscription(sub.endpoint);
      }
      await unsubscribeFromPush();
      setState("unsubscribed");
      toast.success("Notifications désactivées");
    } catch (err) {
      console.error("Push unsubscribe error:", err);
      toast.error("Erreur lors de la désactivation");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleTestNotification = async () => {
    setIsSendingTest(true);
    try {
      await sendTestNotification({
        title: "🔔 Test notification",
        body: "Les notifications push fonctionnent correctement !",
        url: "/",
      });
      toast.success("Notification de test envoyée");
    } catch (err) {
      console.error("Test notification error:", err);
      toast.error("Erreur lors de l'envoi du test");
    } finally {
      setIsSendingTest(false);
    }
  };

  // In lockMode + subscribed → show read-only "activated" state
  if (lockMode && state === "subscribed") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="h-4 w-4" />
            Notifications push
          </CardTitle>
          <CardDescription>
            Les notifications sont activées sur cet appareil.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
            <ShieldCheck className="h-4 w-4" />
            Notifications activées — vous recevrez les alertes automatiquement.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Bell className="h-4 w-4" />
          Notifications push
        </CardTitle>
        <CardDescription>
          Recevez des notifications sur votre appareil même quand l'app est fermée.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {state === "loading" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Chargement…
          </div>
        )}

        {state === "disabled" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <BellOff className="h-4 w-4" />
            Feature désactivée
          </div>
        )}

        {state === "unsupported" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4" />
            Non supporté par ce navigateur. Ajoutez l'app à l'écran d'accueil et utilisez Chrome ou Safari 16.4+.
          </div>
        )}

        {state === "no-key" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4" />
            Configuration VAPID manquante. Contactez l'administrateur.
          </div>
        )}

        {state === "denied" && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <BellOff className="h-4 w-4" />
            Permission refusée. Réactivez les notifications dans les paramètres de votre navigateur.
          </div>
        )}

        {state === "unsubscribed" && (
          <Button
            onClick={handleSubscribe}
            disabled={isProcessing}
            className="gap-2"
          >
            {isProcessing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <BellRing className="h-4 w-4" />
            )}
            Activer les notifications
          </Button>
        )}

        {state === "subscribed" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
              <BellRing className="h-4 w-4" />
              Notifications activées
            </div>
            {/* lockMode: no unsubscribe or test buttons for employees */}
            {!lockMode && (
              <div className="flex gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleUnsubscribe}
                  disabled={isProcessing}
                  className="gap-1.5"
                >
                  {isProcessing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <BellOff className="h-3.5 w-3.5" />
                  )}
                  Désactiver
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTestNotification}
                  disabled={isSendingTest}
                  className="gap-1.5"
                >
                  {isSendingTest ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                  Test notification
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
