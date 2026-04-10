/**
 * Mobile Invitations Manager - Lightweight mobile-specific component
 * Desktop version: src/components/admin/InvitationsManager.tsx (unchanged)
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

interface Invitation {
  id: string;
  email: string;
  status: string;
  expires_at: string;
  is_test: boolean;
  role: { id: string; name: string };
  team: { id: string; name: string };
  establishment: { id: string; name: string };
}

const STATUS_CONFIG: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
  invited: { variant: "default", label: "Invité" },
  requested: { variant: "outline", label: "En attente" },
  accepted: { variant: "secondary", label: "Accepté" },
  rejected: { variant: "destructive", label: "Refusé" },
  canceled: { variant: "destructive", label: "Annulé" },
  expired: { variant: "secondary", label: "Expiré" },
};

function InvitationCard({ invitation }: { invitation: Invitation }) {
  const isExpired = new Date(invitation.expires_at) < new Date();
  
  // Determine effective status
  let effectiveStatus = invitation.status;
  if (isExpired && invitation.status === "invited") {
    effectiveStatus = "expired";
  }
  if (invitation.is_test && invitation.status === "invited") {
    effectiveStatus = "requested"; // Test invitations show as pending
  }

  const status = STATUS_CONFIG[effectiveStatus] || { variant: "secondary" as const, label: effectiveStatus };
  
  // Extract name from email (before @) as fallback since we don't have full_name on invitations
  const displayName = invitation.email.split("@")[0];

  return (
    <div className="flex items-center justify-between p-3 bg-card border border-border rounded-lg">
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">{displayName}</p>
        <p className="text-xs text-muted-foreground truncate">{invitation.email}</p>
      </div>
      <Badge variant={status.variant} className="text-xs ml-2">
        {status.label}
      </Badge>
    </div>
  );
}

export function MobileInvitationsManager() {
  const { activeEstablishment } = useEstablishment();
  const establishmentId = activeEstablishment?.id;

  const { data: invitations = [], isLoading } = useQuery({
    queryKey: ["admin-invitations", establishmentId],
    queryFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) throw new Error("Non authentifié");

      const response = await supabase.functions.invoke("admin-invitations", {
        body: { 
          action: "list",
          establishment_id: establishmentId || undefined,
        },
      });

      if (response.error) throw response.error;
      return response.data.invitations as Invitation[];
    },
    staleTime: 60000,
    refetchOnWindowFocus: false,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (invitations.length === 0) {
    return (
      <p className="text-center text-muted-foreground py-8">Aucune invitation</p>
    );
  }

  return (
    <div className="space-y-2">
      {invitations.map((invitation) => (
        <InvitationCard key={invitation.id} invitation={invitation} />
      ))}
    </div>
  );
}
