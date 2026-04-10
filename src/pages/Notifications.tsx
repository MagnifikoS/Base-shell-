/**
 * Notifications Page — SSOT: shows only DB notification_events
 *
 * V2.8 LEGACY CLEANUP:
 *   - Single source = notification_events table (SSOT)
 *   - Legacy events (pre-v2.4) get a "Legacy" badge + safe rendering
 *   - Modern events show wave/role info
 *   - "Hide legacy" toggle stored in localStorage
 *   - Null-safe rendering throughout
 */

import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Bell, Clock, LogIn, LogOut, AlertTriangle, CheckCircle, User, Play, BellOff, Bug, Archive, Package, Truck, PackageCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { ResponsiveLayout } from "@/components/mobile/ResponsiveLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useNotificationEvents, type NotificationEvent, isLegacyEvent, hasUnresolvedTemplateVars } from "@/hooks/useNotificationEvents";
import { useEstablishmentAccess } from "@/hooks/useEstablishmentAccess";
import { formatParisDayShort } from "@/lib/time/paris";
import { NOTIF_ENGINE_DEBUG } from "@/config/featureFlags";
import { usePermissions } from "@/hooks/usePermissions";
import { toast } from "sonner";

const HIDE_LEGACY_KEY = "notif-hide-legacy";

