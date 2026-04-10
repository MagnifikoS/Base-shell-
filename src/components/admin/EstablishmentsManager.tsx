import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Plus, Archive, RotateCcw, Loader2, Settings, Clock, Palette, Coffee, Info } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { WeeklyHoursEditor } from "@/components/establishments/hours/WeeklyHoursEditor";
import { ExceptionsList } from "@/components/establishments/hours/ExceptionsList";
import { DayPartsEditor } from "@/components/establishments/hours/DayPartsEditor";
import { BreakRulesTab } from "@/components/establishments/breaks/BreakRulesTab";
import { ServiceDayCutoffEditor } from "@/components/establishments/settings/ServiceDayCutoffEditor";
import { EstablishmentInfoTab } from "@/components/establishments/settings/EstablishmentInfoTab";

interface Establishment {
  id: string;
  name: string;
  status: "active" | "archived";
  created_at: string;
}

export function EstablishmentsManager() {
  const [newName, setNewName] = useState("");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [selectedEstablishment, setSelectedEstablishmentLocal] = useState<Establishment | null>(null);
  const queryClient = useQueryClient();
  
  // SSOT: Establishment from Context only
  const { activeEstablishment, refreshEstablishments } = useEstablishment();
  const selectedEstablishmentId = activeEstablishment?.id ?? null;

  // Fetch establishments assigned to the current admin (via RLS on user_establishments)
  // V1 decision: Admin sees only establishments they are explicitly assigned to
  const { data: establishments, isLoading } = useQuery({
    queryKey: ["admin-establishments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("establishments")
        .select("id, name, status, created_at")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as Establishment[];
    },
    staleTime: 60000,
    refetchOnWindowFocus: false,
  });

  // Create establishment mutation
  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await supabase.functions.invoke("admin-manage-establishments", {
        body: { action: "create", name },
      });

      if (error) {
        // Handle specific error cases
        if (error.message?.includes("401") || error.message?.includes("Unauthorized")) {
          throw new Error("Session expirée, veuillez vous reconnecter");
        }
        throw new Error(error.message || "Erreur lors de la création");
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      return data;
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["admin-establishments"] });
      await refreshEstablishments(); // Update sidebar dropdown
      setNewName("");
      setIsCreateDialogOpen(false);
      toast.success("Établissement créé avec succès");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Archive/Reactivate mutation
  const statusMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "archive" | "reactivate" }) => {
      const { data, error } = await supabase.functions.invoke("admin-manage-establishments", {
        body: { action, establishment_id: id },
      });

      if (error) {
        if (error.message?.includes("401") || error.message?.includes("Unauthorized")) {
          throw new Error("Session expirée, veuillez vous reconnecter");
        }
        throw new Error(error.message || "Erreur lors de la mise à jour");
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      return data;
    },
    onSuccess: async (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["admin-establishments"] });
      await refreshEstablishments(); // Update sidebar dropdown + Context auto-excludes archived
      
      // Note: If the archived establishment was the active one, the Context
      // will automatically handle this via refreshEstablishments() which
      // re-fetches active establishments only. No manual reset needed.
      if (variables.action === "archive" && variables.id === selectedEstablishmentId) {
        queryClient.invalidateQueries({ queryKey: ["admin-users"] });
        queryClient.invalidateQueries({ queryKey: ["admin-invitations"] });
      }
      
      toast.success(
        variables.action === "archive"
          ? "Établissement archivé"
          : "Établissement réactivé"
      );
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const handleCreate = () => {
    const trimmedName = newName.trim();
    if (!trimmedName) {
      toast.error("Le nom est obligatoire");
      return;
    }
    createMutation.mutate(trimmedName);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium text-foreground">Établissements</h2>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Créer un établissement
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-background border-border">
            <DialogHeader>
              <DialogTitle>Nouvel établissement</DialogTitle>
              <DialogDescription className="sr-only">
                Créer un nouvel établissement dans votre organisation.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Input
                placeholder="Nom de l'établissement"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={100}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                }}
              />
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Annuler</Button>
              </DialogClose>
              <Button
                onClick={handleCreate}
                disabled={createMutation.isPending}
              >
                {createMutation.isPending && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Créer
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {establishments && establishments.length > 0 ? (
        <div className="border border-border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead>Nom</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Date de création</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {establishments.map((establishment) => (
                <TableRow 
                  key={establishment.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => setSelectedEstablishmentLocal(establishment)}
                >
                  <TableCell className="font-medium">
                    {establishment.name}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        establishment.status === "active" ? "default" : "secondary"
                      }
                    >
                      {establishment.status === "active" ? "Actif" : "Archivé"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {format(new Date(establishment.created_at), "dd MMM yyyy", {
                      locale: fr,
                    })}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedEstablishmentLocal(establishment)}
                      >
                        <Settings className="h-4 w-4 mr-1" />
                        Détails
                      </Button>
                      {establishment.status === "active" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            statusMutation.mutate({
                              id: establishment.id,
                              action: "archive",
                            })
                          }
                          disabled={statusMutation.isPending}
                        >
                          <Archive className="h-4 w-4 mr-1" />
                          Archiver
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            statusMutation.mutate({
                              id: establishment.id,
                              action: "reactivate",
                            })
                          }
                          disabled={statusMutation.isPending}
                        >
                          <RotateCcw className="h-4 w-4 mr-1" />
                          Réactiver
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="border border-border rounded-lg p-8 text-center">
          <p className="text-muted-foreground">Aucun établissement</p>
          <p className="text-sm text-muted-foreground mt-1">
            Créez votre premier établissement pour commencer.
          </p>
        </div>
      )}

      {/* Détail établissement avec horaires */}
      <Sheet open={!!selectedEstablishment} onOpenChange={(open) => !open && setSelectedEstablishmentLocal(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{selectedEstablishment?.name}</SheetTitle>
          </SheetHeader>
          
          {selectedEstablishment && (
            <div className="mt-6">
              <Tabs defaultValue="infos" className="w-full">
                <TabsList>
                  <TabsTrigger value="infos" className="gap-2">
                    <Info className="h-4 w-4" />
                    Infos
                  </TabsTrigger>
                  <TabsTrigger value="horaires" className="gap-2">
                    <Clock className="h-4 w-4" />
                    Horaires
                  </TabsTrigger>
                  <TabsTrigger value="journee" className="gap-2">
                    <Palette className="h-4 w-4" />
                    Journée
                  </TabsTrigger>
                  <TabsTrigger value="pauses" className="gap-2">
                    <Coffee className="h-4 w-4" />
                    Pauses
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="infos" className="mt-4">
                  <EstablishmentInfoTab establishmentId={selectedEstablishment.id} />
                </TabsContent>

                <TabsContent value="horaires" className="mt-4 space-y-6">
                  <div>
                    <h3 className="text-sm font-medium mb-3">Horaires hebdomadaires</h3>
                    <WeeklyHoursEditor establishmentId={selectedEstablishment.id} />
                  </div>
                  <div>
                    <h3 className="text-sm font-medium mb-3">Exceptions</h3>
                    <ExceptionsList establishmentId={selectedEstablishment.id} />
                  </div>
                </TabsContent>

                <TabsContent value="journee" className="mt-4 space-y-6">
                  <div>
                    <h3 className="text-sm font-medium mb-3">Fin de journée de service</h3>
                    <ServiceDayCutoffEditor establishmentId={selectedEstablishment.id} />
                  </div>
                  <div>
                    <h3 className="text-sm font-medium mb-3">Créneaux de journée</h3>
                    <p className="text-xs text-muted-foreground mb-4">
                      Définissez les créneaux Matin, Coupure et Soir avec leurs couleurs pour le planning.
                    </p>
                    <DayPartsEditor establishmentId={selectedEstablishment.id} />
                  </div>
                </TabsContent>

                <TabsContent value="pauses" className="mt-4">
                  <BreakRulesTab establishmentId={selectedEstablishment.id} />
                </TabsContent>
              </Tabs>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
