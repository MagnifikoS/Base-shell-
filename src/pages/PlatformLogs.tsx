import { PlatformLayout } from "@/components/platform/PlatformLayout";
import { ScrollText } from "lucide-react";

export default function PlatformLogs() {
  return (
    <PlatformLayout breadcrumbs={[{ label: "Logs globaux" }]}>
      <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
        <h1 className="text-2xl font-bold text-foreground">Logs globaux</h1>
        <div className="rounded-lg border p-12 text-center space-y-4">
          <ScrollText className="w-12 h-12 text-muted-foreground mx-auto" />
          <p className="text-muted-foreground">Les logs globaux seront disponibles prochainement.</p>
          <p className="text-sm text-muted-foreground">Connexions, erreurs critiques, activité suspecte…</p>
        </div>
      </div>
    </PlatformLayout>
  );
}
