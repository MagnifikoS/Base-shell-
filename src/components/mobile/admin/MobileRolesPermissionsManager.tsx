/**
 * Mobile Roles & Permissions Manager - Editable version
 * Desktop reference: src/components/admin/RolesPermissionsManager.tsx
 *
 * Reuses EXACT same Edge function (admin-manage-roles) and queryKeys as desktop.
 *
 * Icons legend:
 * Access: Eye = read, Pencil = write, Ban = none
 * Scope: User = self, Users = team, Building2 = establishment, Globe = org, Wallet = caisse
 */

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Loader2,
  Shield,
  Eye,
  Pencil,
  Ban,
  User,
  Users,
  Building2,
  Globe,
  Wallet,
  HelpCircle,
  Save,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface Role {
  id: string;
  name: string;
  type: string;
  user_count: number;
}

interface Permission {
  role_id: string;
  module_key: string;
  access_level: string;
  scope: string;
  module?: {
    key: string;
    name: string;
    display_order: number;
  };
}

// Access levels cycle: none -> read -> write -> none
const ACCESS_CYCLE = ["none", "read", "write"] as const;

// Scope cycle: self -> team -> establishment -> org -> caisse_day -> caisse_month -> self
const SCOPE_CYCLE = ["self", "team", "establishment", "org", "caisse_day", "caisse_month"] as const;

function getNextAccess(current: string): string {
  const idx = ACCESS_CYCLE.indexOf(current as (typeof ACCESS_CYCLE)[number]);
  return ACCESS_CYCLE[(idx + 1) % ACCESS_CYCLE.length];
}

function getNextScope(current: string): string {
  const idx = SCOPE_CYCLE.indexOf(current as (typeof SCOPE_CYCLE)[number]);
  return SCOPE_CYCLE[(idx + 1) % SCOPE_CYCLE.length];
}

// Access level icon with touch feedback
function AccessIcon({ level, onClick }: { level: string; onClick?: () => void }) {
  const baseClasses = "h-5 w-5 transition-transform active:scale-90";
  const wrapperClasses = onClick ? "p-2 -m-2 rounded-full active:bg-muted cursor-pointer" : "";

  const icon = (() => {
    switch (level) {
      case "read":
        return <Eye className={cn(baseClasses, "text-blue-500 dark:text-blue-400")} />;
      case "write":
      case "full":
        return <Pencil className={cn(baseClasses, "text-green-500 dark:text-green-400")} />;
      case "none":
      default:
        return <Ban className={cn(baseClasses, "text-muted-foreground")} />;
    }
  })();

  return onClick ? (
    <button type="button" onClick={onClick} className={wrapperClasses} aria-label="Changer accès">
      {icon}
    </button>
  ) : (
    icon
  );
}

// Scope icon with touch feedback
function ScopeIcon({ scope, onClick }: { scope: string; onClick?: () => void }) {
  const baseClasses = "h-5 w-5 transition-transform active:scale-90";
  const wrapperClasses = onClick ? "p-2 -m-2 rounded-full active:bg-muted cursor-pointer" : "";

  const icon = (() => {
    switch (scope) {
      case "self":
        return <User className={cn(baseClasses, "text-muted-foreground")} />;
      case "team":
        return <Users className={cn(baseClasses, "text-orange-500 dark:text-orange-400")} />;
      case "establishment":
        return <Building2 className={cn(baseClasses, "text-purple-500 dark:text-purple-400")} />;
      case "org":
        return <Globe className={cn(baseClasses, "text-primary")} />;
      case "caisse_day":
      case "caisse_month":
        return <Wallet className={cn(baseClasses, "text-amber-500 dark:text-amber-400")} />;
      default:
        return <HelpCircle className={cn(baseClasses, "text-muted-foreground")} />;
    }
  })();

  return onClick ? (
    <button type="button" onClick={onClick} className={wrapperClasses} aria-label="Changer scope">
      {icon}
    </button>
  ) : (
    icon
  );
}

