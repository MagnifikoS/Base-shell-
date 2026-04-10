/**
 * Read-only partner profile card (projection via RPC)
 */

import { useQuery } from "@tanstack/react-query";
import { getPartnerProfile, type PartnerProfile } from "../services/b2bPartnershipService";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Building2, Mail, Phone, MapPin, FileText, Loader2 } from "lucide-react";

interface Props {
  partnerEstablishmentId: string;
  partnershipStatus: "active" | "archived";
  actions?: React.ReactNode;
}

export function PartnerProfileCard({ partnerEstablishmentId, partnershipStatus, actions }: Props) {
  const { data: profile, isLoading } = useQuery<PartnerProfile>({
    queryKey: ["b2b-partner-profile", partnerEstablishmentId],
    queryFn: () => getPartnerProfile(partnerEstablishmentId),
    enabled: partnershipStatus === "active",
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!profile || !profile.ok) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-muted-foreground">
          Profil non disponible
        </CardContent>
      </Card>
    );
  }

  const initials = (profile.name ?? "?")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <Card className="overflow-hidden">
      {/* Header row: avatar + name + badge */}
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <Avatar className="h-11 w-11 shrink-0 border">
            <AvatarImage src={profile.logo_url ?? undefined} />
            <AvatarFallback className="text-sm font-medium">{initials}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base font-semibold truncate">
                {profile.trade_name || profile.name}
              </CardTitle>
              <Badge
                variant={partnershipStatus === "active" ? "default" : "secondary"}
                className="shrink-0 text-[10px] px-1.5 py-0"
              >
                {partnershipStatus === "active" ? "Actif" : "Archivé"}
              </Badge>
            </div>
            {profile.legal_name && (
              <p className="text-xs text-muted-foreground truncate mt-0.5">{profile.legal_name}</p>
            )}
          </div>
        </div>
        {/* Action buttons row */}
        {actions && <div className="flex items-center gap-2 mt-3">{actions}</div>}
      </CardHeader>
      <CardContent className="space-y-1.5 text-sm">
        {profile.establishment_type && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Building2 className="h-3.5 w-3.5 shrink-0" />
            <span className="capitalize">{profile.establishment_type}</span>
          </div>
        )}
        {profile.city && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span>{profile.city}</span>
          </div>
        )}
        {profile.contact_email && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Mail className="h-3.5 w-3.5 shrink-0" />
            <span>{profile.contact_email}</span>
          </div>
        )}
        {profile.contact_phone && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Phone className="h-3.5 w-3.5 shrink-0" />
            <span>{profile.contact_phone}</span>
          </div>
        )}
        {profile.siret && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <FileText className="h-3.5 w-3.5 shrink-0" />
            <span>SIRET : {profile.siret}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
