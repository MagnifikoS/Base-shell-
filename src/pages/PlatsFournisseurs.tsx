/**
 * Page "Plats fournisseurs" — Plats commerciaux suivis par le client.
 * Domaine isolé : ne touche pas à Produits V2 ni aux Recettes internes.
 */

import { ResponsiveLayout } from "@/components/mobile/ResponsiveLayout";
import { PlatsFournisseursPage } from "@/modules/clientsB2B/components/PlatsFournisseursPage";

export default function PlatsFournisseurs() {
  return (
    <ResponsiveLayout>
      <div className="container mx-auto py-6 px-4 max-w-6xl">
        <PlatsFournisseursPage />
      </div>
    </ResponsiveLayout>
  );
}
