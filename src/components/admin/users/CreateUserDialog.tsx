/**
 * CreateUserDialog — Formulaire de création directe d'un utilisateur.
 * Envoie une invitation via admin-invitations edge function.
 */

import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { filterAssignableRoles } from "@/lib/roles";
import { createUserSchema } from "@/lib/schemas/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Copy } from "lucide-react";
import type { Role, Team, Establishment } from "./userHelpers";

interface CreateUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateUserDialog({ open, onOpenChange }: CreateUserDialogProps) {
  const queryClient = useQueryClient();
  const { activeEstablishment } = useEstablishment();

  const [email, setEmail] = useState("");
  const [selectedEstId, setSelectedEstId] = useState<string>("");
  const [selectedRoleId, setSelectedRoleId] = useState<string>("");
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Sync selectedEstId with activeEstablishment when dialog opens
  useEffect(() => {
    if (open && activeEstablishment?.id) {
      setSelectedEstId(activeEstablishment.id);
    }
  }, [open, activeEstablishment?.id]);

  // Fetch roles via edge function (same SSOT as UsersManager)
  const { data: roles = [] } = useQuery({
    queryKey: ["assignable-roles"],
    queryFn: async () => {
      const response = await supabase.functions.invoke("admin-manage-roles", {
        body: { action: "list_roles" },
      });
      if (response.error) throw response.error;
      return filterAssignableRoles(response.data.roles as Role[]);
    },
    staleTime: 300000,
  });

  // Fetch teams via edge function (same SSOT as UsersManager)
  const { data: teams = [] } = useQuery({
    queryKey: ["admin-teams"],
    queryFn: async () => {
      const response = await supabase.functions.invoke("admin-manage-teams", {
        body: { action: "list" },
      });
      if (response.error) throw response.error;
      return (response.data.teams as (Team & { status?: string })[]).filter(
        (t) => t.status === "active"
      );
    },
    staleTime: 300000,
  });

  // Fetch establishments (same query key as UsersManager)
  const { data: establishments = [] } = useQuery({
    queryKey: ["all-establishments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("establishments")
        .select("id, name")
        .eq("status", "active")
        .order("name");
      if (error) throw error;
      return data as Establishment[];
    },
    staleTime: 300000,
  });

  const resetForm = () => {
    setEmail("");
    setSelectedEstId(activeEstablishment?.id ?? "");
    setSelectedRoleId("");
    setSelectedTeamId("");
    setFieldErrors({});
    setInviteLink(null);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) resetForm();
    onOpenChange(nextOpen);
  };

  const handleCreate = async () => {
    setFieldErrors({});

    // Validate with the correct flat schema
    const payload = {
      email: email.trim(),
      role_id: selectedRoleId,
      team_id: selectedTeamId,
      establishment_id: selectedEstId,
    };

    const result = createUserSchema.safeParse(payload);
    if (!result.success) {
      const errors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const key = issue.path[0]?.toString() ?? "general";
        errors[key] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }

    setIsCreating(true);
    try {
      const response = await supabase.functions.invoke("admin-invitations", {
        body: {
          action: "create",
          ...result.data,
        },
      });

      if (response.error) throw response.error;
      if (response.data.error) throw new Error(response.data.error);

      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      queryClient.invalidateQueries({ queryKey: ["admin-invitations"] });

      if (response.data.invite_link) {
        setInviteLink(response.data.invite_link);
      }

      toast.success("Utilisateur créé — invitation envoyée");
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Erreur lors de la création";
      // Translate common backend errors
      if (msg.includes("already exists")) {
        toast.error("Une invitation active existe déjà pour cet email");
      } else {
        toast.error(msg);
      }
    } finally {
      setIsCreating(false);
    }
  };

  const copyLink = async () => {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    toast.success("Lien copié !");
  };

  // If invite link is showing, render success state
  if (inviteLink) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invitation envoyée ✓</DialogTitle>
            <DialogDescription>
              L'utilisateur recevra un email avec ce lien d'inscription.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 mt-2">
            <Input value={inviteLink} readOnly className="text-xs" />
            <Button variant="outline" size="icon" onClick={copyLink}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => handleOpenChange(false)}>Fermer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ajouter un utilisateur</DialogTitle>
          <DialogDescription>
            Créez un accès utilisateur en envoyant une invitation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Email */}
          <div className="space-y-1.5">
            <Label htmlFor="create-user-email">Email</Label>
            <Input
              id="create-user-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nom@exemple.com"
              autoComplete="off"
              data-1p-ignore="true"
              data-lpignore="true"
            />
            {fieldErrors.email && (
              <p className="text-sm text-destructive">{fieldErrors.email}</p>
            )}
          </div>

          {/* Establishment */}
          <div className="space-y-1.5">
            <Label>Établissement</Label>
            <Select value={selectedEstId} onValueChange={setSelectedEstId}>
              <SelectTrigger>
                <SelectValue placeholder="Choisir un établissement" />
              </SelectTrigger>
              <SelectContent>
                {establishments.map((est) => (
                  <SelectItem key={est.id} value={est.id}>
                    {est.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fieldErrors.establishment_id && (
              <p className="text-sm text-destructive">{fieldErrors.establishment_id}</p>
            )}
          </div>

          {/* Role */}
          <div className="space-y-1.5">
            <Label>Rôle</Label>
            <Select value={selectedRoleId} onValueChange={setSelectedRoleId}>
              <SelectTrigger>
                <SelectValue placeholder="Choisir un rôle" />
              </SelectTrigger>
              <SelectContent>
                {roles.map((role) => (
                  <SelectItem key={role.id} value={role.id}>
                    {role.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fieldErrors.role_id && (
              <p className="text-sm text-destructive">{fieldErrors.role_id}</p>
            )}
          </div>

          {/* Team */}
          <div className="space-y-1.5">
            <Label>Équipe</Label>
            <Select value={selectedTeamId} onValueChange={setSelectedTeamId}>
              <SelectTrigger>
                <SelectValue placeholder="Choisir une équipe" />
              </SelectTrigger>
              <SelectContent>
                {teams.map((team) => (
                  <SelectItem key={team.id} value={team.id}>
                    {team.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fieldErrors.team_id && (
              <p className="text-sm text-destructive">{fieldErrors.team_id}</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isCreating}>
            Annuler
          </Button>
          <Button onClick={handleCreate} disabled={isCreating || !email || !selectedRoleId || !selectedTeamId || !selectedEstId}>
            {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Créer et inviter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
