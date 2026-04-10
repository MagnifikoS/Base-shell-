import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Save, ImagePlus, Building2, X } from "lucide-react";
import {
  platformGetEstablishmentProfile,
  platformUpsertEstablishmentProfile,
} from "@/lib/platform/rpcPlatform";

interface Props {
  establishmentId: string;
  establishmentName: string;
}

const EMPTY_FORM = {
  establishment_type: "restaurant",
  legal_name: "",
  siret: "",
  contact_name: "",
  contact_email: "",
  contact_phone: "",
  address_line1: "",
  address_line2: "",
  postal_code: "",
  city: "",
  country: "FR",
  logo_url: "",
};

export function EstablishmentProfileTab({ establishmentId, establishmentName }: Props) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [uploading, setUploading] = useState(false);

  // ── Fetch profile ──
  const { data: profile, isLoading } = useQuery({
    queryKey: ["platform-establishment-profile", establishmentId],
    queryFn: () => platformGetEstablishmentProfile(establishmentId),
  });

  // Sync form with loaded profile
  useEffect(() => {
    if (profile) {
      setForm({
        establishment_type: profile.establishment_type ?? "restaurant",
        legal_name: profile.legal_name ?? "",
        siret: profile.siret ?? "",
        contact_name: profile.contact_name ?? "",
        contact_email: profile.contact_email ?? "",
        contact_phone: profile.contact_phone ?? "",
        address_line1: profile.address_line1 ?? "",
        address_line2: profile.address_line2 ?? "",
        postal_code: profile.postal_code ?? "",
        city: profile.city ?? "",
        country: profile.country ?? "FR",
        logo_url: profile.logo_url ?? "",
      });
    }
  }, [profile]);

  // ── Upsert mutation ──
  const upsertMutation = useMutation({
    mutationFn: (payload: typeof form) =>
      platformUpsertEstablishmentProfile(establishmentId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-establishment-profile", establishmentId] });
      toast.success("Fiche établissement mise à jour");
    },
    onError: (err) => {
      toast.error(`Erreur : ${err instanceof Error ? err.message : "Erreur inconnue"}`);
    },
  });

  // ── Logo upload ──
  const handleLogoUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Le fichier doit être une image");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("L'image ne doit pas dépasser 2 Mo");
      return;
    }

    setUploading(true);
    try {
      const ext = file.name.split(".").pop() ?? "png";
      const path = `establishments/${establishmentId}/logo.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("establishment-logos")
        .upload(path, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("establishment-logos")
        .getPublicUrl(path);

      // Add cache buster
      const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;
      setForm((prev) => ({ ...prev, logo_url: publicUrl }));
      toast.success("Logo uploadé");
    } catch (err) {
      toast.error(`Erreur upload : ${err instanceof Error ? err.message : "Erreur"}`);
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    upsertMutation.mutate(form);
  };

  const updateField = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  // ── Loading state ──
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Logo */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Logo</CardTitle>
          <CardDescription>Logo de l'établissement (utilisé sur les documents)</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-6">
            {form.logo_url ? (
              <div className="relative group">
                <img
                  src={form.logo_url}
                  alt={`Logo ${establishmentName}`}
                  className="w-24 h-24 rounded-lg object-contain border bg-white"
                />
                <button
                  type="button"
                  className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => updateField("logo_url", "")}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="w-24 h-24 rounded-lg border-2 border-dashed border-muted-foreground/25 flex items-center justify-center">
                <Building2 className="w-8 h-8 text-muted-foreground/40" />
              </div>
            )}
            <div className="space-y-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
                {uploading ? "Upload..." : "Choisir une image"}
              </Button>
              <p className="text-xs text-muted-foreground">PNG, JPG, SVG. Max 2 Mo.</p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleLogoUpload(file);
                  e.target.value = "";
                }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Type + Identité */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Identité</CardTitle>
          <CardDescription>Informations officielles utilisées pour les documents (BL, factures)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="establishment_type">Type d'établissement</Label>
              <Select value={form.establishment_type} onValueChange={(v) => updateField("establishment_type", v)}>
                <SelectTrigger id="establishment_type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="restaurant">Restaurant</SelectItem>
                  <SelectItem value="fournisseur">Fournisseur</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="legal_name">Raison sociale</Label>
              <Input
                id="legal_name"
                value={form.legal_name}
                onChange={(e) => updateField("legal_name", e.target.value)}
                placeholder="Ex: SAS Magnifiko"
                maxLength={200}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="siret">SIRET</Label>
            <Input
              id="siret"
              value={form.siret}
              onChange={(e) => updateField("siret", e.target.value)}
              placeholder="Ex: 123 456 789 00012"
              maxLength={20}
            />
          </div>
        </CardContent>
      </Card>

      {/* Contact */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Contact</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="contact_name">Nom du contact</Label>
              <Input
                id="contact_name"
                value={form.contact_name}
                onChange={(e) => updateField("contact_name", e.target.value)}
                placeholder="Prénom Nom"
                maxLength={100}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact_email">Email</Label>
              <Input
                id="contact_email"
                type="email"
                value={form.contact_email}
                onChange={(e) => updateField("contact_email", e.target.value)}
                placeholder="contact@example.com"
                maxLength={255}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact_phone">Téléphone</Label>
              <Input
                id="contact_phone"
                value={form.contact_phone}
                onChange={(e) => updateField("contact_phone", e.target.value)}
                placeholder="01 23 45 67 89"
                maxLength={20}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Adresse */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Adresse</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="address_line1">Adresse ligne 1</Label>
            <Input
              id="address_line1"
              value={form.address_line1}
              onChange={(e) => updateField("address_line1", e.target.value)}
              placeholder="12 rue de la Paix"
              maxLength={200}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="address_line2">Adresse ligne 2</Label>
            <Input
              id="address_line2"
              value={form.address_line2}
              onChange={(e) => updateField("address_line2", e.target.value)}
              placeholder="Bâtiment A, 2e étage"
              maxLength={200}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="postal_code">Code postal</Label>
              <Input
                id="postal_code"
                value={form.postal_code}
                onChange={(e) => updateField("postal_code", e.target.value)}
                placeholder="75001"
                maxLength={10}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="city">Ville</Label>
              <Input
                id="city"
                value={form.city}
                onChange={(e) => updateField("city", e.target.value)}
                placeholder="Paris"
                maxLength={100}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="country">Pays</Label>
              <Input
                id="country"
                value={form.country}
                onChange={(e) => updateField("country", e.target.value)}
                placeholder="FR"
                maxLength={5}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Submit */}
      <div className="flex justify-end">
        <Button type="submit" className="gap-2" disabled={upsertMutation.isPending}>
          {upsertMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Enregistrer
        </Button>
      </div>
    </form>
  );
}
