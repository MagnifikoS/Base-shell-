/**
 * Mobile Congés & Absences page
 * Uses shared CongesAbsencesContent component (same as desktop)
 */

import { MobileLayout } from "@/components/mobile/MobileLayout";
import { CongesAbsencesContent } from "../components/CongesAbsencesContent";

export function MobileCongesAbsences() {
  return (
    <MobileLayout>
      <div className="p-4">
        <h1 className="text-xl font-semibold mb-4">Congés & Absences</h1>
        <CongesAbsencesContent />
      </div>
    </MobileLayout>
  );
}