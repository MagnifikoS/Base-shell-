import { ResponsiveLayout } from "@/components/mobile/ResponsiveLayout";
import { PushNotifSettingsCard } from "@/modules/pushNotif";
import { NotificationRulesCard } from "@/components/settings/NotificationRulesCard";
import { usePermissions } from "@/hooks/usePermissions";
import { BellRing, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SettingsNotifications() {
  const { can } = usePermissions();

  // Employee = no alertes access (access_level = none)
  const hasAlertesAccess = can("alertes", "read");

  return (
    <ResponsiveLayout>
      <div className="container mx-auto p-4 max-w-2xl space-y-6">
        <h1 className="text-2xl font-bold">Notifications</h1>

        {/* Push settings: visible to all, but employees get locked mode */}
        <PushNotifSettingsCard lockMode={!hasAlertesAccess} />

        {/* Alert rules: only for admin/managers with alertes access */}
        {hasAlertesAccess && <NotificationRulesCard />}
      </div>
    </ResponsiveLayout>
  );
}
