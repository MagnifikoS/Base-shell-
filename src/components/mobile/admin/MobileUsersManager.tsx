/**
 * Mobile Users Manager - Lightweight mobile-specific component
 * Desktop version: src/components/admin/UsersManager.tsx (unchanged)
 * Includes N-blocs per establishment (Étape 48)
 */

import { useState, memo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { toast } from "sonner";
import {
  Pencil,
  PowerOff,
  Power,
  Loader2,
  Plus,
  Check,
  X,
  Settings,
  Building2,
  Users,
} from "lucide-react";
import { MobileEditRoleDialog } from "./MobileEditRoleDialog";
import { MobileEditTeamDialog } from "./MobileEditTeamDialog";
import { useUserAssignments } from "@/hooks/admin/useUserAssignments";

interface User {
  id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  status: string;
  created_at: string;
  roles: { id: string; name: string }[];
  teams: { id: string; name: string }[];
  establishments: { id: string; name: string }[];
}

const STATUS_BADGES: Record<
  string,
  { variant: "default" | "secondary" | "destructive" | "outline"; label: string }
> = {
  invited: { variant: "outline", label: "Invité" },
  requested: { variant: "outline", label: "En attente" },
  active: { variant: "default", label: "Actif" },
  disabled: { variant: "secondary", label: "Désactivé" },
  rejected: { variant: "destructive", label: "Refusé" },
};

interface UserCardProps {
  user: User;
  onAction: (type: "accept" | "reject" | "disable" | "reactivate", user: User) => void;
  onManage: (user: User) => void;
}

const UserCard = memo(function UserCard({ user, onAction, onManage }: UserCardProps) {
  const status = STATUS_BADGES[user.status] || {
    variant: "secondary" as const,
    label: user.status,
  };

  return (
    <div className="flex items-center justify-between p-3 bg-card border border-border rounded-lg">
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">{user.full_name || "—"}</p>
        <p className="text-xs text-muted-foreground truncate">{user.email}</p>
        <Badge variant={status.variant} className="mt-1 text-xs">
          {status.label}
        </Badge>
      </div>
      <div className="flex items-center gap-1 ml-2">
        {user.status === "requested" && (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-green-600 dark:text-green-400"
              onClick={() => onAction("accept", user)}
              aria-label="Accepter l'utilisateur"
            >
              <Check className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive"
              onClick={() => onAction("reject", user)}
              aria-label="Rejeter l'utilisateur"
            >
              <X className="h-4 w-4" />
            </Button>
          </>
        )}
        {user.status === "active" && (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => onManage(user)}
              title="Gérer accès"
              aria-label="Gérer les accès"
            >
              <Settings className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => onAction("disable", user)}
              aria-label="Désactiver l'utilisateur"
            >
              <PowerOff className="h-4 w-4" />
            </Button>
          </>
        )}
        {user.status === "disabled" && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => onAction("reactivate", user)}
            aria-label="Réactiver l'utilisateur"
          >
            <Power className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
});

