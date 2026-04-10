/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MOBILE NAV CONFIG — Admin-only screen to show/hide mobile nav items
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This component allows admins to customize which RBAC-allowed items
 * are visible in mobile navigation. It does NOT grant any access.
 *
 * VISIBLE = RBAC_ALLOWED ∩ USER_PREFS
 *
 * FEATURES:
 * - Role (Preview) dropdown to simulate another role's view
 * - Tree structure with parent/children (collapsible)
 * - Locked items (greyed out) for RBAC-forbidden modules
 * - Toast on click of locked items explaining RBAC restriction
 *
 * RULES:
 * - Only shows items already allowed by RBAC
 * - Cannot make a non-allowed item visible
 * - Toggle only affects mobile display (desktop unchanged)
 * - Uses localStorage only (zero backend writes)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Eye,
  EyeOff,
  RotateCcw,
  Info,
  Lock,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useAuth } from "@/contexts/AuthContext";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { usePermissions } from "@/hooks/usePermissions";
import { type MobileNavPrefs } from "@/lib/mobileNavPrefs";
import {
  useRoleNavConfigForPreview,
  useRoleNavConfigMutation,
} from "@/hooks/useEstablishmentRoleNavConfig";
import {
  useRolesList,
  useRolePermissions,
  isModuleAllowedByRole,
} from "@/hooks/admin/useRolesPreview";
import { useTeamTabKeys } from "@/hooks/nav/useTeamTabKeys";
import { toast } from "sonner";
import { ResponsiveLayout } from "@/components/mobile/ResponsiveLayout";
import { buildNavFromPermissions, type NavPermissions } from "@/lib/nav/buildNavFromPermissions";
import type { NavItem } from "@/config/navRegistry";

const PREVIEW_MY_ROLE = "__MY_ROLE__";

/**
 * Group items by their group property for display
 */
function groupItemsBySection(items: NavItem[]): Record<string, NavItem[]> {
  const groups: Record<string, NavItem[]> = {};

  for (const item of items) {
    const group = item.group || "other";
    if (!groups[group]) {
      groups[group] = [];
    }
    groups[group].push(item);
  }

  return groups;
}

/**
 * Get French label for group
 */
function getGroupLabel(group: string): string {
  const labels: Record<string, string> = {
    main: "Modules principaux",
    rbac: "Modules avancés",
    settings: "Paramètres",
    footer: "Administration",
    other: "Autres",
  };
  return labels[group] || group;
}

interface NavItemRowProps {
  item: NavItem;
  visible: boolean;
  locked: boolean;
  onToggle: (id: string) => void;
  onLockedClick: () => void;
  isChild?: boolean;
}

/**
 * Single nav item row (reusable for parent and children)
 */
