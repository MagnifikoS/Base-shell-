/**
 * BadgeuseSettingsTab - UI for badgeuse tolerance settings
 * Phase 1: SAFE - Uses existing columns only (no DB migration)
 *
 * Editable fields:
 * - arrival_tolerance_min (0-120)
 * - departure_tolerance_min (0-180)
 * - require_pin (toggle)
 * - require_selfie (toggle)
 *
 * Read-only display:
 * - device_binding_enabled
 * - max_devices_per_user
 */

import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useBadgeSettings } from "@/hooks/badgeuse/useBadgeSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Save, Clock, Shield, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { badgeuseSettingsSchema } from "@/lib/schemas/settings";
import type { ZodError } from "zod";

interface BadgeuseSettingsTabProps {
  establishmentId: string | null;
}

interface SettingsFormData {
  arrival_tolerance_min: number;
  departure_tolerance_min: number;
  early_arrival_limit_min: number;
  require_pin: boolean;
  require_selfie: boolean;
}

export function BadgeuseSettingsTab({ establishmentId }: BadgeuseSettingsTabProps) {
  const queryClient = useQueryClient();
  const { data: settings, isLoading, error } = useBadgeSettings({ establishmentId });

  const [formData, setFormData] = useState<SettingsFormData>({
    arrival_tolerance_min: 10,
    departure_tolerance_min: 20,
    early_arrival_limit_min: 30,
    require_pin: true,
    require_selfie: true,
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Sync form with fetched settings
  useEffect(() => {
    if (settings) {
      setFormData({
        arrival_tolerance_min: settings.arrival_tolerance_min,
        departure_tolerance_min: settings.departure_tolerance_min,
        early_arrival_limit_min: settings.early_arrival_limit_min ?? 30,
        require_pin: settings.require_pin,
        require_selfie: settings.require_selfie,
      });
    }
  }, [settings]);

  const updateMutation = useMutation({
    mutationFn: async (data: SettingsFormData) => {
      if (!establishmentId) throw new Error("No establishment selected");

      // Use supabase.functions.invoke for better CORS/auth handling
      const { data: result, error } = await supabase.functions.invoke(
        `badge-settings?establishment_id=${establishmentId}`,
        {
          method: "PATCH",
          body: {
            arrival_tolerance_min: data.arrival_tolerance_min,
            departure_tolerance_min: data.departure_tolerance_min,
            early_arrival_limit_min: data.early_arrival_limit_min,
            require_pin: data.require_pin,
            require_selfie: data.require_selfie,
          },
        }
      );

      if (error) {
        throw new Error(error.message || "Erreur lors de la mise à jour des paramètres");
      }

      // Handle non-success responses from Edge function
      if (result?.error) {
        throw new Error(result.error);
      }

      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["badge-settings", establishmentId] });
      toast.success("Paramètres enregistrés");
    },
    onError: (error: Error) => {
      toast.error(`Erreur: ${error.message}`);
    },
  });

  const clearFieldError = (field: string) => {
    setFieldErrors((prev) => {
      const n = { ...prev };
      delete n[field];
      return n;
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFieldErrors({});

    const result = badgeuseSettingsSchema.safeParse(formData);
    if (!result.success) {
      const errors: Record<string, string> = {};
      (result.error as ZodError).issues.forEach((issue) => {
        const field = issue.path.join(".");
        if (!errors[field]) errors[field] = issue.message;
      });
      setFieldErrors(errors);
      return;
    }

    updateMutation.mutate(formData);
  };

  if (!establishmentId) {
    return (
      <div className="p-6 bg-muted/50 rounded-xl">
        <p className="text-muted-foreground">
          Sélectionnez un établissement pour configurer les paramètres.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-destructive/10 rounded-xl">
        <p className="text-destructive">Erreur: {(error as Error).message}</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6" aria-label="Paramètres de la badgeuse">
      {/* Tolerances Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Tolérances
          </CardTitle>
          <CardDescription>Définissez les marges de tolérance pour les pointages</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Early Arrival Limit */}
          <div className="space-y-2">
            <Label htmlFor="early_arrival_limit">Limite arrivée anticipée (minutes)</Label>
            <p className="text-sm text-muted-foreground">
              Temps maximum avant le début du shift pour badger (0-120 min). Au-delà, le badge est
              refusé.
            </p>
            <Input
              id="early_arrival_limit"
              type="number"
              min={0}
              max={120}
              value={formData.early_arrival_limit_min}
              onChange={(e) => {
                setFormData((prev) => ({
                  ...prev,
                  early_arrival_limit_min: parseInt(e.target.value) || 0,
                }));
                clearFieldError("early_arrival_limit_min");
              }}
              className={fieldErrors.early_arrival_limit_min ? "w-32 border-destructive" : "w-32"}
            />
            {fieldErrors.early_arrival_limit_min && (
              <p className="text-sm text-destructive mt-1">{fieldErrors.early_arrival_limit_min}</p>
            )}
          </div>

          {/* Arrival Tolerance */}
          <div className="space-y-2">
            <Label htmlFor="arrival_tolerance">Tolérance arrivée (minutes)</Label>
            <p className="text-sm text-muted-foreground">
              Retard accepté avant d'être comptabilisé (0-120 min)
            </p>
            <Input
              id="arrival_tolerance"
              type="number"
              min={0}
              max={120}
              value={formData.arrival_tolerance_min}
              onChange={(e) => {
                setFormData((prev) => ({
                  ...prev,
                  arrival_tolerance_min: parseInt(e.target.value) || 0,
                }));
                clearFieldError("arrival_tolerance_min");
              }}
              className={fieldErrors.arrival_tolerance_min ? "w-32 border-destructive" : "w-32"}
            />
            {fieldErrors.arrival_tolerance_min && (
              <p className="text-sm text-destructive mt-1">{fieldErrors.arrival_tolerance_min}</p>
            )}
          </div>

          {/* Departure Tolerance */}
          <div className="space-y-2">
            <Label htmlFor="departure_tolerance">Tolérance départ (minutes)</Label>
            <p className="text-sm text-muted-foreground">
              Dépassement accepté avant de proposer des heures supplémentaires (0-180 min)
            </p>
            <Input
              id="departure_tolerance"
              type="number"
              min={0}
              max={180}
              value={formData.departure_tolerance_min}
              onChange={(e) => {
                setFormData((prev) => ({
                  ...prev,
                  departure_tolerance_min: parseInt(e.target.value) || 0,
                }));
                clearFieldError("departure_tolerance_min");
              }}
              className={fieldErrors.departure_tolerance_min ? "w-32 border-destructive" : "w-32"}
            />
            {fieldErrors.departure_tolerance_min && (
              <p className="text-sm text-destructive mt-1">{fieldErrors.departure_tolerance_min}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Security Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Sécurité
          </CardTitle>
          <CardDescription>Options de vérification au pointage</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Require PIN */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="require_pin">Code PIN obligatoire</Label>
              <p className="text-sm text-muted-foreground">
                L'employé doit saisir son code PIN pour pointer
              </p>
            </div>
            <Switch
              id="require_pin"
              aria-label="Code PIN obligatoire"
              checked={formData.require_pin}
              onCheckedChange={(checked) =>
                setFormData((prev) => ({
                  ...prev,
                  require_pin: checked,
                }))
              }
            />
          </div>

          {/* Require Selfie */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="require_selfie">Selfie obligatoire</Label>
              <p className="text-sm text-muted-foreground">
                L'employé doit prendre une photo pour pointer
              </p>
            </div>
            <Switch
              id="require_selfie"
              aria-label="Selfie obligatoire"
              checked={formData.require_selfie}
              onCheckedChange={(checked) =>
                setFormData((prev) => ({
                  ...prev,
                  require_selfie: checked,
                }))
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Device Binding Card (Read-Only) */}
      <Card className="opacity-75">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5" />
            Appareils (lecture seule)
          </CardTitle>
          <CardDescription>Configuration du binding d'appareils</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-muted-foreground">Liaison appareil activée</Label>
            </div>
            <Switch
              aria-label="Liaison appareil activée"
              checked={settings?.device_binding_enabled ?? true}
              disabled
            />
          </div>
          <div className="space-y-0.5">
            <Label className="text-muted-foreground">
              Appareils max par utilisateur: {settings?.max_devices_per_user ?? 1}
            </Label>
          </div>
        </CardContent>
      </Card>

      {/* Submit Button */}
      <div className="flex justify-end">
        <Button type="submit" disabled={updateMutation.isPending}>
          {updateMutation.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Enregistrement...
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              Enregistrer
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
