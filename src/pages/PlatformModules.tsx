import { PlatformLayout } from "@/components/platform/PlatformLayout";
import { Blocks, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { platformListModules } from "@/lib/platform/rpcPlatform";
import type { PlatformModuleRow } from "@/lib/platform/rpcPlatform";

export default function PlatformModules() {
  const { data: modules = [], isLoading } = useQuery({
    queryKey: ["platform-modules"],
    queryFn: platformListModules,
  });

  return (
    <PlatformLayout breadcrumbs={[{ label: "Modules globaux" }]}>
      <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
        <h1 className="text-2xl font-bold text-foreground">Modules globaux</h1>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : modules.length === 0 ? (
          <p className="text-muted-foreground text-center py-12">Aucun module trouvé.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {modules.map((mod: PlatformModuleRow) => (
              <Card key={mod.key}>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">{mod.name}</CardTitle>
                  <Blocks className="w-4 h-4 text-muted-foreground" />
                </CardHeader>
                <CardContent className="space-y-1">
                  {mod.description && (
                    <p className="text-xs text-muted-foreground">{mod.description}</p>
                  )}
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-sm text-muted-foreground">
                      {mod.organizations_using} org · {mod.establishments_using} étab.
                    </span>
                    <Badge variant={mod.status === "active" ? "default" : "secondary"}>
                      {mod.status === "active" ? "Actif" : "Inactif"}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </PlatformLayout>
  );
}
