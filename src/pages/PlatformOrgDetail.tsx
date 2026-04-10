import { useParams, useNavigate } from "react-router-dom";
import { Building2, Users, ArrowLeft } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PlatformLayout } from "@/components/platform/PlatformLayout";
import { platformListOrganizations, platformListEstablishments } from "@/lib/platform/rpcPlatform";
import type { PlatformOrgRow, PlatformEstRow } from "@/lib/platform/rpcPlatform";

export default function PlatformOrgDetail() {
  const { orgId } = useParams();
  const navigate = useNavigate();

  const { data: orgs = [] } = useQuery({
    queryKey: ["platform-organizations"],
    queryFn: platformListOrganizations,
  });

  const orgName = orgs.find((o: PlatformOrgRow) => o.id === orgId)?.name ?? "Organisation";

  const { data: establishments = [], isLoading } = useQuery({
    queryKey: ["platform-establishments", orgId],
    queryFn: () => platformListEstablishments(orgId!),
    enabled: !!orgId,
  });

  return (
    <PlatformLayout breadcrumbs={[{ label: orgName }]}>
      <div className="p-6 md:p-8 space-y-8 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/platform")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">{orgName}</h1>
            <p className="text-sm text-muted-foreground">{establishments.length} établissement(s)</p>
          </div>
        </div>

        {/* Establishments */}
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Building2 className="w-4 h-4" /> Établissements
          </h2>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
            </div>
          ) : establishments.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">Aucun établissement.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {establishments.map((est: PlatformEstRow) => (
                <Card
                  key={est.id}
                  className="hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => navigate(`/platform/org/${orgId}/establishment/${est.id}`)}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-2.5">
                      {est.logo_url ? (
                        <img
                          src={est.logo_url}
                          alt={`Logo ${est.name}`}
                          className="w-7 h-7 rounded-md object-cover ring-1 ring-border/50 shrink-0"
                        />
                      ) : (
                        <div className="w-7 h-7 rounded-md bg-muted flex items-center justify-center shrink-0">
                          <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                        </div>
                      )}
                      <CardTitle className="text-sm">{est.name}</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3" /> {est.user_count} utilisateur(s)
                      </span>
                      <span className="text-xs">{est.establishment_type}</span>
                    </div>
                    <Badge variant={est.status === "active" ? "outline" : "destructive"} className="text-xs capitalize">
                      {est.status === "active" ? "Actif" : est.status}
                    </Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
      </div>
    </PlatformLayout>
  );
}
