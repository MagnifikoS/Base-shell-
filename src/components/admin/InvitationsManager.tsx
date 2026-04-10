import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { filterAssignableRoles } from "@/lib/roles";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { invitationSchema } from "@/lib/schemas/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, RefreshCw, X, Loader2, Mail, Copy, Trash2, Building2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Role {
  id: string;
  name: string;
}

interface Team {
  id: string;
  name: string;
}

interface Establishment {
  id: string;
  name: string;
}

interface Invitation {
  id: string;
  email: string;
  status: string;
  expires_at: string;
  created_at: string;
  is_test: boolean;
  role: Role;
  team: Team;
  establishment: Establishment;
}

// Per-establishment assignment structure
type PerEstAssignment = Record<string, { role_id: string | null; team_id: string | null }>;

export function InvitationsManager() {
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [selectedEstablishmentIds, setSelectedEstablishmentIds] = useState<string[]>([]);
  const [perEst, setPerEst] = useState<PerEstAssignment>({});
  const [lastInviteLink, setLastInviteLink] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [creationResults, setCreationResults] = useState<{
    success: string[];
    failed: { name: string; error: string }[];
  } | null>(null);

  // SSOT: Establishment from Context only
  const { activeEstablishment } = useEstablishment();
  const globalEstablishmentId = activeEstablishment?.id ?? null;

  // Fetch invitations
  const { data: invitations = [], isLoading } = useQuery({
    queryKey: ["admin-invitations", globalEstablishmentId],
    queryFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) throw new Error("Non authentifié");

      const response = await supabase.functions.invoke("admin-invitations", {
        body: {
          action: "list",
          establishment_id: globalEstablishmentId || undefined,
        },
      });

      if (response.error) throw response.error;
      return response.data.invitations as Invitation[];
    },
    staleTime: 60000,
    refetchOnWindowFocus: false,
  });

  // Fetch roles for select (filtrer "Autres" - non assignable)
  const { data: roles = [] } = useQuery({
    queryKey: ["admin-roles-list-assignable"],
    queryFn: async () => {
      const { data, error } = await supabase.from("roles").select("id, name").order("name");
      if (error) throw error;
      return filterAssignableRoles(data as Role[]);
    },
  });

  // Fetch active teams for select
  const { data: teams = [] } = useQuery({
    queryKey: ["admin-teams-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("id, name")
        .eq("status", "active")
        .order("name");
      if (error) throw error;
      return data as Team[];
    },
  });

  // Fetch active establishments for select
  const { data: establishments = [] } = useQuery({
    queryKey: ["admin-establishments-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("establishments")
        .select("id, name")
        .eq("status", "active")
        .order("name");
      if (error) throw error;
      return data as Establishment[];
    },
  });

  const _createMutation = useMutation({
    mutationFn: async (params: {
      email: string;
      role_id: string;
      team_id: string;
      establishment_id: string;
    }) => {
      const response = await supabase.functions.invoke("admin-invitations", {
        body: { action: "create", ...params },
      });
      if (response.error) throw response.error;
      if (response.data.error) throw new Error(response.data.error);
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["admin-invitations", globalEstablishmentId] });
      toast.success("Invitation envoyée avec succès");
      setIsCreateOpen(false);
      resetForm();
      if (data.invite_link) {
        setLastInviteLink(data.invite_link);
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || "Erreur lors de l'envoi");
    },
  });

  const resendMutation = useMutation({
    mutationFn: async (invitationId: string) => {
      const response = await supabase.functions.invoke("admin-invitations", {
        body: { action: "resend", invitation_id: invitationId },
      });
      if (response.error) throw response.error;
      if (response.data.error) throw new Error(response.data.error);
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["admin-invitations", globalEstablishmentId] });
      toast.success("Invitation renvoyée");
      if (data.invite_link) {
        setLastInviteLink(data.invite_link);
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || "Erreur lors du renvoi");
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (invitationId: string) => {
      const response = await supabase.functions.invoke("admin-invitations", {
        body: { action: "cancel", invitation_id: invitationId },
      });
      if (response.error) throw response.error;
      if (response.data.error) throw new Error(response.data.error);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-invitations", globalEstablishmentId] });
      toast.success("Invitation annulée");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Erreur lors de l'annulation");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (invitationId: string) => {
      const response = await supabase.functions.invoke("admin-invitations", {
        body: { action: "delete", invitation_id: invitationId },
      });
      if (response.error) throw response.error;
      if (response.data.error) throw new Error(response.data.error);
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["admin-invitations", globalEstablishmentId] });
      // Invalider admin-users UNIQUEMENT si un user a été nettoyé
      if (data.user_cleaned) {
        queryClient.invalidateQueries({ queryKey: ["admin-users", "all", globalEstablishmentId] });
      }
      // Invalider test-emails-set car c'est une invitation test potentielle
      queryClient.invalidateQueries({ queryKey: ["test-emails-set"] });

      let message = "Invitation supprimée";
      if (data.user_cleaned) {
        message += " (demande utilisateur nettoyée)";
      }
      toast.success(message);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Erreur lors de la suppression");
    },
  });

  const resetForm = () => {
    setNewEmail("");
    setSelectedEstablishmentIds([]);
    setPerEst({});
    setCreationResults(null);
    setFieldErrors({});
  };

  const toggleEstablishment = (estId: string) => {
    setSelectedEstablishmentIds((prev) => {
      const isRemoving = prev.includes(estId);
      if (isRemoving) {
        // Remove from perEst
        setPerEst((p) => {
          const next = { ...p };
          delete next[estId];
          return next;
        });
        return prev.filter((id) => id !== estId);
      } else {
        // Add to perEst with null defaults
        setPerEst((p) => ({
          ...p,
          [estId]: { role_id: null, team_id: null },
        }));
        return [...prev, estId];
      }
    });
  };

  const updateEstAssignment = (estId: string, field: "role_id" | "team_id", value: string) => {
    setPerEst((prev) => ({
      ...prev,
      [estId]: {
        ...prev[estId],
        [field]: value,
      },
    }));
  };

  // Check if all selected establishments have complete assignments
  const allAssignmentsComplete = selectedEstablishmentIds.every((estId) => {
    const assignment = perEst[estId];
    return assignment?.role_id && assignment?.team_id;
  });

  const handleCreate = async () => {
    setFieldErrors({});

    // Build assignments record for Zod validation (filter out null values)
    const assignmentsForValidation: Record<string, { role_id: string; team_id: string }> = {};
    for (const estId of selectedEstablishmentIds) {
      const a = perEst[estId];
      if (a?.role_id && a?.team_id) {
        assignmentsForValidation[estId] = { role_id: a.role_id, team_id: a.team_id };
      }
    }

    const validation = invitationSchema.safeParse({
      email: newEmail.trim(),
      establishment_ids: selectedEstablishmentIds,
      assignments: assignmentsForValidation,
    });

    if (!validation.success) {
      const errors: Record<string, string> = {};
      validation.error.issues.forEach((issue) => {
        const field = issue.path.join(".");
        if (!errors[field]) errors[field] = issue.message;
      });
      setFieldErrors(errors);

      // Show the first error as a toast for visibility
      const firstError = validation.error.issues[0]?.message;
      if (firstError) toast.error(firstError);
      return;
    }

    // Check for incomplete assignments (role/team missing for any selected establishment)
    const incomplete = selectedEstablishmentIds.filter((estId) => !assignmentsForValidation[estId]);
    if (incomplete.length > 0) {
      const names = incomplete.map((id) => establishments.find((e) => e.id === id)?.name || id);
      toast.error(`Rôle/équipe manquant pour : ${names.join(", ")}`);
      return;
    }

    setIsCreating(true);
    setCreationResults(null);

    const success: string[] = [];
    const failed: { name: string; error: string }[] = [];
    let lastLink: string | null = null;

    // Loop: create one invitation per establishment with per-est role/team
    for (const estId of selectedEstablishmentIds) {
      const estName = establishments.find((e) => e.id === estId)?.name || estId;
      const assignment = perEst[estId];
      try {
        const response = await supabase.functions.invoke("admin-invitations", {
          body: {
            action: "create",
            email: newEmail.trim(),
            role_id: assignment.role_id,
            team_id: assignment.team_id,
            establishment_id: estId,
          },
        });
        if (response.error) {
          throw response.error;
        }
        if (response.data.error) {
          throw new Error(response.data.error);
        }
        success.push(estName);
        if (response.data.invite_link) {
          lastLink = response.data.invite_link;
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Erreur inconnue";
        failed.push({ name: estName, error: message });
      }
    }

    setIsCreating(false);

    // Show results
    if (success.length > 0 && failed.length === 0) {
      toast.success(`${success.length} invitation(s) créée(s)`);
      queryClient.invalidateQueries({ queryKey: ["admin-invitations", globalEstablishmentId] });
      setIsCreateOpen(false);
      resetForm();
      if (lastLink) {
        setLastInviteLink(lastLink);
      }
    } else if (success.length > 0 && failed.length > 0) {
      // Partial success
      setCreationResults({ success, failed });
      queryClient.invalidateQueries({ queryKey: ["admin-invitations", globalEstablishmentId] });
      toast.warning(`${success.length} créée(s), ${failed.length} échec(s)`);
    } else {
      // All failed
      setCreationResults({ success, failed });
      toast.error("Aucune invitation créée");
    }
  };

  const copyInviteLink = () => {
    if (lastInviteLink) {
      navigator.clipboard.writeText(lastInviteLink);
      toast.success("Lien copié dans le presse-papiers");
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getStatusBadge = (status: string, isTest: boolean = false) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      invited: "default",
      requested: "outline",
      accepted: "secondary",
      rejected: "destructive",
      canceled: "destructive",
      expired: "secondary",
    };
    const labels: Record<string, string> = {
      invited: "Invité",
      requested: "En attente admin",
      accepted: "Accepté",
      rejected: "Refusé",
      canceled: "Annulé",
      expired: "Expiré",
    };

    // Pour les invitations test, toujours afficher "En attente admin" même si status='invited'
    if (isTest && status === "invited") {
      return <Badge variant="outline">En attente admin</Badge>;
    }

    return <Badge variant={variants[status] || "secondary"}>{labels[status] || status}</Badge>;
  };

  const isExpired = (expiresAt: string) => {
    return new Date(expiresAt) < new Date();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium text-foreground">Invitations</h2>
        <Dialog
          open={isCreateOpen}
          onOpenChange={(open) => {
            setIsCreateOpen(open);
            if (!open) resetForm();
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2">
              <Plus className="h-4 w-4" />
              Inviter
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Inviter un utilisateur</DialogTitle>
              <DialogDescription>
                Envoyez une invitation pour rejoindre votre organisation.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label htmlFor="invite-email" className="text-sm font-medium">
                  Email *
                </label>
                <Input
                  id="invite-email"
                  type="email"
                  value={newEmail}
                  onChange={(e) => {
                    setNewEmail(e.target.value);
                    if (fieldErrors.email) {
                      setFieldErrors((prev) => {
                        const next = { ...prev };
                        delete next.email;
                        return next;
                      });
                    }
                  }}
                  placeholder="email@exemple.com"
                  maxLength={255}
                  className={fieldErrors.email ? "border-destructive" : ""}
                />
                {fieldErrors.email && (
                  <p className="text-sm text-destructive mt-1">{fieldErrors.email}</p>
                )}
              </div>
              {/* Establishment selection */}
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Établissement(s) *
                  {selectedEstablishmentIds.length > 0 && (
                    <span className="ml-2 text-muted-foreground font-normal">
                      ({selectedEstablishmentIds.length} sélectionné
                      {selectedEstablishmentIds.length > 1 ? "s" : ""})
                    </span>
                  )}
                </label>
                <ScrollArea className="h-28 rounded-md border p-2">
                  <div className="space-y-2">
                    {establishments.map((est) => (
                      <label
                        key={est.id}
                        className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 p-1 rounded"
                      >
                        <Checkbox
                          checked={selectedEstablishmentIds.includes(est.id)}
                          onCheckedChange={() => toggleEstablishment(est.id)}
                        />
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">{est.name}</span>
                      </label>
                    ))}
                  </div>
                </ScrollArea>
              </div>

              {/* Per-establishment role/team blocks */}
              {selectedEstablishmentIds.length > 0 && (
                <div className="space-y-3">
                  <label className="text-sm font-medium">Configuration par établissement</label>
                  <ScrollArea className="max-h-48">
                    <div className="space-y-3 pr-2">
                      {selectedEstablishmentIds.map((estId) => {
                        const estName = establishments.find((e) => e.id === estId)?.name || estId;
                        const assignment = perEst[estId] || { role_id: null, team_id: null };
                        const isIncomplete = !assignment.role_id || !assignment.team_id;
                        return (
                          <div
                            key={estId}
                            className={`rounded-md border p-3 space-y-2 ${
                              isIncomplete ? "border-destructive/50 bg-destructive/5" : ""
                            }`}
                          >
                            <div className="flex items-center gap-2 text-sm font-medium">
                              <Building2 className="h-4 w-4 text-primary" />
                              {estName}
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <Select
                                value={assignment.role_id || ""}
                                onValueChange={(v) => updateEstAssignment(estId, "role_id", v)}
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue placeholder="Rôle *" />
                                </SelectTrigger>
                                <SelectContent>
                                  {roles.map((role) => (
                                    <SelectItem key={role.id} value={role.id}>
                                      {role.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Select
                                value={assignment.team_id || ""}
                                onValueChange={(v) => updateEstAssignment(estId, "team_id", v)}
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue placeholder="Équipe *" />
                                </SelectTrigger>
                                <SelectContent>
                                  {teams.map((team) => (
                                    <SelectItem key={team.id} value={team.id}>
                                      {team.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </div>
              )}
              {/* Show creation results (partial errors) */}
              {creationResults && creationResults.failed.length > 0 && (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 space-y-2">
                  <p className="text-sm font-medium text-destructive">
                    Échecs ({creationResults.failed.length}) :
                  </p>
                  <ul className="text-sm text-destructive space-y-1">
                    {creationResults.failed.map((f, i) => (
                      <li key={i}>
                        • {f.name}: {f.error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                Annuler
              </Button>
              <Button
                onClick={handleCreate}
                disabled={
                  isCreating ||
                  !newEmail.trim() ||
                  selectedEstablishmentIds.length === 0 ||
                  !allAssignmentsComplete
                }
              >
                {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {selectedEstablishmentIds.length > 1
                  ? `Inviter (${selectedEstablishmentIds.length} étab.)`
                  : "Inviter"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Dev: Show last invite link */}
      {lastInviteLink && (
        <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
          <Mail className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground flex-1 truncate">{lastInviteLink}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={copyInviteLink}
            aria-label="Copier le lien d'invitation"
          >
            <Copy className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLastInviteLink(null)}
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {invitations.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Mail className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground">Aucune invitation</p>
          <p className="text-sm text-muted-foreground">
            Invitez votre premier utilisateur pour commencer.
          </p>
        </div>
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Rôle</TableHead>
                <TableHead>Équipe</TableHead>
                <TableHead>Établissement</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Expire le</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitations.map((invitation) => (
                <TableRow key={invitation.id}>
                  <TableCell className="font-medium">{invitation.email}</TableCell>
                  <TableCell>{invitation.role?.name || "—"}</TableCell>
                  <TableCell>{invitation.team?.name || "—"}</TableCell>
                  <TableCell>{invitation.establishment?.name || "—"}</TableCell>
                  <TableCell>
                    {isExpired(invitation.expires_at) && invitation.status === "invited" ? (
                      <Badge variant="secondary">Expiré</Badge>
                    ) : (
                      getStatusBadge(invitation.status, invitation.is_test)
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(invitation.expires_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {(invitation.status === "invited" ||
                        invitation.status === "expired" ||
                        isExpired(invitation.expires_at)) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => resendMutation.mutate(invitation.id)}
                          disabled={resendMutation.isPending}
                          title="Renvoyer"
                        >
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                      )}
                      {(invitation.status === "invited" || invitation.status === "requested") &&
                        !isExpired(invitation.expires_at) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => cancelMutation.mutate(invitation.id)}
                            disabled={cancelMutation.isPending}
                            title="Annuler"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      {invitation.status !== "accepted" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteMutation.mutate(invitation.id)}
                          disabled={deleteMutation.isPending}
                          title="Supprimer"
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
