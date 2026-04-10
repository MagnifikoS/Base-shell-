import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isRoleAssignable } from "@/lib/roles";
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
import { Plus, Trash2, Loader2, Shield, Edit2, Save, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { createRoleSchema, editRoleNameSchema } from "@/lib/schemas/admin";
import {
  type Role,
  type Permission,
  ACCESS_LEVELS,
  SCOPES,
  CAISSE_SCOPES,
  useRoles,
  useRolePermissions,
  useCreateRole,
  useUpdateRole,
  useDeleteRole,
  useDeleteCancelInvitations,
  useSavePermissions,
} from "./useRolesPermissions";

export function RolesPermissionsManager() {
  const _queryClient = useQueryClient();
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<{
    role: Role;
    replacementRoleId?: string;
    invitationCount?: number;
    userCount?: number;
    showInvitationOptions?: boolean;
    depsLoaded?: boolean;
  } | null>(null);
  const [loadingDeps, setLoadingDeps] = useState(false);
  const [pendingPermissions, setPendingPermissions] = useState<Map<string, Permission>>(new Map());
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [createRoleError, setCreateRoleError] = useState<string | null>(null);
  const [editNameError, setEditNameError] = useState<string | null>(null);

  // Fetch role dependencies when modal opens
  useEffect(() => {
    if (!deleteConfirm || deleteConfirm.depsLoaded) return;

    const fetchDeps = async () => {
      setLoadingDeps(true);
      try {
        const response = await supabase.functions.invoke("admin-manage-roles", {
          body: { action: "check_role_dependencies", role_id: deleteConfirm.role.id },
        });

        if (response.error) {
          if (import.meta.env.DEV)
            console.error("Error fetching role dependencies:", response.error);
          toast.error("Erreur lors de la vérification des dépendances");
          setDeleteConfirm(null);
          return;
        }

        const { user_count, invitation_count } = response.data;
        setDeleteConfirm({
          ...deleteConfirm,
          userCount: user_count || 0,
          invitationCount: invitation_count || 0,
          showInvitationOptions: user_count === 0 && invitation_count > 0,
          depsLoaded: true,
        });
      } catch (err) {
        if (import.meta.env.DEV) console.error("Error fetching role dependencies:", err);
        toast.error("Erreur lors de la vérification des dépendances");
        setDeleteConfirm(null);
      } finally {
        setLoadingDeps(false);
      }
    };

    fetchDeps();
  }, [deleteConfirm]);

  // Extracted hooks
  const { data: roles = [], isLoading: rolesLoading } = useRoles();
  const { data: permissions = [], isLoading: permsLoading } = useRolePermissions(selectedRoleId);

  const selectedRole = roles.find((r) => r.id === selectedRoleId);

  // Mutations
  const createMutation = useCreateRole();
  const updateRoleMutation = useUpdateRole();
  const deleteMutation = useDeleteRole();
  const deleteCancelInvitationsMutation = useDeleteCancelInvitations();
  const savePermsMutation = useSavePermissions(selectedRoleId);

  const handlePermissionChange = (
    moduleKey: string,
    field: "access_level" | "scope",
    value: string
  ) => {
    const existingPerm = permissions.find((p) => p.module_key === moduleKey);
    const pending = pendingPermissions.get(moduleKey) || { ...existingPerm };

    const updated: Permission = {
      role_id: selectedRoleId!,
      module_key: moduleKey,
      access_level:
        field === "access_level"
          ? value
          : pending?.access_level || existingPerm?.access_level || "none",
      scope: field === "scope" ? value : pending?.scope || existingPerm?.scope || "self",
      module: existingPerm?.module,
    };

    const newPending = new Map(pendingPermissions);
    newPending.set(moduleKey, updated);
    setPendingPermissions(newPending);
    setHasUnsavedChanges(true);
  };

  const getEffectivePermission = (moduleKey: string): Permission | undefined => {
    return pendingPermissions.get(moduleKey) || permissions.find((p) => p.module_key === moduleKey);
  };

  const handleSavePermissions = () => {
    const allPerms = permissions.map((p) => {
      const pending = pendingPermissions.get(p.module_key);
      return pending || p;
    });
    savePermsMutation.mutate(allPerms, {
      onSuccess: () => {
        setPendingPermissions(new Map());
        setHasUnsavedChanges(false);
      },
    });
  };

  const handleCancelChanges = () => {
    setPendingPermissions(new Map());
    setHasUnsavedChanges(false);
  };

  const handleSelectRole = (roleId: string) => {
    if (hasUnsavedChanges) {
      if (!confirm("Vous avez des modifications non sauvegardées. Voulez-vous les abandonner ?")) {
        return;
      }
    }
    setPendingPermissions(new Map());
    setHasUnsavedChanges(false);
    setSelectedRoleId(roleId);
    setIsEditingName(false);
  };

  const handleStartEditName = () => {
    if (selectedRole) {
      setEditedName(selectedRole.name);
      setIsEditingName(true);
    }
  };

  const handleSaveName = () => {
    setEditNameError(null);
    const result = editRoleNameSchema.safeParse({ name: editedName.trim() });
    if (!result.success) {
      setEditNameError(result.error.issues[0]?.message || "Nom invalide");
      return;
    }
    if (selectedRole) {
      updateRoleMutation.mutate(
        { roleId: selectedRole.id, name: editedName.trim() },
        { onSuccess: () => setIsEditingName(false) }
      );
    }
  };

  const handleCreateRole = () => {
    setCreateRoleError(null);
    const result = createRoleSchema.safeParse({ name: newRoleName.trim() });
    if (!result.success) {
      setCreateRoleError(result.error.issues[0]?.message || "Nom invalide");
      return;
    }
    createMutation.mutate(newRoleName.trim(), {
      onSuccess: (newRole) => {
        setIsCreateOpen(false);
        setNewRoleName("");
        setSelectedRoleId(newRole.id);
      },
    });
  };

  if (rolesLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium text-foreground">Rôles & Permissions</h2>
        <Button size="sm" className="gap-2" onClick={() => setIsCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          Nouveau rôle
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Roles list */}
        <div className="border rounded-lg p-4 space-y-2">
          <h3 className="font-medium text-sm text-muted-foreground mb-3">Rôles</h3>
          {roles.map((role) => (
            <button
              key={role.id}
              onClick={() => handleSelectRole(role.id)}
              className={cn(
                "w-full text-left px-3 py-2 rounded-md transition-colors flex items-center justify-between",
                selectedRoleId === role.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"
              )}
            >
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4" />
                <span className="font-medium">{role.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant={role.type === "system" ? "secondary" : "outline"}
                  className={cn(
                    "text-xs",
                    selectedRoleId === role.id && "bg-primary-foreground/20 text-primary-foreground"
                  )}
                >
                  {role.type === "system" ? "Système" : "Custom"}
                </Badge>
                <span className="text-xs opacity-70">{role.user_count}</span>
              </div>
            </button>
          ))}
        </div>

        {/* Role details */}
        <div className="lg:col-span-2 border rounded-lg p-4">
          {selectedRole ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                {isEditingName && selectedRole.type === "custom" ? (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <Input
                        value={editedName}
                        onChange={(e) => {
                          setEditedName(e.target.value);
                          setEditNameError(null);
                        }}
                        className={cn("w-48", editNameError && "border-destructive")}
                        maxLength={50}
                        aria-label="Nom du rôle"
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleSaveName}
                        disabled={updateRoleMutation.isPending}
                        aria-label="Enregistrer le nom du rôle"
                      >
                        <Save className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setIsEditingName(false);
                          setEditNameError(null);
                        }}
                        aria-label="Annuler la modification"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    {editNameError && <p className="text-sm text-destructive">{editNameError}</p>}
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold">{selectedRole.name}</h3>
                    {selectedRole.type === "custom" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleStartEditName}
                        aria-label="Modifier le nom du rôle"
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  {selectedRole.name !== "Administrateur" && (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setDeleteConfirm({ role: selectedRole })}
                      aria-label="Supprimer le rôle"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Badge variant={selectedRole.type === "system" ? "secondary" : "outline"}>
                  {selectedRole.type === "system" ? "Rôle système" : "Rôle personnalisé"}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {selectedRole.user_count} utilisateur{selectedRole.user_count !== 1 ? "s" : ""}
                </span>
              </div>

              {/* Permissions table */}
              <div className="mt-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium">Permissions par module</h4>
                  {hasUnsavedChanges && (
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={handleCancelChanges}>
                        Annuler
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleSavePermissions}
                        disabled={savePermsMutation.isPending}
                      >
                        {savePermsMutation.isPending && (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        )}
                        Sauvegarder
                      </Button>
                    </div>
                  )}
                </div>

                {permsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Module</TableHead>
                          <TableHead>Niveau d'accès</TableHead>
                          <TableHead>Portée</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {permissions.map((perm) => {
                          const effective = getEffectivePermission(perm.module_key);
                          const hasChange = pendingPermissions.has(perm.module_key);
                          return (
                            <TableRow
                              key={perm.module_key}
                              className={hasChange ? "bg-muted/50" : ""}
                            >
                              <TableCell className="font-medium">
                                {perm.module?.name || perm.module_key}
                              </TableCell>
                              <TableCell>
                                <Select
                                  value={
                                    effective?.access_level === "full"
                                      ? "write"
                                      : effective?.access_level || "none"
                                  }
                                  onValueChange={(v) =>
                                    handlePermissionChange(perm.module_key, "access_level", v)
                                  }
                                >
                                  <SelectTrigger className="w-32">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {ACCESS_LEVELS.map((al) => (
                                      <SelectItem key={al.value} value={al.value}>
                                        {al.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </TableCell>
                              <TableCell>
                                <Select
                                  value={
                                    effective?.scope ||
                                    (perm.module_key === "caisse" ? "caisse_day" : "self")
                                  }
                                  onValueChange={(v) =>
                                    handlePermissionChange(perm.module_key, "scope", v)
                                  }
                                >
                                  <SelectTrigger className="w-36">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {(perm.module_key === "caisse" ? CAISSE_SCOPES : SCOPES).map(
                                      (s) => (
                                        <SelectItem key={s.value} value={s.value}>
                                          {s.label}
                                        </SelectItem>
                                      )
                                    )}
                                  </SelectContent>
                                </Select>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Shield className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground">
                Sélectionnez un rôle pour voir ses permissions
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Create role dialog */}
      <Dialog
        open={isCreateOpen}
        onOpenChange={(open) => {
          setIsCreateOpen(open);
          if (!open) setCreateRoleError(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Créer un rôle</DialogTitle>
            <DialogDescription>
              Créez un nouveau rôle personnalisé pour votre organisation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label htmlFor="role-name" className="text-sm font-medium">
                Nom du rôle *
              </label>
              <Input
                id="role-name"
                value={newRoleName}
                onChange={(e) => {
                  setNewRoleName(e.target.value);
                  setCreateRoleError(null);
                }}
                placeholder="Ex: Chef de cuisine"
                maxLength={50}
                className={createRoleError ? "border-destructive" : ""}
              />
              {createRoleError && (
                <p className="text-sm text-destructive mt-1">{createRoleError}</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              Annuler
            </Button>
            <Button
              onClick={handleCreateRole}
              disabled={createMutation.isPending || !newRoleName.trim()}
            >
              {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Créer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete role dialog */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer le rôle "{deleteConfirm?.role.name}"</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                {loadingDeps || !deleteConfirm?.depsLoaded ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    <span className="ml-2 text-muted-foreground">
                      Vérification des dépendances...
                    </span>
                  </div>
                ) : deleteConfirm?.userCount && deleteConfirm.userCount > 0 ? (
                  <>
                    <p>Ce rôle est assigné à {deleteConfirm.userCount} utilisateur(s).</p>
                    <p className="mt-2">Sélectionnez un rôle de remplacement :</p>
                    <div className="mt-4">
                      <Select
                        value={deleteConfirm.replacementRoleId || ""}
                        onValueChange={(v) =>
                          setDeleteConfirm({ ...deleteConfirm, replacementRoleId: v })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Sélectionner un rôle" />
                        </SelectTrigger>
                        <SelectContent>
                          {roles
                            .filter(
                              (r) =>
                                r.id !== deleteConfirm.role.id &&
                                isRoleAssignable(r.name) &&
                                r.name !== "Administrateur"
                            )
                            .map((r) => (
                              <SelectItem key={r.id} value={r.id}>
                                {r.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                ) : deleteConfirm?.showInvitationOptions &&
                  deleteConfirm?.invitationCount &&
                  deleteConfirm.invitationCount > 0 ? (
                  <>
                    <p>
                      Ce rôle est utilisé dans {deleteConfirm.invitationCount} invitation(s) en
                      cours.
                    </p>
                    <p className="mt-2">Choisissez une option :</p>
                    <div className="mt-4 space-y-3">
                      <div className="p-3 border rounded-lg">
                        <p className="font-medium text-sm">
                          Option A : Remplacer le rôle dans les invitations
                        </p>
                        <div className="mt-2">
                          <Select
                            value={deleteConfirm.replacementRoleId || ""}
                            onValueChange={(v) =>
                              setDeleteConfirm({ ...deleteConfirm, replacementRoleId: v })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Sélectionner un rôle de remplacement" />
                            </SelectTrigger>
                            <SelectContent>
                              {roles
                                .filter(
                                  (r) =>
                                    r.id !== deleteConfirm.role.id &&
                                    isRoleAssignable(r.name) &&
                                    r.name !== "Administrateur"
                                )
                                .map((r) => (
                                  <SelectItem key={r.id} value={r.id}>
                                    {r.name}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="p-3 border rounded-lg border-destructive/50 bg-destructive/5">
                        <p className="font-medium text-sm">
                          Option B : Supprimer les invitations et le rôle
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Les {deleteConfirm.invitationCount} invitation(s) seront définitivement
                          supprimées.
                        </p>
                        <Button
                          variant="destructive"
                          size="sm"
                          className="mt-2"
                          onClick={() =>
                            deleteCancelInvitationsMutation.mutate(
                              { role_id: deleteConfirm.role.id },
                              {
                                onSuccess: (data) => {
                                  if (
                                    data &&
                                    "__error" in data &&
                                    (data as { __error: boolean }).__error
                                  ) {
                                    toast.error(
                                      (data as { message?: string }).message ||
                                        "Erreur lors de la suppression"
                                    );
                                    return;
                                  }
                                  const count =
                                    (data as Record<string, unknown>)?.deleted_invitations_count ||
                                    0;
                                  toast.success(
                                    `Rôle supprimé. ${count} invitation(s) supprimée(s).`
                                  );
                                  setDeleteConfirm(null);
                                  if (selectedRoleId === deleteConfirm.role.id) {
                                    setSelectedRoleId(null);
                                  }
                                },
                              }
                            )
                          }
                          disabled={deleteCancelInvitationsMutation.isPending}
                        >
                          {deleteCancelInvitationsMutation.isPending && (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          )}
                          Supprimer invitations et rôle
                        </Button>
                      </div>
                    </div>
                  </>
                ) : (
                  <p>Cette action est irréversible. Voulez-vous continuer ?</p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={
                deleteMutation.isPending || deleteCancelInvitationsMutation.isPending || loadingDeps
              }
            >
              Annuler
            </AlertDialogCancel>
            {deleteConfirm?.depsLoaded && !deleteConfirm?.showInvitationOptions && (
              <AlertDialogAction
                onClick={() => {
                  if (!deleteConfirm) return;
                  deleteMutation.mutate(
                    {
                      roleId: deleteConfirm.role.id,
                      replacementRoleId: deleteConfirm.replacementRoleId,
                    },
                    {
                      onSuccess: (result) => {
                        if (
                          "__requiresReplacement" in result &&
                          result.__requiresReplacement &&
                          deleteConfirm
                        ) {
                          setDeleteConfirm({
                            ...deleteConfirm,
                            userCount: result.user_count || 0,
                            invitationCount: result.invitation_count || 0,
                            showInvitationOptions:
                              (result.user_count || 0) === 0 && (result.invitation_count || 0) > 0,
                          });
                          if ((result.user_count || 0) > 0) {
                            toast.error(
                              "Ce rôle a des utilisateurs assignés. Sélectionnez un rôle de remplacement."
                            );
                          }
                          return;
                        }

                        if ("__error" in result && result.__error) {
                          toast.error(result.message || "Erreur lors de la suppression");
                          return;
                        }

                        toast.success("Rôle supprimé");
                        setDeleteConfirm(null);
                        if (selectedRoleId === deleteConfirm?.role.id) {
                          setSelectedRoleId(null);
                        }
                      },
                    }
                  );
                }}
                disabled={
                  deleteMutation.isPending ||
                  (deleteConfirm != null &&
                    (deleteConfirm.userCount ?? 0) > 0 &&
                    !deleteConfirm.replacementRoleId)
                }
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Supprimer
              </AlertDialogAction>
            )}
            {deleteConfirm?.depsLoaded &&
              deleteConfirm?.showInvitationOptions &&
              deleteConfirm.replacementRoleId && (
                <AlertDialogAction
                  onClick={() => {
                    if (deleteConfirm) {
                      deleteMutation.mutate(
                        {
                          roleId: deleteConfirm.role.id,
                          replacementRoleId: deleteConfirm.replacementRoleId,
                        },
                        {
                          onSuccess: (result) => {
                            if ("__error" in result && result.__error) {
                              toast.error(result.message || "Erreur lors de la suppression");
                              return;
                            }
                            toast.success("Rôle supprimé");
                            setDeleteConfirm(null);
                            if (selectedRoleId === deleteConfirm.role.id) {
                              setSelectedRoleId(null);
                            }
                          },
                        }
                      );
                    }
                  }}
                  disabled={deleteMutation.isPending}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Remplacer et supprimer
                </AlertDialogAction>
              )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
