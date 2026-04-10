/**
 * Service Day Cutoff Editor
 * Allows admins to configure the establishment's service day boundary
 * 
 * ✅ SINGLE SOURCE OF TRUTH: This is the UI for configuring the cutoff 
 * that get_service_day RPC uses to determine the business day
 */

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { Loader2, Save, Clock, AlertTriangle, Info, Calendar } from "lucide-react";
import { toast } from "sonner";

interface ServiceDayCutoffEditorProps {
  establishmentId: string;
}

export function ServiceDayCutoffEditor({ establishmentId }: ServiceDayCutoffEditorProps) {
  const queryClient = useQueryClient();
  const [cutoff, setCutoff] = useState("03:00");
  const [hasChanged, setHasChanged] = useState(false);
  
  // Auto-publish state
  const [autoPublishEnabled, setAutoPublishEnabled] = useState(false);
  const [autoPublishTime, setAutoPublishTime] = useState("20:00");
  const [autoPublishChanged, setAutoPublishChanged] = useState(false);

  // Fetch current settings
  const { data: establishment, isLoading } = useQuery({
    queryKey: ["establishment-cutoff", establishmentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("establishments")
        .select("service_day_cutoff, planning_auto_publish_enabled, planning_auto_publish_time")
        .eq("id", establishmentId)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!establishmentId,
  });

  useEffect(() => {
    if (establishment) {
      // Service day cutoff
      if (establishment.service_day_cutoff) {
        const time = establishment.service_day_cutoff.slice(0, 5);
        setCutoff(time);
      }
      // Auto-publish settings
      setAutoPublishEnabled(establishment.planning_auto_publish_enabled ?? false);
      if (establishment.planning_auto_publish_time) {
        setAutoPublishTime(establishment.planning_auto_publish_time.slice(0, 5));
      }
      setHasChanged(false);
      setAutoPublishChanged(false);
    }
  }, [establishment]);

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async (newCutoff: string) => {
      // Validate: must be between 00:00 and 06:00
      const [hours] = newCutoff.split(":").map(Number);
      if (hours > 6) {
        throw new Error("L'heure de fin de journée doit être entre 00:00 et 06:00");
      }

      // ✅ PHASE P1: Anti-phantom — .select("id") pour détecter 0 rows affected
      const { data, error } = await supabase
        .from("establishments")
        .update({ service_day_cutoff: newCutoff + ":00" }) // Add seconds for TIME type
        .eq("id", establishmentId)
        .select("id");

      if (error) throw error;
      
      // Détection "succès fantôme" : RLS/WHERE a bloqué silencieusement
      if (!data || data.length === 0) {
        throw new Error("Mise à jour refusée (aucune ligne affectée)");
      }
    },
    onSuccess: () => {
      // ✅ FIX 3 (Phase 2.6): Cascade invalidation when cutoff changes
      // Primary: the cutoff value itself
      queryClient.invalidateQueries({ queryKey: ["establishment-cutoff", establishmentId] });
      // Derived: service day calculation depends on cutoff
      queryClient.invalidateQueries({ queryKey: ["service-day-today", establishmentId] });
      // Dependent views that use service day (prefix-based for all dates)
      queryClient.invalidateQueries({ queryKey: ["presence", establishmentId], exact: false });
      queryClient.invalidateQueries({ queryKey: ["alerts", establishmentId], exact: false });
      queryClient.invalidateQueries({ queryKey: ["absence", "monthly", establishmentId], exact: false });
      queryClient.invalidateQueries({ queryKey: ["absence", "detail", establishmentId], exact: false });
      queryClient.invalidateQueries({ queryKey: ["badge-status", establishmentId], exact: false });
      
      setHasChanged(false);
      toast.success("Fin de journée de service mise à jour");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const handleChange = (value: string) => {
    // Validate: only allow times between 00:00 and 06:00
    const [hours] = value.split(":").map(Number);
    if (hours <= 6) {
      setCutoff(value);
      setHasChanged(value !== establishment?.service_day_cutoff?.slice(0, 5));
    }
  };

  const handleSave = () => {
    updateMutation.mutate(cutoff);
  };

  // Auto-publish mutation
  const autoPublishMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("establishments")
        .update({
          planning_auto_publish_enabled: autoPublishEnabled,
          planning_auto_publish_time: autoPublishTime + ":00",
        })
        .eq("id", establishmentId)
        .select("id");

      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("Mise à jour refusée (aucune ligne affectée)");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["establishment-cutoff", establishmentId] });
      setAutoPublishChanged(false);
      toast.success("Publication automatique mise à jour");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const handleAutoPublishToggle = (enabled: boolean) => {
    setAutoPublishEnabled(enabled);
    setAutoPublishChanged(true);
  };

  const handleAutoPublishTimeChange = (value: string) => {
    setAutoPublishTime(value);
    setAutoPublishChanged(true);
  };

  const handleSaveAutoPublish = () => {
    autoPublishMutation.mutate();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <Clock className="h-5 w-5 text-primary mt-0.5" />
        <div className="flex-1 space-y-3">
          <div>
            <Label htmlFor="service-cutoff" className="text-sm font-medium">
              Fin de journée de service
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Tout événement (badge, caisse) avant cette heure est rattaché à la veille.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Input
              id="service-cutoff"
              type="time"
              value={cutoff}
              onChange={(e) => handleChange(e.target.value)}
              className="w-28"
              min="00:00"
              max="06:00"
            />
            <span className="text-sm text-muted-foreground">
              (entre 00:00 et 06:00)
            </span>
          </div>

          {/* Info tooltip */}
          <Alert className="bg-muted/50 border-muted">
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Exemple : si cutoff = 03:00, un badge à 02:00 sera rattaché à la journée de la veille.
            </AlertDescription>
          </Alert>

          {/* Warning when changed */}
          {hasChanged && (
            <Alert className="bg-warning/10 border-warning/30">
              <AlertTriangle className="h-4 w-4 text-warning" />
              <AlertDescription className="text-xs text-warning-foreground">
                Changer cette heure peut modifier la répartition des événements autour de minuit.
                Les données passées peuvent nécessiter un recalcul (pré-remplissage en mode "remplacer").
              </AlertDescription>
            </Alert>
          )}

          <Button 
            onClick={handleSave} 
            disabled={updateMutation.isPending || !hasChanged}
            size="sm"
          >
            {updateMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Enregistrer
          </Button>
        </div>
      </div>

      {/* Auto-publish section */}
      <div className="border-t pt-6 mt-6">
        <div className="flex items-start gap-3">
          <Calendar className="h-5 w-5 text-primary mt-0.5" />
          <div className="flex-1 space-y-4">
            <div>
              <Label className="text-sm font-medium">
                Publication automatique du planning
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Publie automatiquement la semaine suivante chaque dimanche à l'heure configurée.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Switch
                checked={autoPublishEnabled}
                onCheckedChange={handleAutoPublishToggle}
              />
              <span className="text-sm">
                {autoPublishEnabled ? "Activé" : "Désactivé"}
              </span>
            </div>

            {autoPublishEnabled && (
              <div className="flex items-center gap-3">
                <Label htmlFor="auto-publish-time" className="text-sm">
                  Heure de publication (dimanche) :
                </Label>
                <Input
                  id="auto-publish-time"
                  type="time"
                  value={autoPublishTime}
                  onChange={(e) => handleAutoPublishTimeChange(e.target.value)}
                  className="w-28"
                />
              </div>
            )}

            <Alert className="bg-muted/50 border-muted">
              <Info className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Exemple : si l'heure = 20:00, la semaine du 10 au 16 février sera visible aux salariés
                à partir du dimanche 9 février à 20h00.
              </AlertDescription>
            </Alert>

            <Button 
              onClick={handleSaveAutoPublish} 
              disabled={autoPublishMutation.isPending || !autoPublishChanged}
              size="sm"
            >
              {autoPublishMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Enregistrer
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
