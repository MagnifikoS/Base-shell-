import { useState, lazy, Suspense } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { MobileLayout } from "@/components/mobile/MobileLayout";
import { usePermissions } from "@/hooks/usePermissions";
import { useIsMobile } from "@/hooks/useIsMobile";
// Desktop components
import { EstablishmentsManager } from "@/components/admin/EstablishmentsManager";
import { TeamsManager } from "@/components/admin/TeamsManager";
import { InvitationsManager } from "@/components/admin/InvitationsManager";
import { UsersManager } from "@/components/admin/UsersManager";
import { RolesPermissionsManager } from "@/components/admin/RolesPermissionsManager";
// Mobile components — lazy-loaded (API-PERF-013)
const MobileUsersManager = lazy(() =>
  import("@/components/mobile/admin/MobileUsersManager").then((m) => ({
    default: m.MobileUsersManager,
  }))
);
const MobileInvitationsManager = lazy(() =>
  import("@/components/mobile/admin/MobileInvitationsManager").then((m) => ({
    default: m.MobileInvitationsManager,
  }))
);
const MobileRolesPermissionsManager = lazy(() =>
  import("@/components/mobile/admin/MobileRolesPermissionsManager").then((m) => ({
    default: m.MobileRolesPermissionsManager,
  }))
);
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Building2, Loader2, ShieldX, Users, Mail, UserCheck, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

function AdminTabLoader() {
  return (
    <div className="flex items-center justify-center py-8">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

const ADMIN_TABS = [
  { value: "users", label: "Utilisateurs", icon: UserCheck },
  { value: "invitations", label: "Invitations", icon: Mail },
  { value: "roles", label: "Rôles", icon: Shield },
  { value: "teams", label: "Teams", icon: Users },
  { value: "etablissements", label: "Établissements", icon: Building2 },
] as const;

export default function Admin() {
  const { isAdmin, isLoading: loading } = usePermissions();
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState("users");

  // Layout wrapper selon plateforme
  const Layout = isMobile ? MobileLayout : AppLayout;

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </Layout>
    );
  }

  if (!isAdmin) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center py-16 space-y-4">
          <ShieldX className="h-12 w-12 text-destructive" />
          <h1 className="text-xl font-semibold text-foreground">Accès refusé</h1>
          <p className="text-muted-foreground text-center px-4">
            Vous devez être administrateur pour accéder à cette page.
          </p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className={cn("space-y-4", isMobile ? "p-4" : "space-y-6")}>
        {/* Title hidden on mobile (implicit via tab) */}
        {!isMobile && <h1 className="text-2xl font-semibold text-foreground">Administration</h1>}

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="w-full"
          aria-label="Onglets d'administration"
        >
          {/* Mobile: tabs scrollables horizontalement */}
          {isMobile ? (
            <ScrollArea className="w-full">
              <TabsList className="bg-muted inline-flex h-auto gap-1 p-1 w-max">
                {ADMIN_TABS.map((tab) => (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    className="gap-1.5 px-3 py-2 text-xs whitespace-nowrap"
                  >
                    <tab.icon className="h-4 w-4" />
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
              <ScrollBar orientation="horizontal" className="invisible" />
            </ScrollArea>
          ) : (
            <TabsList className="bg-muted flex-wrap h-auto gap-1 p-1">
              {ADMIN_TABS.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value} className="gap-2">
                  <tab.icon className="h-4 w-4" />
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          )}

          {/* Contenu des onglets - responsive components */}
          <div className={cn("mt-4", !isMobile && "mt-6")}>
            <div className={cn(activeTab !== "users" && "hidden")}>
              {isMobile ? (
                <Suspense fallback={<AdminTabLoader />}>
                  <MobileUsersManager />
                </Suspense>
              ) : (
                <UsersManager />
              )}
            </div>
            <div className={cn(activeTab !== "invitations" && "hidden")}>
              {isMobile ? (
                <Suspense fallback={<AdminTabLoader />}>
                  <MobileInvitationsManager />
                </Suspense>
              ) : (
                <InvitationsManager />
              )}
            </div>
            <div className={cn(activeTab !== "roles" && "hidden")}>
              {isMobile ? (
                <Suspense fallback={<AdminTabLoader />}>
                  <MobileRolesPermissionsManager />
                </Suspense>
              ) : (
                <RolesPermissionsManager />
              )}
            </div>
            <div className={cn(activeTab !== "teams" && "hidden")}>
              <TeamsManager />
            </div>
            <div className={cn(activeTab !== "etablissements" && "hidden")}>
              <EstablishmentsManager />
            </div>
          </div>
        </Tabs>
      </div>
    </Layout>
  );
}