function NavItemRow({
  item,
  visible,
  locked,
  onToggle,
  onLockedClick,
  isChild = false,
}: NavItemRowProps) {
  const Icon = item.icon;

  const handleSwitchClick = () => {
    if (locked) {
      onLockedClick();
      return;
    }
    onToggle(item.id);
  };

  return (
    <div className={`flex items-center justify-between py-2 ${isChild ? "pl-8" : ""}`}>
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${locked ? "bg-muted/50" : item.tileColor || "bg-muted"}`}>
          <Icon className={`h-4 w-4 ${locked ? "text-muted-foreground/50" : ""}`} />
        </div>
        <div className="flex items-center gap-2">
          <p className={`text-sm font-medium ${locked ? "text-muted-foreground/50" : ""}`}>
            {item.label}
          </p>
          {locked && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Lock className="h-3 w-3 text-muted-foreground/50" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>Non autorisé par vos permissions (RBAC)</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {!locked &&
          (visible ? (
            <Eye className="h-4 w-4 text-muted-foreground" />
          ) : (
            <EyeOff className="h-4 w-4 text-muted-foreground" />
          ))}
        <Switch
          checked={visible && !locked}
          onCheckedChange={handleSwitchClick}
          disabled={locked}
          aria-label={`${visible ? "Masquer" : "Afficher"} ${item.label}`}
          className={locked ? "opacity-50 cursor-not-allowed" : ""}
        />
      </div>
    </div>
  );
}

interface NavItemWithChildrenProps {
  item: NavItem;
  visible: boolean;
  locked: boolean;
  onToggle: (id: string) => void;
  onLockedClick: () => void;
  isItemVisible: (id: string) => boolean;
  isItemLocked: (item: NavItem) => boolean;
}

/**
 * Nav item with collapsible children
 */
function NavItemWithChildren({
  item,
  visible,
  locked,
  onToggle,
  onLockedClick,
  isItemVisible,
  isItemLocked,
}: NavItemWithChildrenProps) {
  const [open, setOpen] = useState(true);
  const hasChildren = item.children && item.children.length > 0;

  if (!hasChildren) {
    return (
      <NavItemRow
        item={item}
        visible={visible}
        locked={locked}
        onToggle={onToggle}
        onLockedClick={onLockedClick}
      />
    );
  }

  // Check if any child is visible (for Rule A: parent without visible children → hidden)
  const visibleChildren = item.children!.filter((child) => {
    const childLocked = isItemLocked(child);
    const childVisible = isItemVisible(child.id);
    return !childLocked && childVisible;
  });

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-center justify-between py-2">
        <CollapsibleTrigger asChild>
          <button className="flex items-center gap-3 hover:bg-muted/50 rounded-lg p-1 -ml-1">
            {open ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <div
              className={`p-2 rounded-lg ${locked ? "bg-muted/50" : item.tileColor || "bg-muted"}`}
            >
              <item.icon className={`h-4 w-4 ${locked ? "text-muted-foreground/50" : ""}`} />
            </div>
            <div className="flex items-center gap-2">
              <p className={`text-sm font-medium ${locked ? "text-muted-foreground/50" : ""}`}>
                {item.label}
              </p>
              {locked && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Lock className="h-3 w-3 text-muted-foreground/50" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Non autorisé par vos permissions (RBAC)</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              <span className="text-xs text-muted-foreground">
                ({visibleChildren.length}/{item.children!.length})
              </span>
            </div>
          </button>
        </CollapsibleTrigger>
        <div className="flex items-center gap-2">
          {!locked &&
            (visible ? (
              <Eye className="h-4 w-4 text-muted-foreground" />
            ) : (
              <EyeOff className="h-4 w-4 text-muted-foreground" />
            ))}
          <Switch
            checked={visible && !locked}
            onCheckedChange={() => (locked ? onLockedClick() : onToggle(item.id))}
            disabled={locked}
            aria-label={`${visible ? "Masquer" : "Afficher"} ${item.label}`}
            className={locked ? "opacity-50 cursor-not-allowed" : ""}
          />
        </div>
      </div>
      <CollapsibleContent>
        <div className="border-l-2 border-muted ml-2 space-y-1">
          {item.children!.map((child) => {
            const childLocked = isItemLocked(child);
            const childVisible = isItemVisible(child.id);

            return (
              <NavItemRow
                key={child.id}
                item={child}
                visible={childVisible}
                locked={childLocked}
                onToggle={onToggle}
                onLockedClick={onLockedClick}
                isChild
              />
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function MobileNavConfig() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeEstablishment } = useEstablishment();
  const permissions = usePermissions();

  const _userId = user?.id ?? null;
  const _orgId = activeEstablishment?.organization_id ?? null;
  const establishmentId = activeEstablishment?.id ?? null;

  // Fetch teamTabKeys for scope=team Planning filtering (Phase 2)
  const { teamTabKeys } = useTeamTabKeys({
    establishmentId,
    teamIds: permissions.teamIds ?? [],
  });

  // Preview role state
  const [previewRoleId, setPreviewRoleId] = useState<string>(PREVIEW_MY_ROLE);

  // Fetch roles for preview dropdown
  const { data: roles = [], isLoading: rolesLoading } = useRolesList();

  // Fetch permissions for selected preview role
  const { data: previewRolePermissions = [] } = useRolePermissions(
    previewRoleId !== PREVIEW_MY_ROLE ? previewRoleId : null
  );

  const isPreviewMode = previewRoleId !== PREVIEW_MY_ROLE;

  // Load current prefs from DB (per-role)
  const activePreviewRoleId = isPreviewMode ? previewRoleId : null;
  const { prefs: dbPrefs, isLoading: navConfigLoading } = useRoleNavConfigForPreview(
    establishmentId,
    activePreviewRoleId
  );
  const navConfigMutation = useRoleNavConfigMutation(establishmentId);
  const [prefs, setPrefs] = useState<MobileNavPrefs>({ hiddenIds: [] });

  // Sync local state with DB prefs when role or data changes
  const [syncKey, setSyncKey] = useState<string | null>(null);
  const currentSyncKey = `${activePreviewRoleId ?? "my"}-${JSON.stringify(dbPrefs.hiddenIds)}`;
  if (!navConfigLoading && syncKey !== currentSyncKey) {
    setPrefs(dbPrefs);
    setSyncKey(currentSyncKey);
  }

  // Build NavPermissions with teamTabKeys for scope filtering
  const navPermissions: NavPermissions = useMemo(
    () => ({
      isAdmin: permissions.isAdmin,
      can: permissions.can,
      getScope: permissions.getScope,
      teamIds: permissions.teamIds,
      teamTabKeys,
    }),
    [permissions, teamTabKeys]
  );

  // Get all RBAC-allowed mobile items (homeTiles + bottomNav combined)
  const allowedMobileItems = useMemo(() => {
    const { mobileHomeTiles, mobileBottomNav } = buildNavFromPermissions(navPermissions);

    // Combine and deduplicate by id
    const combined = new Map<string, NavItem>();
    for (const item of [...mobileHomeTiles, ...mobileBottomNav]) {
      if (!combined.has(item.id)) {
        combined.set(item.id, item);
      }
    }

    return Array.from(combined.values()).sort((a, b) => a.order - b.order);
  }, [navPermissions]);

  // Group items for display
  const groupedItems = useMemo(() => groupItemsBySection(allowedMobileItems), [allowedMobileItems]);

  // Check if item is locked based on preview role permissions
  const isItemLocked = useCallback(
    (item: NavItem): boolean => {
      if (!isPreviewMode) return false; // No locked items when viewing "my role"

      // AdminOnly items are locked in preview mode (since preview is for non-admin roles)
      if (item.adminOnly) return true;

      // Check module permission against preview role
      if (item.moduleKey) {
        return !isModuleAllowedByRole(item.moduleKey, previewRolePermissions, "read");
      }

      return false;
    },
    [isPreviewMode, previewRolePermissions]
  );

  // Handle locked item click
  const handleLockedClick = useCallback(() => {
    toast.info("Non autorisé par les permissions (RBAC)", {
      description: "Ce module n'est pas accessible avec le rôle sélectionné.",
    });
  }, []);

  // Handle toggle — save to DB for the preview role
  const handleToggle = useCallback(
    (id: string) => {
      if (!activePreviewRoleId) {
        toast.info("Sélectionnez un rôle pour modifier la configuration");
        return;
      }

      const isCurrentlyHidden = prefs.hiddenIds.includes(id);
      const newHiddenIds = isCurrentlyHidden
        ? prefs.hiddenIds.filter((hid) => hid !== id)
        : [...prefs.hiddenIds, id];

      const newPrefs: MobileNavPrefs = { hiddenIds: newHiddenIds };
      setPrefs(newPrefs);
      navConfigMutation.mutate({ roleId: activePreviewRoleId, hiddenIds: newHiddenIds });

      toast.success(isCurrentlyHidden ? "Élément visible" : "Élément masqué");
    },
    [prefs, navConfigMutation, activePreviewRoleId]
  );

  // Handle reset — clear DB for the preview role
  const handleReset = useCallback(() => {
    if (!activePreviewRoleId) {
      toast.info("Sélectionnez un rôle pour réinitialiser");
      return;
    }
    setPrefs({ hiddenIds: [] });
    navConfigMutation.mutate({ roleId: activePreviewRoleId, hiddenIds: [] });
    toast.success("Configuration réinitialisée pour ce rôle");
  }, [navConfigMutation, activePreviewRoleId]);

  // Check if an item is currently visible (not in hiddenIds)
  const isVisible = useCallback(
    (id: string): boolean => {
      return !prefs.hiddenIds.includes(id);
    },
    [prefs.hiddenIds]
  );

  const hiddenCount = prefs.hiddenIds.length;
  const totalCount = allowedMobileItems.length;

  // Count locked items in preview mode
  const lockedCount = useMemo(() => {
    if (!isPreviewMode) return 0;
    return allowedMobileItems.filter((item) => isItemLocked(item)).length;
  }, [isPreviewMode, allowedMobileItems, isItemLocked]);

  return (
    <ResponsiveLayout hideMobileBottomNav>
      <div className="min-h-full bg-background">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-background border-b">
          <div className="flex items-center gap-3 p-4">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Retour">
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex-1">
              <h1 className="text-lg font-semibold">Configuration Mobile</h1>
              <p className="text-xs text-muted-foreground">
                {totalCount - hiddenCount} / {totalCount} éléments visibles
                {isPreviewMode && lockedCount > 0 && ` • ${lockedCount} verrouillé(s)`}
              </p>
            </div>
            {hiddenCount > 0 && (
              <Button variant="outline" size="sm" onClick={handleReset}>
                <RotateCcw className="h-4 w-4 mr-1" />
                Réinit.
              </Button>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 pb-24">
          {/* Disclaimer */}
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              Sélectionnez un rôle ci-dessous, puis activez/désactivez les onglets pour ce rôle. Un
              utilisateur multi-rôles verra un onglet si au moins un de ses rôles l'autorise
              (UNION).
            </AlertDescription>
          </Alert>

          {/* Role Preview Selector */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Configuration par rôle</CardTitle>
              <CardDescription>
                Choisissez un rôle pour configurer ses onglets mobiles. Chaque rôle a sa propre
                configuration.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Select value={previewRoleId} onValueChange={setPreviewRoleId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Sélectionner un rôle" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={PREVIEW_MY_ROLE}>Mon rôle (réel)</SelectItem>
                  <Separator className="my-1" />
                  {rolesLoading ? (
                    <SelectItem value="__loading__" disabled>
                      Chargement...
                    </SelectItem>
                  ) : (
                    roles.map((role) => (
                      <SelectItem key={role.id} value={role.id}>
                        {role.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              {isPreviewMode && (
                <p className="text-xs text-muted-foreground mt-2">
                  <Lock className="inline-block h-3 w-3 mr-1" />
                  Mode aperçu : les éléments grisés ne sont pas accessibles avec ce rôle.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Navigation Mobile</CardTitle>
              <CardDescription>
                Choisissez les éléments à afficher sur l'écran d'accueil mobile. Seuls les modules
                autorisés par vos permissions sont listés.
              </CardDescription>
            </CardHeader>
          </Card>

          {Object.entries(groupedItems).map(([group, items]) => (
            <Card key={group}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {getGroupLabel(group)}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 pt-0">
                {items.map((item, idx) => {
                  const locked = isItemLocked(item);
                  const visible = isVisible(item.id);

                  return (
                    <div key={item.id}>
                      {idx > 0 && <Separator className="my-2" />}
                      <NavItemWithChildren
                        item={item}
                        visible={visible}
                        locked={locked}
                        onToggle={handleToggle}
                        onLockedClick={handleLockedClick}
                        isItemVisible={isVisible}
                        isItemLocked={isItemLocked}
                      />
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ))}

          {allowedMobileItems.length === 0 && (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Aucun élément de navigation disponible.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </ResponsiveLayout>
  );
}
