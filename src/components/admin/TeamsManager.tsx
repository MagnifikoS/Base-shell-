import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Archive, RotateCcw, Loader2, Users } from "lucide-react";
import { createTeamSchema } from "@/lib/schemas/admin";
import type { ZodError } from "zod";

interface Team {
  id: string;
  name: string;
  description: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export function TeamsManager() {
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamDescription, setNewTeamDescription] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const { data: teams = [], isLoading } = useQuery({
    queryKey: ["admin-teams"],
    queryFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) throw new Error("Non authentifié");

      const response = await supabase.functions.invoke("admin-manage-teams", {
        body: { action: "list" },
      });

      if (response.error) throw response.error;
      return response.data.teams as Team[];
    },
    staleTime: 60000,
    refetchOnWindowFocus: false,
  });

  const createMutation = useMutation({
    mutationFn: async ({ name, description }: { name: string; description: string }) => {
      const response = await supabase.functions.invoke("admin-manage-teams", {
        body: { action: "create", name, description },
      });
      if (response.error) throw response.error;
      if (response.data.error) throw new Error(response.data.error);
      return response.data.team;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-teams"] });
      toast.success("Équipe créée avec succès");
      setIsCreateOpen(false);
      setNewTeamName("");
      setNewTeamDescription("");
      setFieldErrors({});
    },
    onError: (error: Error) => {
      toast.error(error.message || "Erreur lors de la création");
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async (teamId: string) => {
      const response = await supabase.functions.invoke("admin-manage-teams", {
        body: { action: "archive", team_id: teamId },
      });
      if (response.error) throw response.error;
      if (response.data.error) throw new Error(response.data.error);
      return response.data.team;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-teams"] });
      toast.success("Équipe archivée");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Erreur lors de l'archivage");
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: async (teamId: string) => {
      const response = await supabase.functions.invoke("admin-manage-teams", {
        body: { action: "reactivate", team_id: teamId },
      });
      if (response.error) throw response.error;
      if (response.data.error) throw new Error(response.data.error);
      return response.data.team;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-teams"] });
      toast.success("Équipe réactivée");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Erreur lors de la réactivation");
    },
  });

  const handleCreate = () => {
    setFieldErrors({});

    const result = createTeamSchema.safeParse({
      name: newTeamName.trim(),
      description: newTeamDescription.trim(),
    });
    if (!result.success) {
      const errors: Record<string, string> = {};
      (result.error as ZodError).issues.forEach((issue) => {
        const field = issue.path.join(".");
        if (!errors[field]) errors[field] = issue.message;
      });
      setFieldErrors(errors);
      return;
    }

    createMutation.mutate({
      name: newTeamName.trim(),
      description: newTeamDescription.trim(),
    });
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
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
        <h2 className="text-lg font-medium text-foreground">Équipes</h2>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2">
              <Plus className="h-4 w-4" />
              Nouvelle équipe
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Créer une équipe</DialogTitle>
              <DialogDescription>
                Ajoutez une nouvelle équipe à votre organisation.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label htmlFor="team-name" className="text-sm font-medium">
                  Nom de l'équipe *
                </label>
                <Input
                  id="team-name"
                  value={newTeamName}
                  onChange={(e) => {
                    setNewTeamName(e.target.value);
                    if (fieldErrors.name) {
                      setFieldErrors((prev) => {
                        const next = { ...prev };
                        delete next.name;
                        return next;
                      });
                    }
                  }}
                  placeholder="Ex: Équipe Cuisine"
                  maxLength={100}
                  className={fieldErrors.name ? "border-destructive" : ""}
                />
                {fieldErrors.name && <p className="text-sm text-destructive">{fieldErrors.name}</p>}
              </div>
              <div className="space-y-2">
                <label htmlFor="team-description" className="text-sm font-medium">
                  Description
                </label>
                <Textarea
                  id="team-description"
                  value={newTeamDescription}
                  onChange={(e) => {
                    setNewTeamDescription(e.target.value);
                    if (fieldErrors.description) {
                      setFieldErrors((prev) => {
                        const next = { ...prev };
                        delete next.description;
                        return next;
                      });
                    }
                  }}
                  placeholder="Description optionnelle..."
                  rows={3}
                  className={fieldErrors.description ? "border-destructive" : ""}
                />
                {fieldErrors.description && (
                  <p className="text-sm text-destructive">{fieldErrors.description}</p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                Annuler
              </Button>
              <Button
                onClick={handleCreate}
                disabled={createMutation.isPending || !newTeamName.trim()}
              >
                {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Créer
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {teams.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Users className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground">Aucune équipe créée</p>
          <p className="text-sm text-muted-foreground">
            Créez votre première équipe pour commencer.
          </p>
        </div>
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Créée le</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {teams.map((team) => (
                <TableRow key={team.id}>
                  <TableCell className="font-medium">{team.name}</TableCell>
                  <TableCell className="text-muted-foreground">{team.description || "—"}</TableCell>
                  <TableCell>
                    <Badge variant={team.status === "active" ? "default" : "secondary"}>
                      {team.status === "active" ? "Actif" : "Archivé"}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatDate(team.created_at)}</TableCell>
                  <TableCell className="text-right">
                    {team.status === "active" ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => archiveMutation.mutate(team.id)}
                        disabled={archiveMutation.isPending}
                        aria-label="Archiver l'équipe"
                      >
                        <Archive className="h-4 w-4" />
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => reactivateMutation.mutate(team.id)}
                        disabled={reactivateMutation.isPending}
                        aria-label="Réactiver l'équipe"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
