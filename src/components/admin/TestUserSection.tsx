/**
 * TEST USER SECTION - Composant isolé pour le mode test salariés
 *
 * ISOLATION: Ce fichier peut être supprimé en un patch pour retirer
 * complètement le mode test sans impacter les modules principaux.
 */

import { useState } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { testUserSchema } from "@/lib/schemas/admin";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Copy, Trash2, UserCheck, FlaskConical } from "lucide-react";
import { ADMIN_TEST_MODE } from "@/config/testModeFlags";
import { filterAssignableRoles } from "@/lib/roles";

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

interface TestUserCreatedResponse {
  success: boolean;
  user_id: string;
  email: string;
  temp_password: string;
  message: string;
}

// Hook BATCH pour récupérer tous les emails test en une seule requête
// eslint-disable-next-line react-refresh/only-export-components
export function useTestEmailsSet(enabled = true) {
  return useQuery({
    queryKey: ["test-emails-set"],
    queryFn: async () => {
      // Récupère tous les emails test de l'org (RLS appliqué)
      const { data, error } = await supabase
        .from("invitations")
        .select("email")
        .eq("is_test", true);

      if (error) {
        if (import.meta.env.DEV) console.error("Error fetching test emails:", error);
        return new Set<string>();
      }

      return new Set((data || []).map((d) => d.email.toLowerCase()));
    },
    enabled,
    staleTime: 60000, // 60s cache
  });
}

// Hook legacy pour vérifier si un user est test (via email dans invitations avec is_test=true)
// DEPRECATED: préférer useTestEmailsSet pour éviter N+1
// eslint-disable-next-line react-refresh/only-export-components
export function useIsTestUser(email: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["is-test-user", email],
    queryFn: async () => {
      if (!email) return false;

      // On utilise une requête filtrée - RLS permet aux admins de voir les invitations de leur org
      const { data, error } = await supabase
        .from("invitations")
        .select("id, is_test")
        .eq("email", email)
        .eq("is_test", true)
        .maybeSingle();

      if (error) {
        if (import.meta.env.DEV) console.error("Error checking test user:", error);
        return false;
      }

      return !!data;
    },
    enabled: enabled && !!email,
    staleTime: 60000, // 60s cache
  });
}

// Badge TEST pour affichage dans la table
export function TestBadge() {
  return (
    <Badge
      variant="outline"
      className="ml-2 border-amber-500 text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30"
    >
      <FlaskConical className="h-3 w-3 mr-1" />
      TEST
    </Badge>
  );
}

