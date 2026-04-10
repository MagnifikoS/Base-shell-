/**
 * Clients B2B Route Page
 */

import { ResponsiveLayout } from "@/components/mobile/ResponsiveLayout";
import { ClientsB2BPage } from "@/modules/clientsB2B";

export default function ClientsB2B() {
  return (
    <ResponsiveLayout>
      <div className="container mx-auto py-6 px-4 max-w-6xl">
        <ClientsB2BPage />
      </div>
    </ResponsiveLayout>
  );
}
