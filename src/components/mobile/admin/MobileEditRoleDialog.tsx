/**
 * Mobile Edit Role Dialog - Allows changing user roles (multi-role support)
 * Reuses desktop query/mutation: admin-manage-roles
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
import { Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

interface Role {
  id: string;
  name: string;
}

interface User {
  user_id: string;
  full_name: string | null;
  email: string;
  roles: Role[];
}

interface MobileEditRoleDialogProps {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
  /** If provided, use this establishment ID instead of activeEstablishment */
  establishmentId?: string;
  /** Optional establishment name for display */
  establishmentName?: string;
}

export function MobileEditRoleDialog({ 
  isOpen, 
  onClose, 
  user, 
  establishmentId: propEstablishmentId,
  establishmentName,
}: MobileEditRoleDialogProps) {
  const queryClient = useQueryClient();
  const { isAdmin } = usePermissions();
  const { activeEstablishment } = useEstablishment();
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);

  // Resolve establishment ID: prop takes precedence, fallback to active
  const resolvedEstablishmentId = propEstablishmentId || activeEstablishment?.id;

  // Sync selected roles when user changes or dialog opens
  useEffect(() => {
    if (user && isOpen) {
      setSelectedRoleIds(user.roles?.map((r) => r.id) || []);
    }
  }, [user, isOpen]);

  // Reuse EXACT same query as desktop: ["assignable-roles"]
  const { data: roles = [], isLoading: rolesLoading } = useQuery({
    queryKey: ["assignable-roles"],
    queryFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) throw new Error("Non authentifié");

      const response = await supabase.functions.invoke("admin-manage-roles", {
        body: { action: "list_roles" },
      });

      if (response.error) throw response.error;
      // Filter out "Autres" role as per desktop constraint
      return (response.data.roles as Role[]).filter((r: Role) => r.name !== "Autres");
    },
    enabled: isOpen && isAdmin,
    staleTime: 300000, // 5 min - same as desktop
  });

  // Multi-role mutation
  const setRolesMutation = useMutation({
    mutationFn: async ({ userId, roleIds, establishmentId }: { userId: string; roleIds: string[]; establishmentId: string }) => {
      const response = await supabase.functions.invoke("admin-manage-roles", {
        body: { action: "set_user_roles", user_id: userId, role_ids: roleIds, establishment_id: establishmentId },
      });
      if (response.error) throw response.error;
      if (response.data.error) throw new Error(response.data.error);
      return response.data;
    },
    onSuccess: () => {
      // Invalidate queries to reflect changes immediately
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      queryClient.invalidateQueries({ queryKey: ["admin-roles"] });
      // V2 invalidation — Phase 2 / Étape 28
      queryClient.invalidateQueries({ queryKey: ["my-permissions-v2"] });
      toast.success("Rôles modifiés avec succès");
      onClose();
    },
    onError: (error: Error) => {
      toast.error(error.message || "Erreur lors de la modification des rôles");
    },
  });

  const handleConfirm = () => {
    if (!user || selectedRoleIds.length === 0) return;
    // Guard: establishment_id required
    if (!resolvedEstablishmentId) {
      toast.error("Aucun établissement sélectionné");
      return;
    }
    setRolesMutation.mutate({ userId: user.user_id, roleIds: selectedRoleIds, establishmentId: resolvedEstablishmentId });
  };

  const handleToggleRole = (roleId: string) => {
    setSelectedRoleIds((prev) =>
      prev.includes(roleId)
        ? prev.filter((id) => id !== roleId)
        : [...prev, roleId]
    );
  };

  const currentRoleIds = user?.roles?.map((r) => r.id) || [];
  const hasChanges = JSON.stringify([...selectedRoleIds].sort()) !== JSON.stringify([...currentRoleIds].sort());
  const canSubmit = hasChanges && selectedRoleIds.length > 0 && !setRolesMutation.isPending;

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
              Seuls les administrateurs peuvent modifier les rôles.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Fermer</Button>
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
            Modifier les rôles
            {establishmentName && (
              <span className="block text-xs font-normal text-muted-foreground mt-1">
                {establishmentName}
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            {user?.full_name || user?.email}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {rolesLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {roles.map((role) => {
                const isChecked = selectedRoleIds.includes(role.id);
                return (
                  <label
                    key={role.id}
                    className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => handleToggleRole(role.id)}
                      className="h-5 w-5 rounded border-input"
                    />
                    <span className="text-sm font-medium">{role.name}</span>
                  </label>
                );
              })}
            </div>
          )}
          {selectedRoleIds.length === 0 && !rolesLoading && (
            <p className="text-xs text-destructive mt-2">Au moins un rôle requis</p>
          )}
        </div>

        <DialogFooter className="flex-row gap-2">
          <Button variant="outline" onClick={onClose} className="flex-1">
            Annuler
          </Button>
          <Button 
            onClick={handleConfirm} 
            disabled={!canSubmit}
            className="flex-1"
          >
            {setRolesMutation.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Valider
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