// Bouton de création d'utilisateur test
export function CreateTestUserButton() {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [newTestUserEstablishmentId, setNewTestUserEstablishmentId] = useState("");
  const [createdUser, setCreatedUser] = useState<TestUserCreatedResponse | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Fetch roles - hooks TOUJOURS appelés avant tout return conditionnel
  // Filtrer "Autres" (rôle non-assignable)
  const { data: roles = [] } = useQuery({
    queryKey: ["admin-roles-list-assignable"],
    queryFn: async () => {
      const { data, error } = await supabase.from("roles").select("id, name").order("name");
      if (error) throw error;
      return filterAssignableRoles(data as Role[]);
    },
    enabled: ADMIN_TEST_MODE,
  });

  // Fetch active teams
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
    enabled: ADMIN_TEST_MODE,
  });

  // Fetch active establishments
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
    enabled: ADMIN_TEST_MODE,
  });

  const createMutation = useMutation({
    mutationFn: async (params: {
      email: string;
      full_name: string;
      role_id: string;
      team_id: string;
      establishment_id: string;
    }) => {
      const response = await supabase.functions.invoke("admin-create-test-user", {
        body: params,
      });
      if (response.error) throw response.error;
      if (response.data.error) throw new Error(response.data.error);
      return response.data as TestUserCreatedResponse;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      queryClient.invalidateQueries({ queryKey: ["test-emails-set"] });
      toast.success("Utilisateur test créé");
      setCreatedUser(data);
      resetForm();
    },
    onError: (error: Error) => {
      toast.error(error.message || "Erreur lors de la création");
    },
  });

  // Ne pas afficher si mode test désactivé - APRÈS tous les hooks
  if (!ADMIN_TEST_MODE) return null;

  const resetForm = () => {
    setEmail("");
    setFullName("");
    setSelectedRoleId("");
    setSelectedTeamId("");
    setNewTestUserEstablishmentId("");
    setFieldErrors({});
  };

  const handleCreate = () => {
    setFieldErrors({});

    const validation = testUserSchema.safeParse({
      email: email.trim(),
      full_name: fullName.trim(),
      role_id: selectedRoleId || undefined,
      team_id: selectedTeamId || undefined,
      establishment_id: newTestUserEstablishmentId || undefined,
    });

    if (!validation.success) {
      const errors: Record<string, string> = {};
      validation.error.issues.forEach((issue) => {
        const field = issue.path.join(".");
        if (!errors[field]) errors[field] = issue.message;
      });
      setFieldErrors(errors);
      const firstError = validation.error.issues[0]?.message;
      if (firstError) toast.error(firstError);
      return;
    }

    createMutation.mutate({
      email: email.trim(),
      full_name: fullName.trim(),
      role_id: selectedRoleId,
      team_id: selectedTeamId,
      establishment_id: newTestUserEstablishmentId,
    });
  };

  const copyPassword = () => {
    if (createdUser?.temp_password) {
      navigator.clipboard.writeText(createdUser.temp_password);
      toast.success("Mot de passe copié");
    }
  };

  const handleClose = () => {
    setIsOpen(false);
    setCreatedUser(null);
    resetForm();
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) handleClose();
        else setIsOpen(true);
      }}
    >
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="gap-2 border-amber-500 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30"
        >
          <FlaskConical className="h-4 w-4" />
          Créer salarié test
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-amber-500 dark:text-amber-400" />
            Créer un salarié test
          </DialogTitle>
          <DialogDescription>
            L'utilisateur sera créé en status "En attente" et devra être validé par un admin.
          </DialogDescription>
        </DialogHeader>

        {createdUser ? (
          <div className="space-y-4 py-4">
            <div className="p-4 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg">
              <p className="text-sm font-medium text-green-800 dark:text-green-300 mb-2">
                Utilisateur test créé avec succès !
              </p>
              <p className="text-sm text-green-700 dark:text-green-400">
                Email: <strong>{createdUser.email}</strong>
              </p>
            </div>

            <div className="p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300 mb-2">
                Mot de passe temporaire (affiché une seule fois) :
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 p-2 bg-background border rounded text-sm font-mono">
                  {createdUser.temp_password}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={copyPassword}
                  aria-label="Copier le mot de passe"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <p className="text-sm text-muted-foreground">
              N'oubliez pas de valider cet utilisateur dans l'onglet Utilisateurs pour qu'il puisse
              se connecter.
            </p>
          </div>
        ) : (
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Email *</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (fieldErrors.email) {
                    setFieldErrors((prev) => {
                      const next = { ...prev };
                      delete next.email;
                      return next;
                    });
                  }
                }}
                placeholder="email@exemple.com"
                className={fieldErrors.email ? "border-destructive" : ""}
              />
              {fieldErrors.email && <p className="text-sm text-destructive">{fieldErrors.email}</p>}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Nom complet *</label>
              <Input
                value={fullName}
                onChange={(e) => {
                  setFullName(e.target.value);
                  if (fieldErrors.full_name) {
                    setFieldErrors((prev) => {
                      const next = { ...prev };
                      delete next.full_name;
                      return next;
                    });
                  }
                }}
                placeholder="Jean Dupont"
                className={fieldErrors.full_name ? "border-destructive" : ""}
              />
              {fieldErrors.full_name && (
                <p className="text-sm text-destructive">{fieldErrors.full_name}</p>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Rôle *</label>
              <Select value={selectedRoleId} onValueChange={setSelectedRoleId}>
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner un rôle" />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Équipe *</label>
              <Select value={selectedTeamId} onValueChange={setSelectedTeamId}>
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner une équipe" />
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
            <div className="space-y-2">
              <label className="text-sm font-medium">Établissement *</label>
              <Select
                value={newTestUserEstablishmentId}
                onValueChange={setNewTestUserEstablishmentId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner un établissement" />
                </SelectTrigger>
                <SelectContent>
                  {establishments.map((est) => (
                    <SelectItem key={est.id} value={est.id}>
                      {est.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <DialogFooter>
          {createdUser ? (
            <Button onClick={handleClose}>Fermer</Button>
          ) : (
            <>
              <Button variant="outline" onClick={handleClose}>
                Annuler
              </Button>
              <Button onClick={handleCreate} disabled={createMutation.isPending} className="gap-2">
                {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Créer
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Actions pour les utilisateurs test
interface TestUserActionsProps {
  userId: string;
  email: string;
  status: string;
  isTestUser: boolean;
}

export function TestUserActions({ userId, email, status, isTestUser }: TestUserActionsProps) {
  const queryClient = useQueryClient();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [convertConfirmOpen, setConvertConfirmOpen] = useState(false);

  // Hooks TOUJOURS appelés avant tout return conditionnel
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await supabase.functions.invoke("admin-delete-test-user", {
        body: { user_id: userId },
      });
      if (response.error) throw response.error;
      if (response.data.error) throw new Error(response.data.error);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      queryClient.invalidateQueries({ queryKey: ["test-emails-set"] });
      toast.success("Utilisateur test supprimé");
      setDeleteConfirmOpen(false);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Erreur lors de la suppression");
    },
  });

  const convertMutation = useMutation({
    mutationFn: async () => {
      const response = await supabase.functions.invoke("admin-convert-test-user", {
        body: { user_id: userId },
      });
      if (response.error) throw response.error;
      if (response.data.error) throw new Error(response.data.error);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      queryClient.invalidateQueries({ queryKey: ["test-emails-set"] });
      toast.success("Utilisateur converti en réel");
      setConvertConfirmOpen(false);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Erreur lors de la conversion");
    },
  });

  // Ne pas afficher si pas un user test ou mode test désactivé - APRÈS tous les hooks
  if (!ADMIN_TEST_MODE || !isTestUser) return null;

  return (
    <>
      {/* Bouton Convertir en réel (uniquement si actif) */}
      {status === "active" && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setConvertConfirmOpen(true)}
          title="Convertir en utilisateur réel"
          className="text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:bg-green-50 dark:hover:bg-green-950/30"
        >
          <UserCheck className="h-4 w-4" />
        </Button>
      )}

      {/* Bouton Supprimer test */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setDeleteConfirmOpen(true)}
        title="Supprimer utilisateur test"
        className="text-destructive hover:text-destructive hover:bg-destructive/10"
      >
        <Trash2 className="h-4 w-4" />
      </Button>

      {/* Dialog confirmation suppression */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer l'utilisateur test</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est irréversible. L'utilisateur test <strong>{email}</strong> et toutes
              ses données seront supprimés définitivement.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="bg-destructive hover:bg-destructive/90"
            >
              {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dialog confirmation conversion */}
      <AlertDialog open={convertConfirmOpen} onOpenChange={setConvertConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Convertir en utilisateur réel</AlertDialogTitle>
            <AlertDialogDescription>
              L'utilisateur <strong>{email}</strong> ne sera plus marqué comme "test" et sera
              considéré comme un utilisateur réel.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={convertMutation.isPending}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => convertMutation.mutate()}
              disabled={convertMutation.isPending}
            >
              {convertMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Convertir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
