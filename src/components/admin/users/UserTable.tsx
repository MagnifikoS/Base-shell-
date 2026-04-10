/**
 * UserTable — Table display of users with actions and status badges.
 */

import { useState, memo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Check, X, Power, PowerOff, Loader2, Pencil, Key, Plus } from "lucide-react";
import { toast } from "sonner";
import { passwordSchema } from "@/lib/schemas/common";

// === TEST MODE IMPORTS (isoles pour suppression future) ===
import { ADMIN_TEST_MODE } from "@/config/testModeFlags";
import { TestBadge, TestUserActions } from "../TestUserSection";
import type { User } from "./userHelpers";
import { formatDate } from "./userHelpers";

// === Helper: Status badge ===
const getStatusBadge = (status: string) => {
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    invited: "outline",
    requested: "outline",
    active: "default",
    disabled: "secondary",
    rejected: "destructive",
  };
  const labels: Record<string, string> = {
    invited: "Invité",
    requested: "En attente",
    active: "Actif",
    disabled: "Désactivé",
    rejected: "Refusé",
  };
  return <Badge variant={variants[status] || "secondary"}>{labels[status] || status}</Badge>;
};

// === PASSWORD RESET TEMPORAIRE (supprimable) ===
function PasswordResetField({ userId }: { userId: string }) {
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleReset = async () => {
    const validation = passwordSchema.safeParse(password);
    if (!validation.success) {
      toast.error(validation.error.issues[0].message);
      return;
    }
    setIsLoading(true);
    try {
      const response = await supabase.functions.invoke("admin-reset-password", {
        body: { user_id: userId, new_password: password },
      });
      if (response.error) throw response.error;
      if (response.data?.error) throw new Error(response.data.error);
      toast.success("Mot de passe modifié");
      setPassword("");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-1">
      <Input
        type="password"
        placeholder="Nouveau mdp"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="h-7 w-24 text-xs"
        aria-label="Nouveau mot de passe"
      />
      <Button
        variant="ghost"
        size="sm"
        onClick={handleReset}
        disabled={isLoading || !password}
        title="Réinitialiser mot de passe"
        aria-label="Réinitialiser le mot de passe"
        className="h-7 w-7 p-0"
      >
        {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Key className="h-3 w-3" />}
      </Button>
    </div>
  );
}
// === FIN PASSWORD RESET TEMPORAIRE ===

// === Composant ligne memoïsé ===
interface UserRowProps {
  user: User;
  isTestUser: boolean;
  currentUserId: string | undefined;
  setConfirmAction: (
    action: { type: "accept" | "reject" | "disable" | "reactivate"; user: User } | null
  ) => void;
  onEditAssignments: (user: User) => void;
  onAddEstablishment: (user: User) => void;
}

export const UserRow = memo(function UserRow({
  user,
  isTestUser,
  currentUserId: _currentUserId,
  setConfirmAction,
  onEditAssignments,
  onAddEstablishment,
}: UserRowProps) {
  return (
    <TableRow>
      <TableCell className="font-medium">
        {user.full_name || "—"}
        {/* === TEST MODE BADGE (isolé) === */}
        {ADMIN_TEST_MODE && isTestUser && <TestBadge />}
      </TableCell>
      <TableCell>{user.email}</TableCell>
      <TableCell>
        {user.roles.length > 0 ? user.roles.map((r) => r.name).join(", ") : "—"}
      </TableCell>
      <TableCell>
        {user.teams.length > 0 ? user.teams.map((t) => t.name).join(", ") : "—"}
      </TableCell>
      <TableCell>
        {user.establishments.length > 0 ? user.establishments.map((e) => e.name).join(", ") : "—"}
      </TableCell>
      <TableCell>{getStatusBadge(user.status)}</TableCell>
      <TableCell className="text-muted-foreground">{formatDate(user.created_at)}</TableCell>
      {/* === PASSWORD RESET COLUMN (supprimable) === */}
      <TableCell>
        <PasswordResetField userId={user.user_id} />
      </TableCell>
      {/* === FIN PASSWORD RESET COLUMN === */}
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          {user.status === "requested" && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmAction({ type: "accept", user })}
                title="Accepter"
                aria-label="Accepter l'utilisateur"
                className="text-primary hover:text-primary hover:bg-primary/10"
              >
                <Check className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmAction({ type: "reject", user })}
                title="Refuser"
                aria-label="Refuser l'utilisateur"
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <X className="h-4 w-4" />
              </Button>
            </>
          )}
          {user.status === "active" && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onAddEstablishment(user)}
                title="Ajouter établissement"
                aria-label="Ajouter un établissement"
                className="text-primary hover:text-primary hover:bg-primary/10"
              >
                <Plus className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onEditAssignments(user)}
                title="Modifier affectations"
                aria-label="Modifier les affectations"
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmAction({ type: "disable", user })}
                title="Désactiver"
                aria-label="Désactiver l'utilisateur"
              >
                <PowerOff className="h-4 w-4" />
              </Button>
            </>
          )}
          {user.status === "disabled" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmAction({ type: "reactivate", user })}
              title="Réactiver"
              aria-label="Réactiver l'utilisateur"
            >
              <Power className="h-4 w-4" />
            </Button>
          )}
          {/* === TEST MODE ACTIONS (isolé) === */}
          {ADMIN_TEST_MODE && (
            <TestUserActions
              userId={user.user_id}
              email={user.email}
              status={user.status}
              isTestUser={isTestUser}
            />
          )}
        </div>
      </TableCell>
    </TableRow>
  );
});

// === Main UserTable component ===
interface UserTableProps {
  users: User[];
  testEmailsSet: Set<string>;
  currentUserId: string | undefined;
  setConfirmAction: (
    action: { type: "accept" | "reject" | "disable" | "reactivate"; user: User } | null
  ) => void;
  onEditAssignments: (user: User) => void;
  onAddEstablishment: (user: User) => void;
}

export function UserTable({
  users,
  testEmailsSet,
  currentUserId,
  setConfirmAction,
  onEditAssignments,
  onAddEstablishment,
}: UserTableProps) {
  return (
    <div className="border rounded-lg">
      <Table aria-label="Liste des utilisateurs">
        <TableHeader>
          <TableRow>
            <TableHead>Nom</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Rôle</TableHead>
            <TableHead>Équipe(s)</TableHead>
            <TableHead>Établissement(s)</TableHead>
            <TableHead>Statut</TableHead>
            <TableHead>Créé le</TableHead>
            {/* === PASSWORD RESET HEADER (supprimable) === */}
            <TableHead>Mot de passe</TableHead>
            {/* === FIN PASSWORD RESET HEADER === */}
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => (
            <UserRow
              key={user.id}
              user={user}
              isTestUser={testEmailsSet.has(user.email.toLowerCase())}
              currentUserId={currentUserId}
              setConfirmAction={setConfirmAction}
              onEditAssignments={onEditAssignments}
              onAddEstablishment={onAddEstablishment}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
