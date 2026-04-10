import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Users, ShieldAlert, Blocks, ScrollText, Lock, LogIn, FileText, UserPlus, Trash2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { EstablishmentModulesTab } from "@/components/platform/EstablishmentModulesTab";
import { CreateUserModal } from "@/components/platform/CreateUserModal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PlatformLayout } from "@/components/platform/PlatformLayout";
import { useImpersonation } from "@/hooks/useImpersonation";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { EstablishmentProfileTab } from "@/components/platform/EstablishmentProfileTab";
import { toast } from "sonner";
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
import { supabase } from "@/integrations/supabase/client";
import {
  platformListOrganizations,
  platformListEstablishments,
  platformListEstablishmentUsers,
} from "@/lib/platform/rpcPlatform";
import type { PlatformOrgRow, PlatformEstRow, PlatformUserRow } from "@/lib/platform/rpcPlatform";

export default function PlatformEstablishmentDetail() {
  const { orgId, estId } = useParams();
  const navigate = useNavigate();
  const { startImpersonation, isStarting } = useImpersonation();
  const { establishments: contextEstablishments, setActiveEstablishment } = useEstablishment();
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PlatformUserRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const queryClient = useQueryClient();

  const handleDeleteUser = async () => {
    if (!deleteTarget || !estId) return;
    setIsDeleting(true);
    try {
      const { error } = await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", deleteTarget.user_id)
        .eq("establishment_id", estId);
      if (error) throw error;
      toast.success(`${deleteTarget.full_name || deleteTarget.email} retiré de l'établissement`);
      queryClient.invalidateQueries({ queryKey: ["platform-establishment-users", estId] });
    } catch (e: unknown) {
      toast.error("Erreur lors de la suppression : " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setIsDeleting(false);
      setDeleteTarget(null);
    }
  };

  // Org name from cache
  const { data: orgs = [] } = useQuery({
    queryKey: ["platform-organizations"],
    queryFn: platformListOrganizations,
  });
  const orgName = orgs.find((o: PlatformOrgRow) => o.id === orgId)?.name ?? "Organisation";

  // Establishment name from cache
  const { data: establishments = [] } = useQuery({
    queryKey: ["platform-establishments", orgId],
    queryFn: () => platformListEstablishments(orgId!),
    enabled: !!orgId,
  });
  const estName = establishments.find((e: PlatformEstRow) => e.id === estId)?.name ?? "Établissement";

  // Users
  const { data: users = [], isLoading: usersLoading } = useQuery({
    queryKey: ["platform-establishment-users", estId],
    queryFn: () => platformListEstablishmentUsers(estId!),
    enabled: !!estId,
  });

  const handleEnterAs = async (userId: string, userName: string) => {
    if (!estId) return;
    try {
      await startImpersonation(userId, estId);
      
      // Force switch to the target establishment in context
      const targetEst = contextEstablishments.find((e) => e.id === estId);
      if (targetEst) {
        setActiveEstablishment(targetEst);
      } else {
        // Fallback: write directly to localStorage so EstablishmentContext picks it up
        localStorage.setItem("active_establishment_id", estId);
      }
      
      toast.success(`Impersonation démarrée — Vue rôle de ${userName}`);
      navigate("/dashboard");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erreur inconnue";
      toast.error(`Impossible de démarrer l'impersonation : ${message}`);
    }
  };

  return (
    <PlatformLayout
      breadcrumbs={[
        { label: orgName, href: `/platform/org/${orgId}` },
        { label: estName },
      ]}
    >
      {/* SUPER ADMIN BANNER */}
      <div
        className="flex items-center gap-2 px-6 py-2 text-sm font-medium"
        style={{
          backgroundColor: "hsl(0 72% 51% / 0.12)",
          color: "hsl(0 72% 45%)",
          borderBottom: "1px solid hsl(0 72% 51% / 0.2)",
        }}
      >
        <ShieldAlert className="w-4 h-4" />
        MODE SUPER ADMIN — Vous visualisez cet établissement
      </div>

      <div className="p-6 md:p-8 space-y-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate(`/platform/org/${orgId}`)}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="text-xl font-bold text-foreground">{estName}</h1>
              <p className="text-sm text-muted-foreground">{orgName}</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="profile">
          <TabsList>
            <TabsTrigger value="profile" className="gap-1.5">
              <FileText className="w-3.5 h-3.5" /> Fiche établissement
            </TabsTrigger>
            <TabsTrigger value="users" className="gap-1.5">
              <Users className="w-3.5 h-3.5" /> Utilisateurs
            </TabsTrigger>
            <TabsTrigger value="roles" className="gap-1.5">
              <Lock className="w-3.5 h-3.5" /> Rôles
            </TabsTrigger>
            <TabsTrigger value="modules" className="gap-1.5">
              <Blocks className="w-3.5 h-3.5" /> Modules
            </TabsTrigger>
            <TabsTrigger value="logs" className="gap-1.5">
              <ScrollText className="w-3.5 h-3.5" /> Logs
            </TabsTrigger>
          </TabsList>

          {/* Profile */}
          <TabsContent value="profile" className="mt-4">
            {estId && (
              <EstablishmentProfileTab
                establishmentId={estId}
                establishmentName={estName}
              />
            )}
          </TabsContent>

          {/* Users */}
          <TabsContent value="users" className="mt-4">
            <Card>
              <CardContent className="pt-4 space-y-4">
                {/* Header with create button */}
                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">
                    {users.length} utilisateur{users.length !== 1 ? "s" : ""}
                  </div>
                  <Button
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setCreateUserOpen(true)}
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    {(() => {
                      // V0: detect if a "top admin" already exists
                      const adminRoleNames = ["Administrateur", "Super Admin", "Directeur"];
                      const hasAdmin = users.some((u: PlatformUserRow) =>
                        (u.role_names ?? [u.role_name]).some((r: string) =>
                          adminRoleNames.some((a) => r.toLowerCase().includes(a.toLowerCase()))
                        )
                      );
                      return hasAdmin ? "Créer un utilisateur" : "Créer compte PDG";
                    })()}
                  </Button>
                </div>

                {/* PDG exists badge */}
                {(() => {
                  const adminRoleNames = ["Administrateur", "Super Admin"];
                  const adminUser = users.find((u: PlatformUserRow) =>
                    (u.role_names ?? [u.role_name]).some((r: string) =>
                      adminRoleNames.some((a) => r.toLowerCase().includes(a.toLowerCase()))
                    )
                  );
                  if (adminUser) {
                    return (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
                        <Badge variant="secondary" className="text-xs">PDG</Badge>
                        <span>{adminUser.full_name ?? adminUser.email}</span>
                      </div>
                    );
                  }
                  return null;
                })()}

                {usersLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                  </div>
                ) : users.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">Aucun utilisateur trouvé.</p>
                ) : (
                  <div className="rounded-lg border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground">Nom</th>
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground">Email</th>
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground">Rôle(s)</th>
                          <th className="text-right px-4 py-2 font-medium text-muted-foreground">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.map((u: PlatformUserRow) => (
                          <tr key={u.user_id} className="border-b last:border-0">
                            <td className="px-4 py-2 text-foreground">{u.full_name ?? "—"}</td>
                            <td className="px-4 py-2 text-muted-foreground">{u.email}</td>
                            <td className="px-4 py-2">
                              <div className="flex flex-wrap gap-1">
                                {(u.role_names ?? [u.role_name]).map((r: string) => (
                                  <Badge key={r} variant="outline">{r}</Badge>
                                ))}
                              </div>
                            </td>
                            <td className="px-4 py-2 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="gap-1.5"
                                  onClick={() => handleEnterAs(u.user_id, u.full_name ?? u.email)}
                                  disabled={isStarting}
                                >
                                  <LogIn className="w-3.5 h-3.5" />
                                  Entrer comme
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                                  onClick={() => setDeleteTarget(u)}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Create User Modal */}
            {orgId && estId && (
              <CreateUserModal
                open={createUserOpen}
                onOpenChange={setCreateUserOpen}
                organizationId={orgId}
                establishmentId={estId}
                establishmentName={estName}
              />
            )}
          </TabsContent>

          {/* Roles - placeholder */}
          <TabsContent value="roles" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Rôles configurés</CardTitle>
              </CardHeader>
              <CardContent>
                {users.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {[...new Set(users.flatMap((u: PlatformUserRow) => u.role_names ?? [u.role_name]))].map((r) => (
                      <Badge key={r} variant="secondary">{r}</Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground">Aucun rôle trouvé.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Modules */}
          <TabsContent value="modules" className="mt-4">
            {estId && <EstablishmentModulesTab establishmentId={estId} />}
          </TabsContent>

          {/* Logs - placeholder */}
          <TabsContent value="logs" className="mt-4">
            <Card>
              <CardContent className="pt-4 text-center py-8">
                <ScrollText className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-muted-foreground">Logs — bientôt disponible</p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Delete User Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retirer cet utilisateur ?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.full_name || deleteTarget?.email}</strong> sera retiré de l'établissement{" "}
              <strong>{estName}</strong>. Son compte ne sera pas supprimé.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteUser}
              disabled={isDeleting}
              className="bg-destructive hover:bg-destructive/90"
            >
              {isDeleting ? "Suppression…" : "Retirer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PlatformLayout>
  );
}
