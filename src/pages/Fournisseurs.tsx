/**
 * Fournisseurs Route Page
 */

import { ResponsiveLayout } from "@/components/mobile/ResponsiveLayout";
import { FournisseursPage } from "@/modules/fournisseurs";

export default function Fournisseurs() {
  return (
    <ResponsiveLayout>
      <div className="container mx-auto py-6 px-4 max-w-6xl">
        <FournisseursPage />
      </div>
    </ResponsiveLayout>
  );
}
