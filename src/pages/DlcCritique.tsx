/**
 * DLC Critique — Page wrapper (thin, delegates to module component).
 */

import { ResponsiveLayout } from "@/components/mobile/ResponsiveLayout";
import { DlcCritiquePage as DlcCritiqueView } from "@/modules/dlc/components/DlcCritiquePage";

export default function DlcCritiquePage() {
  return (
    <ResponsiveLayout>
      <DlcCritiqueView />
    </ResponsiveLayout>
  );
}