export function MobileUsersManager() {
  const queryClient = useQueryClient();
  const { activeEstablishment } = useEstablishment();
  const establishmentId = activeEstablishment?.id;
  const [confirmAction, setConfirmAction] = useState<{
    type: "accept" | "reject" | "disable" | "reactivate";
    user: User;
  } | null>(null);

  // State for N-blocs drawer (user management per establishment)
  const [managedUser, setManagedUser] = useState<User | null>(null);
  const [isManageDrawerOpen, setIsManageDrawerOpen] = useState(false);

  // State for scoped dialogs (roles/team per establishment)
  const [roleEdit, setRoleEdit] = useState<{
    open: boolean;
    establishmentId: string;
    establishmentName: string;
  }>({ open: false, establishmentId: "", establishmentName: "" });

  const [teamEdit, setTeamEdit] = useState<{
    open: boolean;
    establishmentId: string;
    establishmentName: string;
  }>({ open: false, establishmentId: "", establishmentName: "" });

  // ÉTAPE 50: Fetch scoped assignments for managedUser
  const { data: userAssignmentsData } = useUserAssignments(managedUser?.user_id || null);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["admin-users", "all", establishmentId],
    queryFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) throw new Error("Non authentifié");

      const response = await supabase.functions.invoke("admin-validate-users", {
        body: {
          action: "list",
          establishment_id: establishmentId || undefined,
        },
      });

      if (response.error) throw response.error;
      return response.data.users as User[];
    },
    staleTime: 60000,
    refetchOnWindowFocus: false,
  });

  const actionMutation = useMutation({
    mutationFn: async ({ action, userId }: { action: string; userId: string }) => {
      const response = await supabase.functions.invoke("admin-validate-users", {
        body: { action, user_id: userId },
      });
      if (response.error) throw response.error;
      if (response.data.error) throw new Error(response.data.error);
      return response.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      const messages: Record<string, string> = {
        accept: "Utilisateur accepté",
        reject: "Utilisateur refusé",
        disable: "Utilisateur désactivé",
        reactivate: "Utilisateur réactivé",
      };
      toast.success(messages[variables.action] || "Action effectuée");
      setConfirmAction(null);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Erreur lors de l'action");
    },
  });

  const handleConfirmAction = () => {
    if (!confirmAction) return;
    actionMutation.mutate({
      action: confirmAction.type,
      userId: confirmAction.user.user_id,
    });
  };

  const handleManageUser = (user: User) => {
    setManagedUser(user);
    setIsManageDrawerOpen(true);
  };

  const handleEditRoles = (est: { id: string; name: string }) => {
    setRoleEdit({ open: true, establishmentId: est.id, establishmentName: est.name });
  };

  const handleEditTeam = (est: { id: string; name: string }) => {
    setTeamEdit({ open: true, establishmentId: est.id, establishmentName: est.name });
  };

  const getDialogContent = () => {
    if (!confirmAction) return { title: "", description: "" };
    const name = confirmAction.user.full_name || confirmAction.user.email;
    const contents: Record<string, { title: string; description: string }> = {
      accept: { title: "Accepter", description: `Accepter ${name} ?` },
      reject: { title: "Refuser", description: `Refuser ${name} ?` },
      disable: { title: "Désactiver", description: `Désactiver ${name} ?` },
      reactivate: { title: "Réactiver", description: `Réactiver ${name} ?` },
    };
    return contents[confirmAction.type] || { title: "", description: "" };
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const establishments = managedUser?.establishments || [];

  return (
    <div className="space-y-3">
      {/* Header with create button (icon only) */}
      <div className="flex justify-end">
        <Button size="icon" className="h-9 w-9" aria-label="Ajouter un établissement">
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* Users list */}
      {users.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">Aucun utilisateur</p>
      ) : (
        <div className="space-y-2">
          {users.map((user) => (
            <UserCard
              key={user.id}
              user={user}
              onAction={(type, u) => setConfirmAction({ type, user: u })}
              onManage={handleManageUser}
            />
          ))}
        </div>
      )}

      {/* Confirmation dialog */}
      <AlertDialog open={!!confirmAction} onOpenChange={() => setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{getDialogContent().title}</AlertDialogTitle>
            <AlertDialogDescription>{getDialogContent().description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmAction} disabled={actionMutation.isPending}>
              {actionMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirmer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* N-blocs drawer for user management per establishment */}
      <Drawer
        open={isManageDrawerOpen}
        onOpenChange={(open) => {
          setIsManageDrawerOpen(open);
          if (!open) setManagedUser(null);
        }}
      >
        <DrawerContent className="max-h-[90vh]">
          <DrawerHeader>
            <DrawerTitle>Gestion des accès</DrawerTitle>
            <DrawerDescription>{managedUser?.full_name || managedUser?.email}</DrawerDescription>
          </DrawerHeader>

          <div className="px-4 pb-4 overflow-y-auto max-h-[60vh]">
            {establishments.length === 0 ? (
              <p className="text-center text-muted-foreground py-6">Aucun établissement assigné</p>
            ) : (
              <div className="space-y-3">
                {establishments.map((est) => (
                  <Card key={est.id} className="border-border">
                    <CardHeader className="pb-2 pt-3 px-3">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                        {est.name}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-3 pb-3">
                      {/* READ-ONLY: Affectations actuelles par établissement (SCOPED via ÉTAPE 50) */}
                      {(() => {
                        const scopedAssignment = userAssignmentsData?.establishments?.find(
                          (a) => a.establishment_id === est.id
                        );
                        return (
                          <div className="bg-muted/40 rounded-md p-2 mb-3 border border-border/50 space-y-1">
                            <div className="flex items-start gap-2">
                              <span className="text-xs text-muted-foreground font-medium shrink-0">
                                Rôles:
                              </span>
                              <div className="flex flex-wrap gap-1">
                                {scopedAssignment?.role_names &&
                                scopedAssignment.role_names.length > 0 ? (
                                  scopedAssignment.role_names.map((roleName, idx) => (
                                    <Badge
                                      key={idx}
                                      variant="secondary"
                                      className="text-[10px] px-1.5 py-0"
                                    >
                                      {roleName}
                                    </Badge>
                                  ))
                                ) : (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-start gap-2">
                              <span className="text-xs text-muted-foreground font-medium shrink-0">
                                Équipe:
                              </span>
                              <div className="flex flex-wrap gap-1">
                                {scopedAssignment?.team_name ? (
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                    {scopedAssignment.team_name}
                                  </Badge>
                                ) : (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Action buttons */}
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1"
                          onClick={() => handleEditRoles(est)}
                        >
                          <Pencil className="h-3 w-3 mr-1" />
                          Rôles
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1"
                          onClick={() => handleEditTeam(est)}
                        >
                          <Users className="h-3 w-3 mr-1" />
                          Équipe
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>

          <DrawerFooter>
            <DrawerClose asChild>
              <Button variant="outline">Fermer</Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* Scoped Role Dialog */}
      <MobileEditRoleDialog
        isOpen={roleEdit.open}
        onClose={() => setRoleEdit({ open: false, establishmentId: "", establishmentName: "" })}
        user={managedUser}
        establishmentId={roleEdit.establishmentId}
        establishmentName={roleEdit.establishmentName}
      />

      {/* Scoped Team Dialog */}
      <MobileEditTeamDialog
        isOpen={teamEdit.open}
        onClose={() => setTeamEdit({ open: false, establishmentId: "", establishmentName: "" })}
        user={managedUser}
        establishmentId={teamEdit.establishmentId}
        establishmentName={teamEdit.establishmentName}
      />
    </div>
  );
}
