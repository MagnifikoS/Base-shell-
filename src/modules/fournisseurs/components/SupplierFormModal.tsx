/**
 * Supplier Form Modal - Create/Edit supplier
 */

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Loader2 } from "lucide-react";
import { supplierSchema } from "@/lib/schemas/supplier";
import type { ZodError } from "zod";
import type { Supplier, SupplierInput } from "../services/supplierService";

interface SupplierFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplier: Supplier | null;
  onSave: (input: SupplierInput) => Promise<void>;
}

const SUPPLIER_TYPES = [
  { value: "grossiste", label: "Grossiste" },
  { value: "producteur", label: "Producteur" },
  { value: "importateur", label: "Importateur" },
  { value: "autre", label: "Autre" },
];

export function SupplierFormModal({
  open,
  onOpenChange,
  supplier,
  onSave,
}: SupplierFormModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formData, setFormData] = useState<SupplierInput>({
    name: "",
    trade_name: null,
    supplier_type: null,
    siret: null,
    vat_number: null,
    internal_code: null,
    contact_name: null,
    contact_email: null,
    contact_phone: null,
    notes: null,
    billing_address: null,
    address_line2: null,
    postal_code: null,
    city: null,
    country: null,
    payment_terms: null,
    payment_delay_days: null,
    payment_method: null,
    currency: "EUR",
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
      });
    } else {
      setFormData({
        name: "",
        trade_name: null,
        supplier_type: null,
        siret: null,
        vat_number: null,
        internal_code: null,
        contact_name: null,
        contact_email: null,
        contact_phone: null,
        notes: null,
        billing_address: null,
        address_line2: null,
        postal_code: null,
        city: null,
        country: null,
        payment_terms: null,
        payment_delay_days: null,
        payment_method: null,
        currency: "EUR",
      });
    }
  }, [supplier, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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

    setIsSubmitting(true);
    try {
      await onSave(formData);
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateField = <K extends keyof SupplierInput>(field: K, value: SupplierInput[K]) => {
    setFormData((prev) => ({ ...prev, [field]: value || null }));
    if (fieldErrors[field]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{supplier ? "Modifier le fournisseur" : "Nouveau fournisseur"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Required field */}
          <div className="space-y-2">
            <Label htmlFor="name">
              Nom du fournisseur (raison sociale) <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => updateField("name", e.target.value)}
              placeholder="Ex: SAPORI ARTIGIANALI SARL"
              required
              className={fieldErrors.name ? "border-destructive" : ""}
            />
            {fieldErrors.name && <p className="text-sm text-destructive">{fieldErrors.name}</p>}
          </div>

          <Accordion type="multiple" className="w-full">
            {/* Identification */}
            <AccordionItem value="identification">
              <AccordionTrigger>Identification</AccordionTrigger>
              <AccordionContent className="space-y-4 pt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="trade_name">Nom commercial</Label>
                    <Input
                      id="trade_name"
                      value={formData.trade_name || ""}
                      onChange={(e) => updateField("trade_name", e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="supplier_type">Type de fournisseur</Label>
                    <Select
                      value={formData.supplier_type || ""}
                      onValueChange={(v) => updateField("supplier_type", v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Sélectionner..." />
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
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="siret">SIRET</Label>
                    <Input
                      id="siret"
                      value={formData.siret || ""}
                      onChange={(e) => updateField("siret", e.target.value)}
                      placeholder="Ex: 123 456 789 00012"
                      className={fieldErrors.siret ? "border-destructive" : ""}
                    />
                    {fieldErrors.siret && (
                      <p className="text-sm text-destructive">{fieldErrors.siret}</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="vat_number">TVA intracommunautaire</Label>
                    <Input
                      id="vat_number"
                      value={formData.vat_number || ""}
                      onChange={(e) => updateField("vat_number", e.target.value)}
                      placeholder="Ex: FR12345678901"
                      className={fieldErrors.vat_number ? "border-destructive" : ""}
                    />
                    {fieldErrors.vat_number && (
                      <p className="text-sm text-destructive">{fieldErrors.vat_number}</p>
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="internal_code">Code interne</Label>
                  <Input
                    id="internal_code"
                    value={formData.internal_code || ""}
                    onChange={(e) => updateField("internal_code", e.target.value)}
                    placeholder="Ex: FOUR-001"
                  />
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Contact */}
            <AccordionItem value="contact">
              <AccordionTrigger>Contact</AccordionTrigger>
              <AccordionContent className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label htmlFor="contact_name">Contact principal</Label>
                  <Input
                    id="contact_name"
                    value={formData.contact_name || ""}
                    onChange={(e) => updateField("contact_name", e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="contact_email">Email</Label>
                    <Input
                      id="contact_email"
                      type="email"
                      value={formData.contact_email || ""}
                      onChange={(e) => updateField("contact_email", e.target.value)}
                      className={fieldErrors.contact_email ? "border-destructive" : ""}
                    />
                    {fieldErrors.contact_email && (
                      <p className="text-sm text-destructive">{fieldErrors.contact_email}</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="contact_phone">Téléphone</Label>
                    <Input
                      id="contact_phone"
                      value={formData.contact_phone || ""}
                      onChange={(e) => updateField("contact_phone", e.target.value)}
                      className={fieldErrors.contact_phone ? "border-destructive" : ""}
                    />
                    {fieldErrors.contact_phone && (
                      <p className="text-sm text-destructive">{fieldErrors.contact_phone}</p>
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="notes">Notes internes</Label>
                  <Textarea
                    id="notes"
                    value={formData.notes || ""}
                    onChange={(e) => updateField("notes", e.target.value)}
                    rows={3}
                  />
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Address */}
            <AccordionItem value="address">
              <AccordionTrigger>Adresse</AccordionTrigger>
              <AccordionContent className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label htmlFor="billing_address">Adresse ligne 1</Label>
                  <Input
                    id="billing_address"
                    value={formData.billing_address || ""}
                    onChange={(e) => updateField("billing_address", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="address_line2">Adresse ligne 2</Label>
                  <Input
                    id="address_line2"
                    value={formData.address_line2 || ""}
                    onChange={(e) => updateField("address_line2", e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="postal_code">Code postal</Label>
                    <Input
                      id="postal_code"
                      value={formData.postal_code || ""}
                      onChange={(e) => updateField("postal_code", e.target.value)}
                      className={fieldErrors.postal_code ? "border-destructive" : ""}
                    />
                    {fieldErrors.postal_code && (
                      <p className="text-sm text-destructive">{fieldErrors.postal_code}</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="city">Ville</Label>
                    <Input
                      id="city"
                      value={formData.city || ""}
                      onChange={(e) => updateField("city", e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="country">Pays</Label>
                    <Input
                      id="country"
                      value={formData.country || ""}
                      onChange={(e) => updateField("country", e.target.value)}
                      placeholder="France"
                    />
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Billing */}
            <AccordionItem value="billing">
              <AccordionTrigger>Facturation</AccordionTrigger>
              <AccordionContent className="space-y-4 pt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="payment_terms">Conditions de paiement</Label>
                    <Input
                      id="payment_terms"
                      value={formData.payment_terms || ""}
                      onChange={(e) => updateField("payment_terms", e.target.value)}
                      placeholder="Ex: 30 jours fin de mois"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="payment_delay_days">Délai de paiement (jours)</Label>
                    <Input
                      id="payment_delay_days"
                      type="number"
                      min="0"
                      value={formData.payment_delay_days ?? ""}
                      onChange={(e) =>
                        updateField(
                          "payment_delay_days",
                          e.target.value ? parseInt(e.target.value) : null
                        )
                      }
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="payment_method">Moyen de paiement</Label>
                    <Input
                      id="payment_method"
                      value={formData.payment_method || ""}
                      onChange={(e) => updateField("payment_method", e.target.value)}
                      placeholder="Ex: Virement, Chèque"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="currency">Devise</Label>
                    <Input
                      id="currency"
                      value={formData.currency || "EUR"}
                      onChange={(e) => updateField("currency", e.target.value)}
                    />
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Annuler
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Enregistrement...
                </>
              ) : supplier ? (
                "Enregistrer"
              ) : (
                "Créer le fournisseur"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
