import { ReactNode } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { MobileLayout } from "./MobileLayout";
import { AppLayout } from "@/components/layout/AppLayout";

interface ResponsiveLayoutProps {
  children: ReactNode;
  /** Mobile-specific content (if different from desktop) */
  mobileContent?: ReactNode;
  /** Hide mobile header */
  hideMobileHeader?: boolean;
  /** Hide mobile bottom nav */
  hideMobileBottomNav?: boolean;
}

export function ResponsiveLayout({
  children,
  mobileContent,
  hideMobileHeader = false,
  hideMobileBottomNav = false,
}: ResponsiveLayoutProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <MobileLayout 
        hideHeader={hideMobileHeader}
        hideBottomNav={hideMobileBottomNav}
      >
        {mobileContent || children}
      </MobileLayout>
    );
  }

  return <AppLayout>{children}</AppLayout>;
}
