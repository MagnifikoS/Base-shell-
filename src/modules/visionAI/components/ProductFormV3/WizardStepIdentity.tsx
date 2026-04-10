/**
 * ═══════════════════════════════════════════════════════════════════════════
 * V3 WIZARD — ÉTAPE 1 : IDENTITÉ PRODUIT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Champs :
 * - Nom produit (obligatoire)
 * - Code produit (optionnel)
 * - Fournisseur (obligatoire, sélection uniquement — jamais de création)
 */

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
import { ArrowRight, Tag, User } from "lucide-react";
import { useSuppliersList } from "@/modules/produitsV2";

interface WizardStepIdentityProps {
  productName: string;
  productCode: string;
  supplierId: string | null;
  /** If true, supplier cannot be changed (e.g. Vision AI invoice context) */
  supplierLocked?: boolean;
  onProductNameChange: (value: string) => void;
  onProductCodeChange: (value: string) => void;
  onSupplierIdChange: (value: string | null) => void;
  onNext: () => void;
  canProceed: boolean;
}

export function WizardStepIdentity({
  productName,
  productCode,
  supplierId,
  supplierLocked,
  onProductNameChange,
  onProductCodeChange,
  onSupplierIdChange,
  onNext,
  canProceed,
}: WizardStepIdentityProps) {
  const { data: suppliers = [] } = useSuppliersList();

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="flex flex-col items-center mb-8">
          <h2 className="text-lg font-semibold text-center mb-1">Identité du produit</h2>
          <p className="text-sm text-muted-foreground text-center max-w-sm">
            Renseigne le nom, le code et le fournisseur de ce produit.
          </p>
        </div>

        <div className="max-w-lg mx-auto space-y-6">
          {/* Nom produit */}
          <div className="space-y-2">
            <Label htmlFor="wizard-product-name" className="flex items-center gap-2">
              <Tag className="h-4 w-4 text-primary" />
              Nom du produit <span className="text-destructive">*</span>
            </Label>
            <Input
              id="wizard-product-name"
              value={productName}
              onChange={(e) => onProductNameChange(e.target.value)}
              onBlur={(e) => onProductNameChange(
                e.target.value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim()
              )}
              placeholder="Ex: HUILE D'OLIVE EXTRA VIERGE"
              className="h-12 text-base uppercase"
              autoFocus
            />
          </div>

          {/* Code produit */}
          <div className="space-y-2">
            <Label htmlFor="wizard-product-code">Code produit</Label>
            <Input
              id="wizard-product-code"
              value={productCode}
              onChange={(e) => onProductCodeChange(e.target.value)}
              placeholder="Ex: PRD-001, EAN13..."
              className="h-12"
            />
            <p className="text-xs text-muted-foreground">
              Optionnel — code interne ou code-barres fournisseur.
            </p>
          </div>

          {/* Fournisseur */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <User className="h-4 w-4 text-primary" />
              Fournisseur <span className="text-destructive">*</span>
            </Label>
            <Select
              value={supplierId ?? ""}
              onValueChange={(value) => onSupplierIdChange(value || null)}
              disabled={supplierLocked}
            >
              <SelectTrigger className="h-12 text-base">
                <SelectValue placeholder="Sélectionner un fournisseur" />
              </SelectTrigger>
              <SelectContent>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                    {s.trade_name ? ` (${s.trade_name})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {supplierLocked && (
              <p className="text-xs text-muted-foreground">Fournisseur imposé par la facture.</p>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t px-6 py-4 flex justify-end">
        <Button onClick={onNext} disabled={!canProceed} className="min-w-[120px]">
          Suivant
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}
