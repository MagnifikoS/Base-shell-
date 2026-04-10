/**
 * Supplier Create Page — Reuses SupplierFormModal in a simple wrapper
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ResponsiveLayout } from "@/components/mobile/ResponsiveLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Loader2, Save, Building2 } from "lucide-react";
import { toast } from "sonner";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useQueryClient } from "@tanstack/react-query";
import { createSupplier, type SupplierInput } from "../services/supplierService";
import { supplierSchema } from "@/lib/schemas/supplier";
import type { ZodError } from "zod";

const SUPPLIER_TYPES = [
  { value: "grossiste", label: "Grossiste" },
  { value: "producteur", label: "Producteur" },
  { value: "importateur", label: "Importateur" },
  { value: "autre", label: "Autre" },
];

export function SupplierCreatePage() {
  const navigate = useNavigate();
  const { activeEstablishment } = useEstablishment();
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState<SupplierInput>({
    name: "",
    supplier_type: null,
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const updateField = <K extends keyof SupplierInput>(field: K, value: SupplierInput[K]) => {
    setFormData((prev) => ({ ...prev, [field]: value || null }));
    // Clear error for this field on change
    if (fieldErrors[field]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const handleSave = async () => {
    if (!activeEstablishment) return;
    setFieldErrors({});

    const result = supplierSchema.safeParse(formData);
    if (!result.success) {
      const errors: Record<string, string> = {};
      (result.error as ZodError).issues.forEach((issue) => {
        const field = issue.path.join(".");
        if (!errors[field]) errors[field] = issue.message;
      });
      setFieldErrors(errors);
      return;
    }

    setIsSaving(true);
    try {
      const saveResult = await createSupplier({
        ...formData,
        establishment_id: activeEstablishment.id,
        organization_id: activeEstablishment.organization_id,
      });
      if (!saveResult.success) throw new Error(saveResult.error);
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      toast.success("Fournisseur créé avec succès");
      navigate(`/fournisseurs/${saveResult.data!.id}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ResponsiveLayout>
      <div className="container mx-auto py-6 px-4 max-w-4xl space-y-6">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/fournisseurs")}
            aria-label="Retour"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold flex-1">Nouveau fournisseur</h1>
          <Button onClick={handleSave} disabled={isSaving || !formData.name.trim()}>
            {isSaving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Créer
          </Button>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" />
              Identité
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Raison sociale *</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => updateField("name", e.target.value)}
                  placeholder="Ex: SAPORI ARTIGIANALI SARL"
                  autoFocus
                  className={fieldErrors.name ? "border-destructive" : ""}
                />
                {fieldErrors.name && <p className="text-sm text-destructive">{fieldErrors.name}</p>}
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
                {fieldErrors.supplier_type && (
                  <p className="text-sm text-destructive">{fieldErrors.supplier_type}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </ResponsiveLayout>
  );
}
