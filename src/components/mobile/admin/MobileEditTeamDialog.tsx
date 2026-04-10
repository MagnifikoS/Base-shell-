/**
 * Mobile Edit Team Dialog - Allows changing user team (scoped by establishment)
 * Uses Edge Function: admin-manage-teams (action "change_user_team")
 */

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions } from "@/hooks/usePermissions";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

interface Team {
  id: string;
  name: string;
}

interface User {
  user_id: string;
  full_name: string | null;
  email: string;
  teams: Team[];
}

interface MobileEditTeamDialogProps {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
  /** If provided, use this establishment ID instead of activeEstablishment */
  establishmentId?: string;
  /** Optional establishment name for display */
  establishmentName?: string;
}

export function MobileEditTeamDialog({
  isOpen,
  onClose,
  user,
  establishmentId: propEstablishmentId,
  establishmentName,
}: MobileEditTeamDialogProps) {
  const queryClient = useQueryClient();
  const { isAdmin } = usePermissions();
  const { activeEstablishment } = useEstablishment();
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");

  // Resolve establishment ID: prop takes precedence, fallback to active
  const resolvedEstablishmentId = propEstablishmentId || activeEstablishment?.id;

  // Sync selected team when user changes or dialog opens
  useEffect(() => {
    if (user && isOpen) {
      // Use first team if available
      setSelectedTeamId(user.teams?.[0]?.id || "");
    }
  }, [user, isOpen]);

  // Fetch teams for the resolved establishment
  const { data: teams = [], isLoading: teamsLoading } = useQuery({
    queryKey: ["admin-teams", resolvedEstablishmentId],
    queryFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) throw new Error("Non authentifié");

      const response = await supabase.functions.invoke("admin-manage-teams", {
        body: { action: "list" },
      });

      if (response.error) throw response.error;
      // Filter only active teams
      return (response.data.teams as (Team & { status?: string })[]).filter(
        (t) => t.status === "active"
      );
    },
    enabled: isOpen && isAdmin && !!resolvedEstablishmentId,
    staleTime: 300000, // 5 min
  });

  // Team change mutation
  const changeTeamMutation = useMutation({
    mutationFn: async ({
      userId,
      newTeamId,
      establishmentId,
    }: {
      userId: string;
      newTeamId: string | null;
      establishmentId: string;
    }) => {
      const response = await supabase.functions.invoke("admin-manage-teams", {
        body: {
          action: "change_user_team",
          user_id: userId,
          new_team_id: newTeamId,
          establishment_id: establishmentId,
        },
      });
      if (response.error) throw response.error;
      if (response.data.error) throw new Error(response.data.error);
      return response.data;
    },
    onSuccess: () => {
      // Invalidate queries to reflect changes immediately
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      queryClient.invalidateQueries({ queryKey: ["admin-teams"] });
      // V2 invalidation
      queryClient.invalidateQueries({ queryKey: ["my-permissions-v2"] });
      toast.success("Équipe modifiée avec succès");
      onClose();
    },
    onError: (error: Error) => {
      toast.error(error.message || "Erreur lors de la modification de l'équipe");
    },
  });

  const handleConfirm = () => {
    if (!user) return;

    // Guard: establishment_id required
    if (!resolvedEstablishmentId) {
      toast.error("Aucun établissement sélectionné");
      return;
    }

    changeTeamMutation.mutate({
      userId: user.user_id,
      newTeamId: selectedTeamId || null,
      establishmentId: resolvedEstablishmentId,
    });
  };

  const currentTeamId = user?.teams?.[0]?.id || "";
  const hasChanges = selectedTeamId !== currentTeamId;
  const canSubmit = hasChanges && !changeTeamMutation.isPending;

  // RBAC: Admin-only access
  if (!isAdmin) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-[90vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-destructive" />
              Accès réservé
            </DialogTitle>
            <DialogDescription>
              Seuls les administrateurs peuvent modifier les équipes.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Fermer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-[90vw] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Modifier l'équipe
            {establishmentName && (
              <span className="block text-xs font-normal text-muted-foreground mt-1">
                {establishmentName}
              </span>
            )}
          </DialogTitle>
          <DialogDescription>{user?.full_name || user?.email}</DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {teamsLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Select value={selectedTeamId} onValueChange={setSelectedTeamId}>
              <SelectTrigger>
                <SelectValue placeholder="Sélectionner une équipe" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Aucune équipe</SelectItem>
                {teams.map((team) => (
                  <SelectItem key={team.id} value={team.id}>
                    {team.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <DialogFooter className="flex-row gap-2">
          <Button variant="outline" onClick={onClose} className="flex-1">
            Annuler
          </Button>
          <Button onClick={handleConfirm} disabled={!canSubmit} className="flex-1">
            {changeTeamMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Valider
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
