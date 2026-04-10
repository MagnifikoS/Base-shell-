/**
 * Desktop page for Congés & Absences module
 * Uses shared CongesAbsencesContent component (same as mobile)
 */

import { ResponsiveLayout } from "@/components/mobile/ResponsiveLayout";
import { CongesAbsencesContent } from "./components/CongesAbsencesContent";

export function CongesAbsencesPage() {
  return (
    <ResponsiveLayout>
      <div className="p-4 md:p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold mb-6">Congés & Absences</h1>
        <CongesAbsencesContent />
      </div>
    </ResponsiveLayout>
  );
}