export default function Notifications() {
  const { activeEstablishmentId: establishmentId } = useEstablishmentAccess();
  const queryClient = useQueryClient();
  const { isAdmin } = usePermissions();
  const [dryRunResult, setDryRunResult] = useState<Record<string, unknown> | null>(null);
  const [hideLegacy, setHideLegacy] = useState(() => {
    try { return localStorage.getItem(HIDE_LEGACY_KEY) === "true"; } catch { return false; }
  });

  const { data: notifEvents = [], isLoading, error } = useNotificationEvents();

  // HOTFIX: Show ALL events regardless of push delivery status (no_subscription, sent, etc.)
  // The notification center must always reflect DB events — push delivery is a transport concern, not a visibility concern.
  const validEvents = notifEvents.filter((e) => {
    const payload = e.payload;
    if (!payload) return false;
    if (!payload.body || payload.body === "" || payload.body === "[Notification]") return false;
    return true;
  });

  // Apply hide-legacy filter
  const displayEvents = hideLegacy
    ? validEvents.filter((e) => !isLegacyEvent(e))
    : validEvents;

  const legacyCount = validEvents.filter((e) => isLegacyEvent(e)).length;

  const handleToggleHideLegacy = useCallback(() => {
    setHideLegacy((prev) => {
      const next = !prev;
      try { localStorage.setItem(HIDE_LEGACY_KEY, String(next)); } catch { /* noop */ }
      return next;
    });
  }, []);

  const handleMarkRead = useCallback(async (eventId: string) => {
    await supabase
      .from("notification_events")
      .update({ read_at: new Date().toISOString() } as Record<string, unknown>)
      .eq("id", eventId);
    queryClient.invalidateQueries({ queryKey: ["notification-events"] });
    queryClient.invalidateQueries({ queryKey: ["notification-events-count"] });
  }, [queryClient]);

  const unreadCount = validEvents.filter((e) => !e.read_at).length;

  const today = validEvents.length > 0
    ? new Date(validEvents[0].sent_at).toISOString().slice(0, 10)
    : "";

  // Admin: run notif-check now (real)
  const handleRunNotifCheck = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke("notif-check-badgeuse", {
        body: {},
      });
      if (error) throw error;
      toast.success(`NotifCheck terminé: ${JSON.stringify(data)}`);
      queryClient.invalidateQueries({ queryKey: ["notification-events"] });
    } catch (err) {
      toast.error(`Erreur: ${(err as Error).message}`);
    }
  }, [queryClient]);

  // Admin: dry-run diagnostic
  const handleDryRun = useCallback(async () => {
    try {
      setDryRunResult(null);
      const { data, error } = await supabase.functions.invoke("notif-check-badgeuse", {
        body: { dryRun: true },
      });
      if (error) throw error;
      setDryRunResult(data as Record<string, unknown>);
      toast.success("Dry-run terminé — voir détails ci-dessous");
    } catch (err) {
      toast.error(`Erreur dry-run: ${(err as Error).message}`);
    }
  }, []);

  // Count no_subscription events for warning
  const noSubCount = validEvents.filter((e) => e.payload?.no_subscription).length;

  return (
    <ResponsiveLayout>
      <div className="container mx-auto p-4 max-w-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Bell className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Notifications</h1>
            {today && <p className="text-sm text-muted-foreground">{formatParisDayShort(today)}</p>}
          </div>
          {unreadCount > 0 && (
            <Badge variant="destructive" className="ml-auto">
              {unreadCount}
            </Badge>
          )}
        </div>

        {/* Admin: hide legacy toggle */}
        {isAdmin && legacyCount > 0 && (
          <div className="flex items-center justify-between mb-4 px-1">
            <span className="text-xs text-muted-foreground">
              {legacyCount} notification(s) legacy
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleToggleHideLegacy}
              className="gap-1.5 text-xs"
            >
              <Archive className="h-3.5 w-3.5" />
              {hideLegacy ? "Afficher les legacy" : "Masquer les legacy"}
            </Button>
          </div>
        )}

        {/* Debug: Admin tools */}
        {NOTIF_ENGINE_DEBUG && isAdmin && (
          <Card className="mb-4 border-blue-500/50 bg-blue-50 dark:bg-blue-950/30">
            <CardContent className="p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-blue-800 dark:text-blue-200">
                  🔧 Debug NotifEngine V2.8
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={handleDryRun} className="gap-1.5">
                    <Bug className="h-3.5 w-3.5" />
                    Dry Run
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleRunNotifCheck} className="gap-1.5">
                    <Play className="h-3.5 w-3.5" />
                    Run now
                  </Button>
                </div>
              </div>
              {establishmentId && (
                <p className="text-xs text-blue-600 dark:text-blue-300">
                  Établissement actif : <code className="bg-blue-100 dark:bg-blue-900/50 px-1 rounded">{establishmentId.slice(0, 8)}…</code>
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Dry-run results */}
        {dryRunResult && NOTIF_ENGINE_DEBUG && isAdmin && (
          <Card className="mb-4 border-purple-500/50 bg-purple-50 dark:bg-purple-950/30">
            <CardContent className="p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-purple-800 dark:text-purple-200">
                  📊 Résultat Dry Run
                </span>
                <Button variant="ghost" size="sm" onClick={() => setDryRunResult(null)} className="text-xs">
                  Fermer
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-purple-100 dark:bg-purple-900/50 rounded p-2">
                  <span className="text-purple-600 dark:text-purple-300">Rules actives</span>
                  <p className="font-bold text-lg">{String(dryRunResult.rules_count ?? 0)}</p>
                </div>
                <div className="bg-purple-100 dark:bg-purple-900/50 rounded p-2">
                  <span className="text-purple-600 dark:text-purple-300">Anomalies</span>
                  <p className="font-bold text-lg">{String(dryRunResult.anomalies ?? 0)}</p>
                </div>
                <div className="bg-purple-100 dark:bg-purple-900/50 rounded p-2">
                  <span className="text-purple-600 dark:text-purple-300">Incidents ouverts</span>
                  <p className="font-bold text-lg">{String(dryRunResult.incidents_opened ?? 0)}</p>
                </div>
                <div className="bg-purple-100 dark:bg-purple-900/50 rounded p-2">
                  <span className="text-purple-600 dark:text-purple-300">Auth</span>
                  <p className="font-bold text-sm">{String(dryRunResult.auth_method ?? "?")}</p>
                </div>
              </div>
              {Array.isArray(dryRunResult.rule_details) && (dryRunResult.rule_details as Record<string, unknown>[]).length > 0 && (
                <details className="mt-2">
                  <summary className="text-xs text-purple-600 dark:text-purple-300 cursor-pointer">Détails par rule</summary>
                  <pre className="text-xs mt-1 bg-purple-100 dark:bg-purple-900/50 p-2 rounded overflow-auto max-h-40">
                    {JSON.stringify(dryRunResult.rule_details, null, 2)}
                  </pre>
                </details>
              )}
              {dryRunResult.service_days && (
                <details className="mt-2">
                  <summary className="text-xs text-purple-600 dark:text-purple-300 cursor-pointer">Service days</summary>
                  <pre className="text-xs mt-1 bg-purple-100 dark:bg-purple-900/50 p-2 rounded overflow-auto max-h-40">
                    {JSON.stringify(dryRunResult.service_days, null, 2)}
                  </pre>
                </details>
              )}
            </CardContent>
          </Card>
        )}

        {/* Warning: no badge_events for this establishment */}
        {NOTIF_ENGINE_DEBUG && isAdmin && establishmentId && validEvents.length === 0 && !isLoading && (
          <Card className="mb-4 border-amber-500/50 bg-amber-50 dark:bg-amber-950/30">
            <CardContent className="p-4 flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
              <p className="text-sm text-amber-800 dark:text-amber-200">
                Aucun badge_event aujourd'hui pour cet établissement → aucune notification ne peut être générée. Vérifiez que les employés badgent sur le bon établissement.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Warning: users without subscriptions */}
        {isAdmin && noSubCount > 0 && (
          <Card className="mb-4 border-orange-500/50 bg-orange-50 dark:bg-orange-950/30">
            <CardContent className="p-4 flex items-center gap-3">
              <BellOff className="h-5 w-5 text-orange-600 dark:text-orange-400 flex-shrink-0" />
              <p className="text-sm text-orange-800 dark:text-orange-200">
                {noSubCount} notification(s) non envoyée(s) : destinataire(s) sans push activé. Invitez-les à activer les notifications dans Paramètres → Notifications.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Warning if no establishment selected */}
        {!establishmentId && (
          <Card className="mb-4 border-amber-500/50 bg-amber-50 dark:bg-amber-950/30">
            <CardContent className="p-4 flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              <p className="text-sm text-amber-800 dark:text-amber-200">
                Sélectionnez un établissement pour voir les notifications.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        )}

        {/* Error */}
        {error && (
          <Card className="border-destructive/50 bg-destructive/10">
            <CardContent className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0" />
                <p className="text-sm text-destructive">
                  {(error as Error).message || "Une erreur est survenue"}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
                Réessayer
              </Button>
            </CardContent>
          </Card>
        )}

        {/* No notifications */}
        {!isLoading && !error && displayEvents.length === 0 && establishmentId && (
          <Card>
            <CardContent className="p-8 text-center">
              <CheckCircle className="h-12 w-12 text-green-500 dark:text-green-400 mx-auto mb-3" />
              <p className="text-muted-foreground">
                {hideLegacy && legacyCount > 0
                  ? "Aucune notification récente (legacy masquées)"
                  : "Aucune notification pour aujourd'hui"
                }
              </p>
            </CardContent>
          </Card>
        )}

        {/* DB notification_events (SSOT — single source, filtered) */}
        {!isLoading && displayEvents.length > 0 && (
          <div className="space-y-3">
            {displayEvents.map((event) => (
              <NotifEventCard key={event.id} event={event} onMarkRead={handleMarkRead} isAdmin={isAdmin} />
            ))}
          </div>
        )}
      </div>
    </ResponsiveLayout>
  );
}

/** Card for a DB notification_event — null-safe, legacy-aware */
function NotifEventCard({ event, onMarkRead, isAdmin }: { event: NotificationEvent; onMarkRead: (id: string) => void; isAdmin: boolean }) {
  const navigate = useNavigate();
  const isRead = !!event.read_at;
  const isNoBadge = event.alert_type === "no_badge";
  const isMissingOut = event.alert_type === "missing_clock_out";
  const isNoSub = event.payload?.no_subscription === true;
  const legacy = isLegacyEvent(event);
  const unresolvedVars = hasUnresolvedTemplateVars(event.payload?.body);

  // Commande notification types
  const isCommande = event.alert_type?.startsWith("commande_");
  const isCommandeRecue = event.alert_type === "commande_recue";
  const isCommandeExpediee = event.alert_type === "commande_expediee_complete" || event.alert_type === "commande_expediee_partielle";
  const isCommandeReception = event.alert_type === "commande_reception_validee_complete" || event.alert_type === "commande_reception_validee_partielle";
  const isCommandePartielle = event.alert_type === "commande_expediee_partielle" || event.alert_type === "commande_reception_validee_partielle";
  const isCommandeComplete = event.alert_type === "commande_expediee_complete" || event.alert_type === "commande_reception_validee_complete";

  // Null-safe time display
  let timeStr = "--:--";
  try {
    const sentAt = new Date(event.sent_at);
    if (!isNaN(sentAt.getTime())) {
      timeStr = sentAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    }
  } catch { /* safe fallback */ }

  const title = event.payload?.title || (isNoBadge ? "Arrivée non badgée" : isMissingOut ? "Sortie non badgée" : isCommande ? "Commande" : "Alerte");

  // For legacy events with unresolved template vars, show a clear fallback
  const rawBody = event.payload?.body ?? "";
  const body = legacy && unresolvedVars
    ? "Ancienne notification (format obsolète)."
    : rawBody;

  const employeeName = event.source_user_name;

  // Wave/role info (v2.4+ only)
  const wave = event.payload?.wave;
  const maxWaves = event.payload?.max_waves;
  const roleId = event.payload?.role_id;

  // Deep link: badgeuse notification types
  const isBadgeuse = isNoBadge || isMissingOut;

  const handleClick = () => {
    if (!isRead) onMarkRead(event.id);

    // Deep link: navigate to order detail for commande notifications
    if (isCommande) {
      const p = event.payload as Record<string, unknown> | null;
      const orderId = (p?.order_id ?? p?.commande_id ?? p?.commande_plat_id) as string | undefined;
      if (orderId && typeof orderId === "string") {
        navigate(`/commandes?order=${orderId}`);
      } else {
        navigate("/commandes");
      }
      return;
    }

    // Deep link: navigate to badgeuse for badge notifications
    if (isBadgeuse) {
      navigate("/badgeuse");
    }
  };

  // Determine icon and colors based on type
  let iconNode: React.ReactNode;
  let iconBgClass: string;

  if (isCommandeRecue) {
    iconNode = <Package className="h-5 w-5" />;
    iconBgClass = "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400";
  } else if (isCommandeExpediee && !isCommandePartielle) {
    iconNode = <Truck className="h-5 w-5" />;
    iconBgClass = "bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400";
  } else if (isCommandePartielle) {
    iconNode = <AlertTriangle className="h-5 w-5" />;
    iconBgClass = "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400";
  } else if (isCommandeComplete) {
    iconNode = <PackageCheck className="h-5 w-5" />;
    iconBgClass = "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400";
  } else if (isNoBadge) {
    iconNode = <LogIn className="h-5 w-5" />;
    iconBgClass = "bg-destructive/10 text-destructive";
  } else if (isMissingOut) {
    iconNode = <LogOut className="h-5 w-5" />;
    iconBgClass = "bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400";
  } else {
    iconNode = <AlertTriangle className="h-5 w-5" />;
    iconBgClass = "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400";
  }

  // Border color for commande vs badgeuse
  const borderClass = isRead
    ? "border-l-4 border-l-muted opacity-70"
    : isCommande
      ? "border-l-4 border-l-blue-500"
      : "border-l-4 border-l-destructive";

  return (
    <Card
      className={cn("transition-colors cursor-pointer", borderClass)}
      onClick={handleClick}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className={cn("p-2 rounded-full", iconBgClass)}>
            {iconNode}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className={cn("text-sm", isRead ? "font-normal text-muted-foreground" : "font-semibold")}>{title}</p>
              {legacy && (
                <Badge variant="outline" className="text-xs text-muted-foreground border-muted">
                  Legacy
                </Badge>
              )}
              {isNoSub && (
                <Badge variant="outline" className="text-xs text-orange-600 border-orange-300 dark:text-orange-400 dark:border-orange-600">
                  <BellOff className="h-3 w-3 mr-1" />
                  Push désactivé
                </Badge>
              )}
            </div>
            {employeeName && (
              <div className="flex items-center gap-1.5 mt-0.5">
                <User className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-sm font-medium">{employeeName}</span>
              </div>
            )}
            {body && body !== "[Notification]" && (
              <p className="text-sm text-muted-foreground mt-1">{body}</p>
            )}
            <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground flex-wrap">
              <Clock className="h-3 w-3" />
              <span>{timeStr}</span>
              {event.payload?.minutes != null && (
                <Badge variant="secondary" className="text-xs">
                  +{event.payload.minutes} min
                </Badge>
              )}
              {/* Wave/role info for modern events */}
              {!legacy && wave != null && maxWaves != null && (
                <span className="text-muted-foreground/70">
                  vague {wave}/{maxWaves}
                </span>
              )}
              {!legacy && roleId && isAdmin && (
                <span className="text-muted-foreground/50 font-mono text-[10px]">
                  R:{roleId.slice(0, 6)}
                </span>
              )}
              {isRead && (
                <Badge variant="outline" className="text-xs">Lu</Badge>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
