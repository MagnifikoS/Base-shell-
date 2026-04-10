/**
 * Establishment Info Tab
 * Allows editing trade name, address, and contact email
 *
 * ✅ SSOT: Uses direct update on establishments table (same pattern as ServiceDayCutoffEditor)
 * ✅ Dismantlable: Self-contained component, can be removed without breaking other modules
 */

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Save, Building2, MapPin, Mail, Tags } from "lucide-react";
import { toast } from "sonner";
import { establishmentInfoSchema } from "@/lib/schemas/settings";
import type { ZodError } from "zod";

interface EstablishmentInfoTabProps {
  establishmentId: string;
}

interface EstablishmentInfo {
  name: string;
  trade_name: string | null;
  address: string | null;
  contact_email: string | null;
  establishment_type: string;
}

const ESTABLISHMENT_TYPES = [
  { value: "restaurant", label: "Restaurant" },
  { value: "fournisseur", label: "Fournisseur" },
] as const;

export function EstablishmentInfoTab({ establishmentId }: EstablishmentInfoTabProps) {
  const queryClient = useQueryClient();

  const [tradeName, setTradeName] = useState("");
  const [address, setAddress] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [hasChanged, setHasChanged] = useState(false);
  const [establishmentType, setEstablishmentType] = useState("restaurant");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Fetch current establishment info
  const { data: establishment, isLoading } = useQuery({
    queryKey: ["establishment-info", establishmentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("establishments")
        .select("name, trade_name, address, contact_email, establishment_type")
        .eq("id", establishmentId)
        .single();

      if (error) throw error;
      return data as EstablishmentInfo;
    },
    enabled: !!establishmentId,
  });

  // Sync state with fetched data
  useEffect(() => {
    if (establishment) {
      setTradeName(establishment.trade_name || "");
      setAddress(establishment.address || "");
      setContactEmail(establishment.contact_email || "");
      setEstablishmentType(establishment.establishment_type || "restaurant");
      setHasChanged(false);
    }
  }, [establishment]);

  // Track changes
  const checkChanges = (newTradeName: string, newAddress: string, newEmail: string, newType?: string) => {
    const originalTradeName = establishment?.trade_name || "";
    const originalAddress = establishment?.address || "";
    const originalEmail = establishment?.contact_email || "";
    const originalType = establishment?.establishment_type || "restaurant";

    setHasChanged(
      newTradeName !== originalTradeName ||
        newAddress !== originalAddress ||
        newEmail !== originalEmail ||
        (newType ?? establishmentType) !== originalType
    );
  };

  const handleTradeNameChange = (value: string) => {
    setTradeName(value);
    checkChanges(value, address, contactEmail);
  };

  const handleAddressChange = (value: string) => {
    setAddress(value);
    checkChanges(tradeName, value, contactEmail);
  };

  const handleEmailChange = (value: string) => {
    setContactEmail(value);
    checkChanges(tradeName, address, value);
  };

  const handleTypeChange = (value: string) => {
    setEstablishmentType(value);
    checkChanges(tradeName, address, contactEmail, value);
  };

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async () => {
      // ✅ Anti-phantom: .select("id") to detect 0 rows affected
      const { data, error } = await supabase
        .from("establishments")
        .update({
          trade_name: tradeName.trim() || null,
          address: address.trim() || null,
          contact_email: contactEmail.trim() || null,
          establishment_type: establishmentType,
        })
        .eq("id", establishmentId)
        .select("id");

      if (error) throw error;

      if (!data || data.length === 0) {
        throw new Error("Mise à jour refusée (aucune ligne affectée)");
      }
    },
    onSuccess: () => {
      // Invalidate all relevant queries
      queryClient.invalidateQueries({ queryKey: ["establishment-info", establishmentId] });
      queryClient.invalidateQueries({ queryKey: ["establishment-cutoff", establishmentId] });
      queryClient.invalidateQueries({ queryKey: ["admin-establishments"] });
      queryClient.invalidateQueries({ queryKey: ["establishments"] });

      setHasChanged(false);
      toast.success("Informations enregistrées");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const handleSave = () => {
    setFieldErrors({});

    const result = establishmentInfoSchema.safeParse({
      trade_name: tradeName.trim(),
      address: address.trim(),
      contact_email: contactEmail.trim(),
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

    updateMutation.mutate();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Establishment Type */}
      <div className="flex items-start gap-3">
        <Tags className="h-5 w-5 text-primary mt-0.5" />
        <div className="flex-1 space-y-2">
          <div>
            <Label className="text-sm font-medium">Type d'établissement</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Définit le rôle de cet établissement dans le système de commandes
            </p>
          </div>
          <Select value={establishmentType} onValueChange={handleTypeChange}>
            <SelectTrigger className="w-full max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ESTABLISHMENT_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Trade Name */}
      <div className="flex items-start gap-3">
        <Building2 className="h-5 w-5 text-primary mt-0.5" />
        <div className="flex-1 space-y-2">
          <div>
            <Label htmlFor="trade-name" className="text-sm font-medium">
              Nom commercial
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Nom affiché publiquement (peut différer du nom légal "{establishment?.name}")
            </p>
          </div>
          <Input
            id="trade-name"
            type="text"
            value={tradeName}
            onChange={(e) => {
              handleTradeNameChange(e.target.value);
              if (fieldErrors.trade_name) {
                setFieldErrors((prev) => {
                  const next = { ...prev };
                  delete next.trade_name;
                  return next;
                });
              }
            }}
            placeholder="Ex: Le Petit Bistrot"
            maxLength={100}
            className={fieldErrors.trade_name ? "border-destructive" : ""}
          />
          {fieldErrors.trade_name && (
            <p className="text-sm text-destructive">{fieldErrors.trade_name}</p>
          )}
        </div>
      </div>

      {/* Address */}
      <div className="flex items-start gap-3">
        <MapPin className="h-5 w-5 text-primary mt-0.5" />
        <div className="flex-1 space-y-2">
          <div>
            <Label htmlFor="address" className="text-sm font-medium">
              Adresse
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Adresse complète de l'établissement
            </p>
          </div>
          <Textarea
            id="address"
            value={address}
            onChange={(e) => {
              handleAddressChange(e.target.value);
              if (fieldErrors.address) {
                setFieldErrors((prev) => {
                  const next = { ...prev };
                  delete next.address;
                  return next;
                });
              }
            }}
            placeholder="Ex: 123 rue de la Paix, 75001 Paris"
            rows={2}
            maxLength={500}
            className={fieldErrors.address ? "border-destructive" : ""}
          />
          {fieldErrors.address && <p className="text-sm text-destructive">{fieldErrors.address}</p>}
        </div>
      </div>

      {/* Contact Email */}
      <div className="flex items-start gap-3">
        <Mail className="h-5 w-5 text-primary mt-0.5" />
        <div className="flex-1 space-y-2">
          <div>
            <Label htmlFor="contact-email" className="text-sm font-medium">
              Email de contact
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Email pour les communications de l'établissement
            </p>
          </div>
          <Input
            id="contact-email"
            type="email"
            value={contactEmail}
            onChange={(e) => {
              handleEmailChange(e.target.value);
              if (fieldErrors.contact_email) {
                setFieldErrors((prev) => {
                  const next = { ...prev };
                  delete next.contact_email;
                  return next;
                });
              }
            }}
            placeholder="contact@etablissement.fr"
            maxLength={255}
            className={fieldErrors.contact_email ? "border-destructive" : ""}
          />
          {fieldErrors.contact_email && (
            <p className="text-sm text-destructive">{fieldErrors.contact_email}</p>
          )}
        </div>
      </div>

      {/* Save Button */}
      <div className="pt-2">
        <Button onClick={handleSave} disabled={updateMutation.isPending || !hasChanged} size="sm">
          {updateMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Enregistrer
        </Button>
      </div>
    </div>
  );
}
