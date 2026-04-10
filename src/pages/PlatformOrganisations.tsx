import { PlatformLayout } from "@/components/platform/PlatformLayout";
import { PlatformCreateOrgWizard } from "@/components/platform/PlatformCreateOrgWizard";
import { Building2, Search, Plus, Pencil, Check, X, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useState, useMemo } from "react";
import { platformListOrganizations, platformRenameOrganization, platformDeleteOrganization } from "@/lib/platform/rpcPlatform";
import type { PlatformOrgRow } from "@/lib/platform/rpcPlatform";
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

export default function PlatformOrganisations() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const queryClient = useQueryClient();

  const [deleteTarget, setDeleteTarget] = useState<PlatformOrgRow | null>(null);

  const { data: orgs = [], isLoading } = useQuery({
    queryKey: ["platform-organizations"],
    queryFn: platformListOrganizations,
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => platformRenameOrganization(id, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-organizations"] });
      queryClient.invalidateQueries({ queryKey: ["platform-kpis"] });
      toast.success("Organisation renommée");
      setEditingId(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => platformDeleteOrganization(id),
    onSuccess: (_, _id) => {
      queryClient.invalidateQueries({ queryKey: ["platform-organizations"] });
      queryClient.invalidateQueries({ queryKey: ["platform-kpis"] });
      toast.success("Organisation supprimée");
      setDeleteTarget(null);
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setDeleteTarget(null);
    },
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return orgs;
    const q = search.toLowerCase();
    return orgs.filter((o: PlatformOrgRow) => o.name.toLowerCase().includes(q));
  }, [orgs, search]);

  const startEditing = (org: PlatformOrgRow, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(org.id);
    setEditName(org.name);
  };

  const confirmRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (editingId && editName.trim()) {
      renameMutation.mutate({ id: editingId, name: editName.trim() });
    }
  };

  const cancelEditing = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(null);
  };

  return (
    <PlatformLayout breadcrumbs={[{ label: "Organisations" }]}>
      <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h1 className="text-2xl font-bold text-foreground">Organisations</h1>
          <div className="flex items-center gap-3">
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Rechercher…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Button className="gap-1.5" onClick={() => setWizardOpen(true)}>
              <Plus className="w-4 h-4" /> Nouvelle organisation
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-muted-foreground text-center py-12">Aucune organisation trouvée.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filtered.map((org: PlatformOrgRow) => (
              <Card key={org.id} className="group hover:shadow-md transition-shadow cursor-pointer" onClick={() => editingId !== org.id && navigate(`/platform/org/${org.id}`)}>
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Building2 className="w-5 h-5 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        {editingId === org.id ? (
                          <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                            <Input
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              className="h-7 text-sm font-semibold"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === "Enter") confirmRename(e as unknown as React.MouseEvent);
                                if (e.key === "Escape") setEditingId(null);
                              }}
                            />
                            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={confirmRename} disabled={renameMutation.isPending}>
                              <Check className="w-3.5 h-3.5 text-primary" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={cancelEditing}>
                              <X className="w-3.5 h-3.5 text-destructive" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 group/name">
                            <p className="font-semibold text-foreground">{org.name}</p>
                            <button onClick={(e) => startEditing(org, e)} className="opacity-0 group-hover/name:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted">
                              <Pencil className="w-3 h-3 text-muted-foreground" />
                            </button>
                          </div>
                        )}
                        <p className="text-xs text-muted-foreground">{org.establishment_count} établissement(s)</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="default">Actif</Badge>
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget(org); }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10"
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>{org.user_count} utilisateur(s)</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <PlatformCreateOrgWizard open={wizardOpen} onOpenChange={setWizardOpen} />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer « {deleteTarget?.name} » ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est irréversible. L'organisation, ses établissements et toutes les données associées seront définitivement supprimés.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Suppression…" : "Supprimer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PlatformLayout>
  );
}