function RoleCard({
  role,
  isSelected,
  onSelect,
}: {
  role: Role;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full flex items-center justify-between p-3 rounded-lg border transition-colors",
        isSelected
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-card border-border hover:bg-muted"
      )}
    >
      <div className="flex items-center gap-2">
        <Shield className="h-4 w-4" />
        <span className="font-medium text-sm">{role.name}</span>
      </div>
      <div className="flex items-center gap-2">
        <Badge
          variant={role.type === "system" ? "secondary" : "outline"}
          className={cn(
            "text-xs",
            isSelected && "bg-primary-foreground/20 text-primary-foreground"
          )}
        >
          {role.type === "system" ? "Système" : "Custom"}
        </Badge>
        <span
          className={cn(
            "text-xs",
            isSelected ? "text-primary-foreground/70" : "text-muted-foreground"
          )}
        >
          {role.user_count}
        </span>
      </div>
    </button>
  );
}

interface PermissionRowProps {
  permission: Permission;
  pendingPermission?: Permission;
  onAccessChange: () => void;
  onScopeChange: () => void;
  isModified: boolean;
}

function PermissionRow({
  permission,
  pendingPermission,
  onAccessChange,
  onScopeChange,
  isModified,
}: PermissionRowProps) {
  const effective = pendingPermission || permission;

  return (
    <div
      className={cn(
        "flex items-center justify-between py-3 border-b border-border last:border-0",
        isModified && "bg-amber-50 dark:bg-amber-950/30 -mx-3 px-3"
      )}
    >
      <span className="text-sm flex-1 min-w-0 truncate">
        {permission.module?.name || permission.module_key}
      </span>
      <div className="flex items-center gap-4">
        <AccessIcon level={effective.access_level} onClick={onAccessChange} />
        <ScopeIcon scope={effective.scope} onClick={onScopeChange} />
      </div>
    </div>
  );
}

