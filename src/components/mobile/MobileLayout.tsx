import { ReactNode, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { MobileHeader } from "./MobileHeader";
import { MobileBottomNav } from "./MobileBottomNav";
import { PushPromptBanner } from "@/modules/pushNotif";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useAppRealtimeSync } from "@/hooks/useAppRealtimeSync";

interface MobileLayoutProps {
  children: ReactNode;
  /** Hide header for specific pages */
  hideHeader?: boolean;
  /** Hide bottom nav for specific pages */
  hideBottomNav?: boolean;
}

export function MobileLayout({
  children,
  hideHeader = false,
  hideBottomNav = false,
}: MobileLayoutProps) {
  const location = useLocation();
  const { activeEstablishment } = useEstablishment();

  // Global realtime sync — same as AppLayout (desktop) so mobile gets live updates
  useAppRealtimeSync({
    establishmentId: activeEstablishment?.id ?? null,
    organizationId: activeEstablishment?.organization_id ?? null,
    enabled: !!activeEstablishment?.id,
  });

  // FIX #1: Reset scroll to top on route change
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [location.pathname]);

  return (
    // FIX #2: Use 100dvh for correct iOS viewport + flex layout
    <div className="min-h-[100dvh] flex flex-col bg-background">
      {!hideHeader && <MobileHeader />}
      <PushPromptBanner />

      {/* FIX #2: flex-1 + overflow-y-auto + safe-area padding for bottom nav */}
      <main
        id="main-content"
        aria-label="Contenu principal"
        className={`flex-1 overflow-y-auto ${!hideBottomNav ? "pb-[calc(64px+env(safe-area-inset-bottom))]" : ""}`}
      >
        {children}
      </main>

      {!hideBottomNav && <MobileBottomNav />}
    </div>
  );
}
