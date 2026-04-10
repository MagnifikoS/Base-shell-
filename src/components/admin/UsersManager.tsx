import { useState } from "react";
import { Plus } from "lucide-react";
import { CreateUserDialog } from "./users/CreateUserDialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Loader2, Users, RefreshCw } from "lucide-react";
// Plus is imported at top alongside CreateUserDialog
import { TableSkeleton } from "@/components/ui/TableSkeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { SearchInput } from "@/components/ui/SearchInput";
import { useListSearch } from "@/hooks/useListSearch";

// === TEST MODE IMPORTS (isolés pour suppression future) ===
import { ADMIN_TEST_MODE } from "@/config/testModeFlags";
import { CreateTestUserButton, useTestEmailsSet } from "./TestUserSection";
import { useUserAssignments } from "@/hooks/admin/useUserAssignments";

// === Extracted sub-components ===
import type { User, Role, Team, Establishment } from "./users/userHelpers";
import { STATUS_OPTIONS, getActionDialogContent } from "./users/userHelpers";
import { UserTable } from "./users/UserTable";
import { EditAssignmentsDialog, AddEstablishmentDialog } from "./users/UserFormDialog";

export function UsersManager() {
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const [statusFilter, setStatusFilter] = useState("all");
  const [isCreateUserOpen, setIsCreateUserOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    type: "accept" | "reject" | "disable" | "reactivate";
    user: User;
  } | null>(null);

  // State for edit assignments modal (Étape 46: N blocs par établissement)
  const [editUser, setEditUser] = useState<User | null>(null);
  const [assignmentsByEst, setAssignmentsByEst] = useState<
    Record<string, { roleIds: string[]; teamId: string }>
  >({});
  const [savingEstIds, setSavingEstIds] = useState<Set<string>>(new Set());

  // State for add establishment modal (Étape 45)
  const [addEstUser, setAddEstUser] = useState<User | null>(null);
  const [selectedNewEstId, setSelectedNewEstId] = useState<string>("");

  // ÉTAPE 50: Fetch scoped assignments for editUser
  const { data: userAssignmentsData } = useUserAssignments(editUser?.user_id || null);

  // SSOT: Establishment from Context only
  const { activeEstablishment } = useEstablishment();
  const selectedEstablishmentId = activeEstablishment?.id ?? null;

  // === UNE SEULE requête batch pour les emails test (au lieu de N) ===
  const { data: testEmailsSet = new Set<string>() } = useTestEmailsSet(ADMIN_TEST_MODE);

  const searchKeys: (keyof User)[] = ["full_name", "email"];

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["admin-users", statusFilter, selectedEstablishmentId],
    queryFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) throw new Error("Non authentifié");

      const response = await supabase.functions.invoke("admin-validate-users", {
        body: {
          action: "list",
          status_filter: statusFilter === "all" ? undefined : statusFilter,
          establishment_id: selectedEstablishmentId || undefined,
        },
      });

      if (response.error) throw response.error;
      return response.data.users as User[];
    },
    staleTime: 60000,
    refetchOnWindowFocus: false,
  });

  const {
    query: searchQuery,
    setQuery: setSearchQuery,
    filteredItems: filteredUsers,
  } = useListSearch(users, searchKeys);

  // Query for assignable roles (one global fetch, no N+1)
  const { data: roles = [] } = useQuery({
    queryKey: ["assignable-roles"],
    queryFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) throw new Error("Non authentifié");

      const response = await supabase.functions.invoke("admin-manage-roles", {
        body: { action: "list_roles" },
      });

      if (response.error) throw response.error;
      return (response.data.roles as Role[]).filter((r: Role) => r.name !== "Autres");
    },
    staleTime: 300000,
    refetchOnWindowFocus: false,
  });

  const acceptMutation = useMutation({
    mutationFn: async (userId: string) => {
      const response = await supabase.functions.invoke("admin-validate-users", {
        body: { action: "accept", user_id: userId },
      });
      if (response.error) throw response.error;
      if (response.data.error) throw new Error(response.data.error);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["admin-users", statusFilter, selectedEstablishmentId],
      });
      toast.success("Utilisateur accepté");
      setConfirmAction(null);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Erreur lors de l'acceptation");
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (userId: string) => {
      const response = await supabase.functions.invoke("admin-validate-users", {
        body: { action: "reject", user_id: userId },
      });
      if (response.error) throw response.error;
      if (response.data.error) throw new Error(response.data.error);
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["admin-users", statusFilter, selectedEstablishmentId],
      });
      queryClient.invalidateQueries({ queryKey: ["admin-invitations", selectedEstablishmentId] });
      queryClient.invalidateQueries({ queryKey: ["test-emails-set"] });

      let message = "Utilisateur refusé et supprimé";
      if (data.deleted_invitations_count > 0) {
        message += ` (${data.deleted_invitations_count} invitation(s) supprimée(s))`;
      }
      toast.success(message);
      setConfirmAction(null);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Erreur lors du refus");
    },
  });

  const disableMutation = useMutation({
    mutationFn: async (userId: string) => {
      const response = await supabase.functions.invoke("admin-validate-users", {
        body: { action: "disable", user_id: userId },
      });
      if (response.error) throw response.error;
      if (response.data.error) throw new Error(response.data.error);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["admin-users", statusFilter, selectedEstablishmentId],
      });
      toast.success("Utilisateur désactivé");
      setConfirmAction(null);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Erreur lors de la désactivation");
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: async (userId: string) => {
      const response = await supabase.functions.invoke("admin-validate-users", {
        body: { action: "reactivate", user_id: userId },
      });
      if (response.error) throw response.error;
      if (response.data.error) throw new Error(response.data.error);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["admin-users", statusFilter, selectedEstablishmentId],
      });
      toast.success("Utilisateur réactivé");
      setConfirmAction(null);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Erreur lors de la réactivation");
    },
  });

  // Query for teams (one global fetch)
  const { data: teams = [] } = useQuery({
    queryKey: ["admin-teams"],
    queryFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) throw new Error("Non authentifié");

      const response = await supabase.functions.invoke("admin-manage-teams", {
        body: { action: "list" },
      });

      if (response.error) throw response.error;
      return (response.data.teams as Team[]).filter(
        (t: Team & { status?: string }) => t.status === "active"
      );
    },
    staleTime: 300000,
    refetchOnWindowFocus: false,
  });

  // Mutation for setting user roles (multi-role support, scoped)
  const setRolesMutation = useMutation({
    mutationFn: async ({
      userId,
      roleIds,
      establishmentId,
    }: {
      userId: string;
      roleIds: string[];
      establishmentId: string;
    }) => {
      const response = await supabase.functions.invoke("admin-manage-roles", {
        body: {
          action: "set_user_roles",
          user_id: userId,
          role_ids: roleIds,
          establishment_id: establishmentId,
        },
      });
      if (response.error) throw response.error;
      if (response.data.error) throw new Error(response.data.error);
      return response.data;
    },
  });

  // Mutation for changing user team (scoped)
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
  });

  // Étape 45: All establishments query
  const { data: allEstablishments = [] } = useQuery({
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
    refetchOnWindowFocus: false,
  });

  const assignEstablishmentMutation = useMutation({
    mutationFn: async ({
      userId,
      establishmentId,
    }: {
      userId: string;
      establishmentId: string;
    }) => {
      const response = await supabase.functions.invoke("admin-manage-establishments", {
        body: {
          action: "assign_user_to_establishment",
          user_id: userId,
          establishment_id: establishmentId,
        },
      });
      if (response.error) throw response.error;
      if (response.data.error) throw new Error(response.data.error);
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["admin-users", statusFilter, selectedEstablishmentId],
      });
      toast.success(`Établissement "${data.establishment_name}" ajouté`);
      handleCloseAddEstablishment();
    },
    onError: (error: Error) => {
      toast.error(error.message || "Erreur lors de l'ajout");
    },
  });

  // === Handlers ===

  const handleOpenEditAssignments = (user: User) => {
    setEditUser(user);
    const initialAssignments: Record<string, { roleIds: string[]; teamId: string }> = {};
    for (const est of user.establishments) {
      initialAssignments[est.id] = {
        roleIds: user.roles.map((r) => r.id),
        teamId: user.teams?.[0]?.id || "none",
      };
    }
    setAssignmentsByEst(initialAssignments);
    setSavingEstIds(new Set());
  };

  const handleCloseEditAssignments = () => {
    setEditUser(null);
    setAssignmentsByEst({});
    setSavingEstIds(new Set());
  };

  const handleOpenAddEstablishment = (user: User) => {
    setAddEstUser(user);
    setSelectedNewEstId("");
  };

  const handleCloseAddEstablishment = () => {
    setAddEstUser(null);
    setSelectedNewEstId("");
  };

  const handleConfirmAddEstablishment = async () => {
    if (!addEstUser || !selectedNewEstId) return;
    await assignEstablishmentMutation.mutateAsync({
      userId: addEstUser.user_id,
      establishmentId: selectedNewEstId,
    });
  };

  const availableEstablishments = addEstUser
    ? allEstablishments.filter((est) => !addEstUser.establishments.some((e) => e.id === est.id))
    : [];

  const handleSaveEstablishmentAssignments = async (establishmentId: string) => {
    if (!editUser) return;

    if (!establishmentId) {
      toast.error("Aucun établissement sélectionné");
      return;
    }

    const assignment = assignmentsByEst[establishmentId];
    if (!assignment) {
      toast.error("Aucune affectation trouvée");
      return;
    }

    setSavingEstIds((prev) => new Set([...prev, establishmentId]));

    try {
      if (assignment.roleIds.length > 0) {
        await setRolesMutation.mutateAsync({
          userId: editUser.user_id,
          roleIds: assignment.roleIds,
          establishmentId,
        });
        if (import.meta.env.DEV)
          // eslint-disable-next-line no-console
          console.log(
            `[SCOPED_ROLES] user=${editUser.user_id} est=${establishmentId} roles=${assignment.roleIds.join(",")}`
          );
      }

      const teamIdForBackend = assignment.teamId === "none" ? null : assignment.teamId;
      await changeTeamMutation.mutateAsync({
        userId: editUser.user_id,
        newTeamId: teamIdForBackend,
        establishmentId,
      });
      if (import.meta.env.DEV)
        // eslint-disable-next-line no-console
        console.log(
          `[SCOPED_TEAM] user=${editUser.user_id} est=${establishmentId} team=${teamIdForBackend}`
        );

      queryClient.invalidateQueries({
        queryKey: ["admin-users", statusFilter, selectedEstablishmentId],
      });
      queryClient.invalidateQueries({ queryKey: ["admin-roles"] });
      queryClient.invalidateQueries({ queryKey: ["employees", establishmentId] });
      queryClient.invalidateQueries({ queryKey: ["my-permissions-v2"] });
      queryClient.invalidateQueries({ queryKey: ["user-assignments", editUser.user_id] });

      toast.success("Affectations enregistrées");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Erreur lors de la modification");
    } finally {
      setSavingEstIds((prev) => {
        const next = new Set(prev);
        next.delete(establishmentId);
        return next;
      });
    }
  };

  const updateEstRoleIds = (estId: string, roleIds: string[]) => {
    setAssignmentsByEst((prev) => ({
      ...prev,
      [estId]: { ...prev[estId], roleIds },
    }));
  };

  const updateEstTeamId = (estId: string, teamId: string) => {
    setAssignmentsByEst((prev) => ({
      ...prev,
      [estId]: { ...prev[estId], teamId },
    }));
  };

  const handleConfirmAction = () => {
    if (!confirmAction) return;

    switch (confirmAction.type) {
      case "accept":
        acceptMutation.mutate(confirmAction.user.user_id);
        break;
      case "reject":
        rejectMutation.mutate(confirmAction.user.user_id);
        break;
      case "disable":
        disableMutation.mutate(confirmAction.user.user_id);
        break;
      case "reactivate":
        reactivateMutation.mutate(confirmAction.user.user_id);
        break;
    }
  };

  const isPending =
    acceptMutation.isPending ||
    rejectMutation.isPending ||
    disableMutation.isPending ||
    reactivateMutation.isPending ||
    setRolesMutation.isPending ||
    changeTeamMutation.isPending;

  if (isLoading) {
    return <TableSkeleton rows={6} columns={5} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium text-foreground">Utilisateurs</h2>
        <div className="flex items-center gap-2">
          {/* === TEST MODE BUTTON (isolé pour suppression future) === */}
          {ADMIN_TEST_MODE && <CreateTestUserButton />}

          <Button onClick={() => setIsCreateUserOpen(true)} size="sm">
            <Plus className="h-4 w-4 mr-1" />
            Ajouter
          </Button>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]" aria-label="Filtrer par statut">
              <SelectValue placeholder="Filtrer par statut" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            onClick={() =>
              queryClient.invalidateQueries({
                queryKey: ["admin-users", statusFilter, selectedEstablishmentId],
              })
            }
            aria-label="Actualiser la liste des utilisateurs"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {users.length > 0 && (
        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Rechercher par nom ou email..."
        />
      )}

      {filteredUsers.length === 0 ? (
        <EmptyState
          icon={<Users className="h-12 w-12" />}
          title="Aucun utilisateur trouvé"
          description={
            searchQuery
              ? "Essayez avec un autre terme de recherche."
              : statusFilter !== "all"
                ? "Essayez de modifier le filtre de statut."
                : "Invitez des utilisateurs pour commencer."
          }
        />
      ) : (
        <UserTable
          users={filteredUsers}
          testEmailsSet={testEmailsSet}
          currentUserId={currentUser?.id}
          setConfirmAction={setConfirmAction}
          onEditAssignments={handleOpenEditAssignments}
          onAddEstablishment={handleOpenAddEstablishment}
        />
      )}

      <AlertDialog open={!!confirmAction} onOpenChange={() => setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{getActionDialogContent(confirmAction).title}</AlertDialogTitle>
            <AlertDialogDescription>
              {getActionDialogContent(confirmAction).description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmAction} disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirmer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal Modifier affectations */}
      <EditAssignmentsDialog
        editUser={editUser}
        onClose={handleCloseEditAssignments}
        assignmentsByEst={assignmentsByEst}
        savingEstIds={savingEstIds}
        roles={roles}
        teams={teams}
        userAssignmentsData={userAssignmentsData}
        onSaveEstablishmentAssignments={handleSaveEstablishmentAssignments}
        onUpdateRoleIds={updateEstRoleIds}
        onUpdateTeamId={updateEstTeamId}
      />

      {/* Modal Ajouter établissement */}
      <AddEstablishmentDialog
        addEstUser={addEstUser}
        onClose={handleCloseAddEstablishment}
        selectedNewEstId={selectedNewEstId}
        onSelectedNewEstIdChange={setSelectedNewEstId}
        availableEstablishments={availableEstablishments}
        onConfirm={handleConfirmAddEstablishment}
        isPending={assignEstablishmentMutation.isPending}
      />

      {/* Modal Créer utilisateur */}
      <CreateUserDialog open={isCreateUserOpen} onOpenChange={setIsCreateUserOpen} />
    </div>
  );
}
