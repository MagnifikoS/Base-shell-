import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Save, Eye, EyeOff } from "lucide-react";
import type { Employee, EmployeeFormData } from "../types/employee.types";
import { ID_TYPES, maskIban, maskSsn } from "../types/employee.types";
import type { FormFieldErrors } from "../hooks/useEmployeeForm";

interface EmployeeInfoTabProps {
  employee: Employee;
  formData: EmployeeFormData;
  isOwnProfile: boolean;
  hasChanges: boolean;
  isSaving: boolean;
  onUpdateField: (field: keyof EmployeeFormData, value: string | number | boolean | null) => void;
  onUpdateSensitiveField: (field: "social_security_number" | "iban", value: string | null) => void;
  onSave: () => void;
  // Sensitive field state
  showIban: boolean;
  setShowIban: (show: boolean) => void;
  showSsn: boolean;
  setShowSsn: (show: boolean) => void;
  ibanLast4: string | null;
  ssnLast2: string | null;
  ibanEdited: boolean;
  ssnEdited: boolean;
  hasFullIban: boolean;
  hasFullSsn: boolean;
  // Validation errors
  fieldErrors?: FormFieldErrors;
  onClearFieldError?: (field: string) => void;
}

export function EmployeeInfoTab({
  employee,
  formData,
  isOwnProfile,
  hasChanges,
  isSaving,
  onUpdateField,
  onUpdateSensitiveField,
  onSave,
  showIban,
  setShowIban,
  showSsn,
  setShowSsn,
  ibanLast4,
  ssnLast2,
  ibanEdited,
  ssnEdited,
  hasFullIban,
  hasFullSsn,
  fieldErrors = {},
  onClearFieldError,
}: EmployeeInfoTabProps) {
  return (
    <div className="space-y-6">
      {/* General info (read-only from profiles) */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-muted-foreground">Informations générales</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-muted-foreground">Nom complet</Label>
            <p className="text-sm font-medium">{employee.full_name || "—"}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="second_first_name">2ème prénom</Label>
            {isOwnProfile ? (
              <Input
                id="second_first_name"
                value={formData.second_first_name || ""}
                onChange={(e) => onUpdateField("second_first_name", e.target.value || null)}
                placeholder="Deuxième prénom"
              />
            ) : (
              <Input
                id="second_first_name"
                value={formData.second_first_name || ""}
                onChange={(e) => onUpdateField("second_first_name", e.target.value || null)}
                placeholder="Deuxième prénom"
              />
            )}
          </div>
          <div>
            <Label className="text-muted-foreground">Email</Label>
            <p className="text-sm font-medium">{employee.email}</p>
          </div>
          <div>
            <Label className="text-muted-foreground">Rôle</Label>
            <p className="text-sm font-medium">{employee.role?.name || "—"}</p>
          </div>
          <div>
            <Label className="text-muted-foreground">Équipe(s)</Label>
            <p className="text-sm font-medium">
              {employee.teams?.length > 0 ? employee.teams.map((t) => t.name).join(", ") : "—"}
            </p>
          </div>
          <div className="col-span-2">
            <Label className="text-muted-foreground">Établissement(s)</Label>
            <p className="text-sm font-medium">
              {employee.establishments?.length > 0
                ? employee.establishments.map((e) => e.name).join(", ")
                : "—"}
            </p>
          </div>
        </div>
      </div>

      {/* Personal info (editable by admin, read-only for employee) */}
      <div className="space-y-4 pt-4 border-t">
        <h3 className="text-sm font-medium text-muted-foreground">Informations personnelles</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="phone">Téléphone</Label>
            {isOwnProfile ? (
              <p className="text-sm font-medium">{formData.phone || "Non renseigné"}</p>
            ) : (
              <Input
                id="phone"
                value={formData.phone || ""}
                onChange={(e) => onUpdateField("phone", e.target.value || null)}
                placeholder="+33 6 12 34 56 78"
              />
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="position">Poste</Label>
            {isOwnProfile ? (
              <p className="text-sm font-medium">{formData.position || "Non renseigné"}</p>
            ) : (
              <Input
                id="position"
                value={formData.position || ""}
                onChange={(e) => onUpdateField("position", e.target.value || null)}
                placeholder="Serveur, Cuisinier..."
              />
            )}
          </div>
          <div className="col-span-2 space-y-2">
            <Label htmlFor="address">Adresse</Label>
            {isOwnProfile ? (
              <p className="text-sm font-medium">{formData.address || "Non renseigné"}</p>
            ) : (
              <Input
                id="address"
                value={formData.address || ""}
                onChange={(e) => onUpdateField("address", e.target.value || null)}
                placeholder="123 rue exemple, 75001 Paris"
              />
            )}
          </div>
        </div>
      </div>

      {/* Transport section - Navigo pass */}
      <div className="space-y-4 pt-4 border-t">
        <h3 className="text-sm font-medium text-muted-foreground">Transport</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-center space-x-2">
            {isOwnProfile ? (
              <div className="flex items-center gap-2">
                <Checkbox id="has_navigo_pass" checked={formData.has_navigo_pass} disabled />
                <Label htmlFor="has_navigo_pass" className="text-muted-foreground">
                  Pass Navigo
                </Label>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="has_navigo_pass"
                  checked={formData.has_navigo_pass}
                  onCheckedChange={(checked) => {
                    onUpdateField("has_navigo_pass", checked === true);
                    // Clear number if unchecked (cohérence métier)
                    if (!checked) {
                      onUpdateField("navigo_pass_number", null);
                    }
                  }}
                />
                <Label htmlFor="has_navigo_pass">Pass Navigo</Label>
              </div>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="navigo_pass_number">N° Pass Navigo (optionnel)</Label>
            {isOwnProfile ? (
              <p className="text-sm font-medium">
                {formData.has_navigo_pass ? formData.navigo_pass_number || "Non renseigné" : "—"}
              </p>
            ) : (
              <Input
                id="navigo_pass_number"
                value={formData.navigo_pass_number || ""}
                onChange={(e) => onUpdateField("navigo_pass_number", e.target.value || null)}
                placeholder="Ex: 0912345678"
                disabled={!formData.has_navigo_pass}
              />
            )}
          </div>
        </div>
      </div>

      {/* ID document section */}
      <div className="space-y-4 pt-4 border-t">
        <h3 className="text-sm font-medium text-muted-foreground">Pièce d'identité</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Type de pièce</Label>
            {isOwnProfile ? (
              <p className="text-sm font-medium">
                {ID_TYPES.find((t) => t.value === formData.id_type)?.label || "Non renseigné"}
              </p>
            ) : (
              <Select
                value={formData.id_type || ""}
                onValueChange={(v) => onUpdateField("id_type", v || null)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner..." />
                </SelectTrigger>
                <SelectContent>
                  {ID_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div />
          <div className="space-y-2">
            <Label htmlFor="id_issue_date">Date d'émission</Label>
            {isOwnProfile ? (
              <p className="text-sm font-medium">
                {formData.id_issue_date
                  ? new Date(formData.id_issue_date).toLocaleDateString("fr-FR")
                  : "Non renseigné"}
              </p>
            ) : (
              <Input
                id="id_issue_date"
                type="date"
                value={formData.id_issue_date || ""}
                onChange={(e) => onUpdateField("id_issue_date", e.target.value || null)}
              />
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="id_expiry_date">Date d'expiration</Label>
            {isOwnProfile ? (
              <p className="text-sm font-medium">
                {formData.id_expiry_date
                  ? new Date(formData.id_expiry_date).toLocaleDateString("fr-FR")
                  : "Non renseigné"}
              </p>
            ) : (
              <Input
                id="id_expiry_date"
                type="date"
                value={formData.id_expiry_date || ""}
                onChange={(e) => onUpdateField("id_expiry_date", e.target.value || null)}
              />
            )}
          </div>
        </div>
      </div>

      {/* Sensitive fields - SSN & IBAN */}
      <div className="space-y-4 pt-4 border-t">
        <h3 className="text-sm font-medium text-muted-foreground">Informations administratives</h3>
        <div className="grid grid-cols-1 gap-4">
          {/* SSN */}
          <div className="space-y-2">
            <Label htmlFor="social_security_number">N° Sécurité sociale</Label>
            {hasFullSsn && !isOwnProfile ? (
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="social_security_number"
                    type={showSsn || ssnEdited ? "text" : "password"}
                    value={
                      ssnEdited
                        ? formData.social_security_number || ""
                        : showSsn
                          ? formData.social_security_number || ""
                          : maskSsn(ssnLast2)
                    }
                    onChange={(e) => {
                      onUpdateSensitiveField("social_security_number", e.target.value || null);
                      onClearFieldError?.("social_security_number");
                    }}
                    onFocus={() => {
                      if (!ssnEdited && formData.social_security_number) {
                        setShowSsn(true);
                      }
                    }}
                    placeholder="1 XX XX XX XXX XXX XX"
                    className={fieldErrors.social_security_number ? "border-destructive" : ""}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setShowSsn(!showSsn)}
                  title={showSsn ? "Masquer" : "Afficher"}
                  aria-label={
                    showSsn
                      ? "Masquer le numéro de sécurité sociale"
                      : "Afficher le numéro de sécurité sociale"
                  }
                >
                  {showSsn ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            ) : (
              <div className="p-2 bg-muted rounded text-sm font-mono">{maskSsn(ssnLast2)}</div>
            )}
            {fieldErrors.social_security_number && (
              <p className="text-sm text-destructive mt-1">{fieldErrors.social_security_number}</p>
            )}
          </div>

          {/* IBAN */}
          <div className="space-y-2">
            <Label htmlFor="iban">IBAN</Label>
            {hasFullIban && !isOwnProfile ? (
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="iban"
                    type={showIban || ibanEdited ? "text" : "password"}
                    value={
                      ibanEdited
                        ? formData.iban || ""
                        : showIban
                          ? formData.iban || ""
                          : maskIban(ibanLast4)
                    }
                    onChange={(e) => {
                      onUpdateSensitiveField("iban", e.target.value || null);
                      onClearFieldError?.("iban");
                    }}
                    onFocus={() => {
                      if (!ibanEdited && formData.iban) {
                        setShowIban(true);
                      }
                    }}
                    placeholder="FR76 XXXX XXXX XXXX..."
                    className={fieldErrors.iban ? "border-destructive" : ""}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setShowIban(!showIban)}
                  title={showIban ? "Masquer" : "Afficher"}
                  aria-label={showIban ? "Masquer l'IBAN" : "Afficher l'IBAN"}
                >
                  {showIban ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            ) : (
              <div className="p-2 bg-muted rounded text-sm font-mono">{maskIban(ibanLast4)}</div>
            )}
            {fieldErrors.iban && (
              <p className="text-sm text-destructive mt-1">{fieldErrors.iban}</p>
            )}
          </div>
        </div>
      </div>

      {/* Save button (admin or own profile for second_first_name) */}
      <div className="pt-4">
        <Button onClick={onSave} disabled={isSaving || !hasChanges} className="w-full">
          {isSaving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Enregistrer
        </Button>
      </div>
    </div>
  );
}
