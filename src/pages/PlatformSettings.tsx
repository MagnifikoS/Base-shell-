import { PlatformLayout } from "@/components/platform/PlatformLayout";
import { Settings } from "lucide-react";

export default function PlatformSettings() {
  return (
    <PlatformLayout breadcrumbs={[{ label: "Paramètres" }]}>
      <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
        <h1 className="text-2xl font-bold text-foreground">Paramètres plateforme</h1>
        <div className="rounded-lg border p-12 text-center space-y-4">
          <Settings className="w-12 h-12 text-muted-foreground mx-auto" />
          <p className="text-muted-foreground">Les paramètres plateforme seront disponibles prochainement.</p>
        </div>
      </div>
    </PlatformLayout>
  );
}