export function MobileRolesPermissionsManager() {
  const queryClient = useQueryClient();
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [pendingPermissions, setPendingPermissions] = useState<Map<string, Permission>>(new Map());

  const hasUnsavedChanges = pendingPermissions.size > 0;

  // Fetch roles - SAME queryKey as desktop
  const { data: roles = [], isLoading: rolesLoading } = useQuery({
    queryKey: ["admin-roles"],
    queryFn: async () => {
      const response = await supabase.functions.invoke("admin-manage-roles", {
        body: { action: "list_roles" },
      });
      if (response.error) throw response.error;
      return response.data.roles as Role[];
    },
    staleTime: 60000,
    refetchOnWindowFocus: false,
  });

  // Fetch permissions for selected role - SAME queryKey as desktop
  const { data: permissions = [], isLoading: permsLoading } = useQuery({
    queryKey: ["admin-role-permissions", selectedRoleId],
    queryFn: async () => {
      if (!selectedRoleId) return [];
      const response = await supabase.functions.invoke("admin-manage-roles", {
        body: { action: "get_role_permissions", role_id: selectedRoleId },
      });
      if (response.error) throw response.error;
      return response.data.permissions as Permission[];
    },
    enabled: !!selectedRoleId,
    staleTime: 60000,
    refetchOnWindowFocus: false,
  });

  // Save permissions mutation - EXACT same as desktop
  const savePermsMutation = useMutation({
    mutationFn: async (perms: Permission[]) => {
      const response = await supabase.functions.invoke("admin-manage-roles", {
        body: {
          action: "set_role_permissions",
          role_id: selectedRoleId,
          permissions: perms.map((p) => ({
            module_key: p.module_key,
            access_level: p.access_level,
            scope: p.scope,
          })),
        },
      });
      if (response.error) throw response.error;
      if (response.data.error) throw new Error(response.data.error);
      return response.data;
    },
    onSuccess: () => {
      // SAME queryKeys as desktop — V2 invalidation (Phase 2 / Étape 28)
      queryClient.invalidateQueries({ queryKey: ["admin-role-permissions", selectedRoleId] });
      queryClient.invalidateQueries({ queryKey: ["my-permissions-v2"] });
      toast.success("Permissions mises à jour");
      setPendingPermissions(new Map());
    },
    onError: (error: Error) => {
      toast.error(error.message || "Erreur lors de la sauvegarde");
    },
  });

  const handlePermissionChange = useCallback(
    (moduleKey: string, field: "access_level" | "scope", currentValue: string) => {
      const newValue =
        field === "access_level" ? getNextAccess(currentValue) : getNextScope(currentValue);

      const existingPerm = permissions.find((p) => p.module_key === moduleKey);
      const pending = pendingPermissions.get(moduleKey) || { ...existingPerm };

      const updated: Permission = {
        role_id: selectedRoleId!,
        module_key: moduleKey,
        access_level:
          field === "access_level"
            ? newValue
            : pending?.access_level || existingPerm?.access_level || "none",
        scope: field === "scope" ? newValue : pending?.scope || existingPerm?.scope || "self",
        module: existingPerm?.module,
      };

      const newPending = new Map(pendingPermissions);
      newPending.set(moduleKey, updated);
      setPendingPermissions(newPending);
    },
    [permissions, pendingPermissions, selectedRoleId]
  );

  const handleSavePermissions = useCallback(() => {
    const allPerms = permissions.map((p) => {
      const pending = pendingPermissions.get(p.module_key);
      return pending || p;
    });
    savePermsMutation.mutate(allPerms);
  }, [permissions, pendingPermissions, savePermsMutation]);

  const handleCancelChanges = useCallback(() => {
    setPendingPermissions(new Map());
  }, []);

  const handleSelectRole = useCallback(
    (roleId: string) => {
      if (hasUnsavedChanges) {
        if (!confirm("Modifications non sauvegardées. Abandonner ?")) {
          return;
        }
      }
      setPendingPermissions(new Map());
      setSelectedRoleId(roleId);
    },
    [hasUnsavedChanges]
  );

  if (rolesLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Roles list */}
      <div className="space-y-2">
        {roles.map((role) => (
          <RoleCard
            key={role.id}
            role={role}
            isSelected={selectedRoleId === role.id}
            onSelect={() => handleSelectRole(role.id)}
          />
        ))}
      </div>

      {/* Permissions for selected role */}
      {selectedRoleId && (
        <div className="border border-border rounded-lg p-3 bg-card">
          {permsLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : permissions.length === 0 ? (
            <p className="text-center text-muted-foreground text-sm py-4">Aucune permission</p>
          ) : (
            <div>
              {/* Legend */}
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-border">
                <span className="text-xs text-muted-foreground">Tap pour modifier</span>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Eye className="h-3 w-3" /> Accès
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Users className="h-3 w-3" /> Scope
                  </div>
                </div>
              </div>

              {/* Permission rows */}
              {permissions.map((perm) => {
                const pendingPerm = pendingPermissions.get(perm.module_key);
                const effective = pendingPerm || perm;

                return (
                  <PermissionRow
                    key={perm.module_key}
                    permission={perm}
                    pendingPermission={pendingPerm}
                    isModified={!!pendingPerm}
                    onAccessChange={() =>
                      handlePermissionChange(
                        perm.module_key,
                        "access_level",
                        effective.access_level
                      )
                    }
                    onScopeChange={() =>
                      handlePermissionChange(perm.module_key, "scope", effective.scope)
                    }
                  />
                );
              })}

              {/* Save/Cancel buttons */}
              {hasUnsavedChanges && (
                <div className="flex items-center justify-end gap-2 mt-4 pt-3 border-t border-border">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCancelChanges}
                    disabled={savePermsMutation.isPending}
                  >
                    <X className="h-4 w-4 mr-1" />
                    Annuler
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSavePermissions}
                    disabled={savePermsMutation.isPending}
                  >
                    {savePermsMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4 mr-1" />
                    )}
                    Enregistrer
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
