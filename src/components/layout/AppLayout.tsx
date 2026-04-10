import { ReactNode, useCallback, useState } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { CommandPalette } from "@/components/CommandPalette";
import { ImpersonationBanner } from "@/components/ImpersonationBanner";
import { NotificationPermissionBanner } from "@/components/NotificationPermissionBanner";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useAuth } from "@/contexts/AuthContext";
import { useAppRealtimeSync } from "@/hooks/useAppRealtimeSync";
import { useIdleTimeout } from "@/hooks/useIdleTimeout";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { toast } from "sonner";

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const { activeEstablishment } = useEstablishment();
  const { signOut, user } = useAuth();

  // ── Command palette (Cmd+K) ──────────────────────────────────────────
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  const toggleCommandPalette = useCallback(() => {
    setCommandPaletteOpen((prev) => !prev);
  }, []);

  const showShortcutsHelp = useCallback(() => {
    toast.info("Raccourcis clavier : Cmd+K (palette de commandes), ? (aide raccourcis)", {
      duration: 5_000,
    });
  }, []);

  useKeyboardShortcuts({
    onToggleCommandPalette: toggleCommandPalette,
    onShowShortcutsHelp: showShortcutsHelp,
  });

  // ── Idle session timeout (30 min warning, 35 min logout) ────────────
  const handleIdleWarning = useCallback(() => {
    toast.warning("Vous serez deconnecte dans 5 minutes pour inactivite.", {
      duration: 10_000,
    });
  }, []);

  const handleIdleLogout = useCallback(() => {
    signOut();
    toast.info("Session expiree pour inactivite.");
  }, [signOut]);

  useIdleTimeout({
    onWarning: handleIdleWarning,
    onLogout: handleIdleLogout,
    enabled: !!user,
  });

  // PHASE 2.7: Global realtime sync (badges + planning) - SINGLE SOURCE
  // PHASE 2.7: Global realtime sync (badges + planning) - SINGLE SOURCE
  // PERF-03: Pass organizationId for employee_details channel filtering
  useAppRealtimeSync({
    establishmentId: activeEstablishment?.id ?? null,
    organizationId: activeEstablishment?.organization_id ?? null,
    enabled: !!activeEstablishment?.id,
  });

  return (
    <SidebarProvider defaultOpen={window.innerWidth >= 1024}>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <main
          id="main-content"
          className="flex-1 flex flex-col min-w-0"
          aria-label="Contenu principal"
        >
          <header className="h-14 border-b border-border flex items-center px-4 bg-card shrink-0">
            <SidebarTrigger aria-label="Basculer le menu latéral" />
          </header>
          <ImpersonationBanner />
          <NotificationPermissionBanner />
          <div className="flex-1 p-6 bg-background overflow-auto relative">{children}</div>
        </main>
      </div>
      <CommandPalette open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen} />
    </SidebarProvider>
  );
}
