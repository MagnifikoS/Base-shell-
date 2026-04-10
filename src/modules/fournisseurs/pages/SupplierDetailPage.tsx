/**
 * Supplier Detail Page — Full page layout (no modal)
 * Clean, readable, each section in its own card.
 */

import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PAY_LEDGER_BETA_ENABLED } from "@/config/featureFlags";
import { SupplierPaymentRulesPanel } from "@/modules/payLedger";
import { supabase } from "@/integrations/supabase/client";
import { ResponsiveLayout } from "@/components/mobile/ResponsiveLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ArrowLeft,
  Save,
  Loader2,
  Building2,
  Phone,
  MapPin,
  CreditCard,
  ImagePlus,
  Trash2,
  Palette,
} from "lucide-react";
import { toast } from "sonner";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import type { Supplier, SupplierInput } from "../services/supplierService";
import { updateSupplier as updateSupplierService } from "../services/supplierService";
import { SUPPLIER_ICON_OPTIONS } from "../utils/supplierIcons";

const SUPPLIER_TYPES = [
  { value: "grossiste", label: "Grossiste" },
  { value: "producteur", label: "Producteur" },
  { value: "importateur", label: "Importateur" },
  { value: "autre", label: "Autre" },
];

export function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeEstablishment } = useEstablishment();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [formData, setFormData] = useState<SupplierInput & { logo_url?: string | null }>({
    name: "",
  });

  const {
    data: supplier,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["supplier-detail", id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from("invoice_suppliers")
        .select(
          "id, name, name_normalized, trade_name, supplier_type, siret, vat_number, internal_code, contact_name, contact_email, contact_phone, notes, billing_address, address_line2, postal_code, city, country, payment_terms, payment_delay_days, payment_method, currency, tags, status, establishment_id, organization_id, created_at, updated_at, archived_at, logo_url"
        )
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as Supplier & { logo_url?: string | null };
    },
    enabled: !!id,
  });

  useEffect(() => {
    if (supplier) {
      setFormData({
        name: supplier.name,
        trade_name: supplier.trade_name,
        supplier_type: supplier.supplier_type,
        siret: supplier.siret,
        vat_number: supplier.vat_number,
        internal_code: supplier.internal_code,
        contact_name: supplier.contact_name,
        contact_email: supplier.contact_email,
        contact_phone: supplier.contact_phone,
        notes: supplier.notes,
        billing_address: supplier.billing_address,
        address_line2: supplier.address_line2,
        postal_code: supplier.postal_code,
        city: supplier.city,
        country: supplier.country,
        payment_terms: supplier.payment_terms,
        payment_delay_days: supplier.payment_delay_days,
        payment_method: supplier.payment_method,
        currency: supplier.currency || "EUR",
        logo_url: supplier.logo_url ?? null,
      });
    }
  }, [supplier]);

  const updateField = <K extends keyof typeof formData>(field: K, value: (typeof formData)[K]) => {
    setFormData((prev) => ({ ...prev, [field]: value || null }));
  };

  const handleSave = async () => {
    if (!id || !formData.name.trim()) return;
    setIsSaving(true);
    try {
      const { logo_url: _logo_url, ...input } = formData;
      const result = await updateSupplierService(id, input);
      if (!result.success) throw new Error(result.error);
      queryClient.invalidateQueries({ queryKey: ["supplier-detail", id] });
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      toast.success("Fournisseur mis à jour");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erreur lors de la sauvegarde");
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !id) return;

    const allowedTypes = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
    if (!allowedTypes.includes(file.type)) {
      toast.error("Format non supporté. Utilisez PNG, JPG, WEBP ou SVG.");
      return;
    }

    setIsUploadingLogo(true);
    try {
      const ext = file.name.split(".").pop() || "png";
      const path = `${activeEstablishment?.id}/${id}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("supplier-logos")
        .upload(path, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from("supplier-logos").getPublicUrl(path);

      const logoUrl = `${urlData.publicUrl}?t=${Date.now()}`;

      const { error: updateError } = await supabase
        .from("invoice_suppliers")
        .update({ logo_url: logoUrl })
        .eq("id", id);

      if (updateError) throw updateError;

      setFormData((prev) => ({ ...prev, logo_url: logoUrl }));
      queryClient.invalidateQueries({ queryKey: ["supplier-detail", id] });
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      toast.success("Logo téléchargé avec succès");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erreur lors du téléchargement");
    } finally {
      setIsUploadingLogo(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleRemoveLogo = async () => {
    if (!id) return;
    setIsUploadingLogo(true);
    try {
      const { error } = await supabase
        .from("invoice_suppliers")
        .update({ logo_url: null })
        .eq("id", id);

      if (error) throw error;

      setFormData((prev) => ({ ...prev, logo_url: null }));
      queryClient.invalidateQueries({ queryKey: ["supplier-detail", id] });
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      toast.success("Logo supprimé");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setIsUploadingLogo(false);
    }
  };

  if (isLoading) {
    return (
      <ResponsiveLayout>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </ResponsiveLayout>
    );
  }

  if (isError) {
    return (
      <ResponsiveLayout>
        <div className="container mx-auto py-6 px-4 max-w-4xl">
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <p className="text-destructive font-medium">Une erreur est survenue</p>
            <p className="text-muted-foreground text-sm mt-1">
              Impossible de charger les donnees du fournisseur. Veuillez reessayer.
            </p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()}>
              Reessayer
            </Button>
          </div>
        </div>
      </ResponsiveLayout>
    );
  }

  if (!supplier) {
    return (
      <ResponsiveLayout>
        <div className="container mx-auto py-6 px-4 max-w-4xl">
          <p className="text-muted-foreground text-center py-12">Fournisseur introuvable</p>
        </div>
      </ResponsiveLayout>
    );
  }

  return (
    <ResponsiveLayout>
      <div className="container mx-auto py-6 px-4 max-w-4xl space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/fournisseurs")}
            aria-label="Retour"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold uppercase">{supplier.name}</h1>
            {supplier.trade_name && (
              <p className="text-muted-foreground text-sm">{supplier.trade_name}</p>
            )}
          </div>
          <Button onClick={handleSave} disabled={isSaving || !formData.name.trim()}>
            {isSaving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Enregistrer
          </Button>
        </div>

        {/* Logo + Name */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" />
              Identité
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Logo / Icon display */}
            <div className="flex items-center gap-6">
              <div className="relative">
                {formData.logo_url?.startsWith("icon:") ? (
                  (() => {
                    const iconKey = formData.logo_url!.replace("icon:", "");
                    const found = SUPPLIER_ICON_OPTIONS.find((o) => o.key === iconKey);
                    const IconComp = found?.icon || Building2;
                    return (
                      <div className="w-20 h-20 rounded-xl border bg-primary/10 flex items-center justify-center">
                        <IconComp className="h-10 w-10 text-primary" />
                      </div>
                    );
                  })()
                ) : formData.logo_url ? (
                  <div className="w-20 h-20 rounded-xl border bg-background flex items-center justify-center overflow-hidden">
                    <img
                      src={formData.logo_url}
                      alt={formData.name}
                      className="w-full h-full object-contain p-1"
                    />
                  </div>
                ) : (
                  <div className="w-20 h-20 rounded-xl border-2 border-dashed bg-muted/30 flex items-center justify-center">
                    <Building2 className="h-8 w-8 text-muted-foreground/50" />
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  className="hidden"
                  onChange={handleLogoUpload}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploadingLogo}
                >
                  {isUploadingLogo ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <ImagePlus className="h-4 w-4 mr-2" />
                  )}
                  Importer un logo
                </Button>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm">
                      <Palette className="h-4 w-4 mr-2" />
                      Définir une icône
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80 p-3" align="start">
                    <p className="text-sm font-medium mb-2">Choisir une catégorie</p>
                    <div className="grid grid-cols-4 gap-2">
                      {SUPPLIER_ICON_OPTIONS.map((opt) => {
                        const isSelected = formData.logo_url === `icon:${opt.key}`;
                        return (
                          <button
                            key={opt.key}
                            type="button"
                            title={opt.label}
                            className={`flex flex-col items-center gap-1 p-2 rounded-lg border transition-colors ${
                              isSelected
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-transparent hover:bg-accent text-muted-foreground hover:text-foreground"
                            }`}
                            onClick={async () => {
                              const newValue = `icon:${opt.key}`;
                              setFormData((prev) => ({ ...prev, logo_url: newValue }));
                              if (id) {
                                await supabase
                                  .from("invoice_suppliers")
                                  .update({ logo_url: newValue })
                                  .eq("id", id);
                                queryClient.invalidateQueries({
                                  queryKey: ["supplier-detail", id],
                                });
                                queryClient.invalidateQueries({ queryKey: ["suppliers"] });
                                toast.success(`Icône "${opt.label}" appliquée`);
                              }
                            }}
                          >
                            <opt.icon className="h-5 w-5" />
                            <span className="text-[10px] leading-tight text-center truncate w-full">
                              {opt.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </PopoverContent>
                </Popover>
                {formData.logo_url && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={handleRemoveLogo}
                    disabled={isUploadingLogo}
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    Supprimer
                  </Button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Raison sociale *</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => updateField("name", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Nom commercial</Label>
                <Input
                  value={formData.trade_name || ""}
                  onChange={(e) => updateField("trade_name", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select
                  value={formData.supplier_type || ""}
                  onValueChange={(v) => updateField("supplier_type", v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    {SUPPLIER_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Code interne</Label>
                <Input
                  value={formData.internal_code || ""}
                  onChange={(e) => updateField("internal_code", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>SIRET</Label>
                <Input
                  value={formData.siret || ""}
                  onChange={(e) => updateField("siret", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>TVA intracommunautaire</Label>
                <Input
                  value={formData.vat_number || ""}
                  onChange={(e) => updateField("vat_number", e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Contact */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Phone className="h-4 w-4 text-primary" />
              Contact
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Contact principal</Label>
                <Input
                  value={formData.contact_name || ""}
                  onChange={(e) => updateField("contact_name", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={formData.contact_email || ""}
                  onChange={(e) => updateField("contact_email", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Téléphone</Label>
                <Input
                  value={formData.contact_phone || ""}
                  onChange={(e) => updateField("contact_phone", e.target.value)}
                />
              </div>
            </div>
            <div className="mt-4 space-y-2">
              <Label>Notes internes</Label>
              <Textarea
                value={formData.notes || ""}
                onChange={(e) => updateField("notes", e.target.value)}
                rows={3}
              />
            </div>
          </CardContent>
        </Card>

        {/* Address */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <MapPin className="h-4 w-4 text-primary" />
              Adresse
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4">
              <div className="space-y-2">
                <Label>Adresse ligne 1</Label>
                <Input
                  value={formData.billing_address || ""}
                  onChange={(e) => updateField("billing_address", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Adresse ligne 2</Label>
                <Input
                  value={formData.address_line2 || ""}
                  onChange={(e) => updateField("address_line2", e.target.value)}
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Code postal</Label>
                  <Input
                    value={formData.postal_code || ""}
                    onChange={(e) => updateField("postal_code", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Ville</Label>
                  <Input
                    value={formData.city || ""}
                    onChange={(e) => updateField("city", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Pays</Label>
                  <Input
                    value={formData.country || ""}
                    onChange={(e) => updateField("country", e.target.value)}
                    placeholder="France"
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── payLedger β ── Règle de paiement uniquement */}
        {PAY_LEDGER_BETA_ENABLED && activeEstablishment && id && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-primary" />
                Règle de paiement
              </CardTitle>
            </CardHeader>
            <CardContent>
              <SupplierPaymentRulesPanel
                organizationId={activeEstablishment.organization_id}
                establishmentId={activeEstablishment.id}
                supplierId={id}
                supplierName={supplier.name}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </ResponsiveLayout>
  );
}
