/**
 * UserFormDialog — Dialogs for editing user assignments and adding establishments.
 */

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import type { User, Role, Team, Establishment } from "./userHelpers";
import type { EstablishmentAssignment } from "@/hooks/admin/useUserAssignments";

// ═══════════════════════════════════════════════════════════════════════════
// Edit Assignments Dialog (N blocs par établissement — Étape 46)
// ═══════════════════════════════════════════════════════════════════════════

interface EditAssignmentsDialogProps {
  editUser: User | null;
  onClose: () => void;
  assignmentsByEst: Record<string, { roleIds: string[]; teamId: string }>;
  savingEstIds: Set<string>;
  roles: Role[];
  teams: Team[];
  userAssignmentsData: { establishments?: EstablishmentAssignment[] } | undefined;
  onSaveEstablishmentAssignments: (establishmentId: string) => void;
  onUpdateRoleIds: (estId: string, roleIds: string[]) => void;
  onUpdateTeamId: (estId: string, teamId: string) => void;
}

export function EditAssignmentsDialog({
  editUser,
  onClose,
  assignmentsByEst,
  savingEstIds,
  roles,
  teams,
  userAssignmentsData,
  onSaveEstablishmentAssignments,
  onUpdateRoleIds,
  onUpdateTeamId,
}: EditAssignmentsDialogProps) {
  return (
    <Dialog open={!!editUser} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Modifier affectations</DialogTitle>
          <DialogDescription>
            Modifier les rôles et équipes de {editUser?.full_name || editUser?.email} pour chaque
            établissement
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-6">
          {editUser?.establishments.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">
              Aucun établissement assigné à cet utilisateur.
            </p>
          ) : (
            editUser?.establishments.map((est) => {
              const assignment = assignmentsByEst[est.id] || { roleIds: [], teamId: "none" };
              const isSaving = savingEstIds.has(est.id);

              return (
                <div key={est.id} className="border rounded-lg p-4 space-y-4">
                  {/* Établissement Header */}
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium text-foreground">{est.name}</h4>
                    <Button
                      size="sm"
                      onClick={() => onSaveEstablishmentAssignments(est.id)}
                      disabled={isSaving || assignment.roleIds.length === 0}
                    >
                      {isSaving && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                      Enregistrer
                    </Button>
                  </div>

                  {/* READ-ONLY: Affectations actuelles (SCOPED via ÉTAPE 50) */}
                  {(() => {
                    const scopedAssignment = userAssignmentsData?.establishments?.find(
                      (a) => a.establishment_id === est.id
                    );
                    return (
                      <div className="bg-muted/40 rounded-md p-2 text-xs space-y-1 border border-border/50">
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground font-medium w-14">Rôles:</span>
                          <span className="text-foreground">
                            {scopedAssignment?.role_names && scopedAssignment.role_names.length > 0
                              ? scopedAssignment.role_names.join(", ")
                              : "—"}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground font-medium w-14">Équipe:</span>
                          <span className="text-foreground">
                            {scopedAssignment?.team_name || "—"}
                          </span>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Rôles (multi-select) */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Rôles</label>
                    <div className="border rounded-md p-3 space-y-2 max-h-32 overflow-y-auto bg-muted/30">
                      {roles.map((role) => {
                        const isChecked = assignment.roleIds.includes(role.id);
                        return (
                          <label
                            key={role.id}
                            className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 p-1 rounded"
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  onUpdateRoleIds(est.id, [...assignment.roleIds, role.id]);
                                } else {
                                  onUpdateRoleIds(
                                    est.id,
                                    assignment.roleIds.filter((id) => id !== role.id)
                                  );
                                }
                              }}
                              className="h-4 w-4 rounded border-input"
                            />
                            <span className="text-sm">{role.name}</span>
                          </label>
                        );
                      })}
                    </div>
                    {assignment.roleIds.length === 0 && (
                      <p className="text-xs text-destructive">Au moins un rôle requis</p>
                    )}
                  </div>

                  {/* Équipe (single select) */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Équipe</label>
                    <Select
                      value={assignment.teamId}
                      onValueChange={(value) => onUpdateTeamId(est.id, value)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Aucune équipe" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Aucune équipe</SelectItem>
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
            })
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fermer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Add Establishment Dialog (Étape 45)
// ═══════════════════════════════════════════════════════════════════════════

interface AddEstablishmentDialogProps {
  addEstUser: User | null;
  onClose: () => void;
  selectedNewEstId: string;
  onSelectedNewEstIdChange: (id: string) => void;
  availableEstablishments: Establishment[];
  onConfirm: () => void;
  isPending: boolean;
}

export function AddEstablishmentDialog({
  addEstUser,
  onClose,
  selectedNewEstId,
  onSelectedNewEstIdChange,
  availableEstablishments,
  onConfirm,
  isPending,
}: AddEstablishmentDialogProps) {
  return (
    <Dialog open={!!addEstUser} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ajouter un établissement</DialogTitle>
          <DialogDescription>
            Ajouter {addEstUser?.full_name || addEstUser?.email} à un nouvel établissement
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Établissement</label>
            <Select value={selectedNewEstId} onValueChange={onSelectedNewEstIdChange}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Sélectionner un établissement" />
              </SelectTrigger>
              <SelectContent>
                {availableEstablishments.length === 0 ? (
                  <SelectItem value="none" disabled>
                    Aucun établissement disponible
                  </SelectItem>
                ) : (
                  availableEstablishments.map((est) => (
                    <SelectItem key={est.id} value={est.id}>
                      {est.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            {availableEstablishments.length === 0 && addEstUser && (
              <p className="text-xs text-muted-foreground">
                Cet utilisateur est déjà assigné à tous les établissements.
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Annuler
          </Button>
          <Button onClick={onConfirm} disabled={isPending || !selectedNewEstId}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Ajouter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
