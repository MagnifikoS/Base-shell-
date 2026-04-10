/**
 * Clients B2B Page — Supplier-side view of B2B partnerships
 */

import { GenerateCodeDialog } from "../components/GenerateCodeDialog";
import { PartnershipList } from "../components/PartnershipList";
import { useInvitationCodes } from "../hooks/useInvitationCodes";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, CheckCircle2, XCircle } from "lucide-react";

export function ClientsB2BPage() {
  const { codes } = useInvitationCodes();

  // Show last 5 codes
  const recentCodes = codes.slice(0, 5);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Clients B2B</h1>
          <p className="text-muted-foreground mt-1">
            Gérez vos partenariats avec vos clients restaurateurs
          </p>
        </div>
        <GenerateCodeDialog />
      </div>

      {/* Recent codes */}
      {recentCodes.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Codes récents</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {recentCodes.map((c) => {
                const isUsed = !!c.used_at;
                const isExpired = !isUsed && new Date(c.expires_at) < new Date();
                const isPending = !isUsed && !isExpired;

                return (
                  <div
                    key={c.id}
                    className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/50"
                  >
                    <span className="font-mono font-medium tracking-wider">{c.code}</span>
                    {isPending && (
                      <Badge variant="outline" className="gap-1">
                        <Clock className="h-3 w-3" />
                        En attente
                      </Badge>
                    )}
                    {isUsed && (
                      <Badge variant="default" className="gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        Utilisé
                      </Badge>
                    )}
                    {isExpired && (
                      <Badge variant="secondary" className="gap-1">
                        <XCircle className="h-3 w-3" />
                        Expiré
                      </Badge>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Partnership list */}
      <PartnershipList viewAs="supplier" />
    </div>
  );
}
