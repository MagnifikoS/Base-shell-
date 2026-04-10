/**
 * Mobile-optimized absence declaration form
 * Uses single date range picker for fluid UX
 */

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { getTodayParis } from "@/lib/time/paris";
import { MobileDateRangePicker } from "./MobileDateRangePicker";
import { absenceDeclarationSchema } from "@/lib/schemas/absence";
import type { AbsenceDeclaration } from "../types";
import type { ZodError } from "zod";

export interface MobileAbsenceDeclarationFormProps {
  onDeclare: (
    declaration: AbsenceDeclaration
  ) => Promise<{ dates: string[]; require_justificatif: boolean }>;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
  disabled?: boolean;
  /** Pre-select a motif type (default: "maladie") */
  defaultMotif?: "maladie" | "cp" | "autre";
  /** Hide the motif radio selector (useful when pre-set from CP tab) */
  hideMotifSelector?: boolean;
}

export function MobileAbsenceDeclarationForm({
  onDeclare,
  onSuccess,
  onError,
  disabled = false,
  defaultMotif = "maladie",
  hideMotifSelector = false,
}: MobileAbsenceDeclarationFormProps) {
  const [dateStart, setDateStart] = useState(getTodayParis());
  const [dateEnd, setDateEnd] = useState(getTodayParis());
  const [motifType, setMotifType] = useState<"maladie" | "cp" | "autre">(defaultMotif);
  const [motifDetail, setMotifDetail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handleRangeChange = (start: string, end: string) => {
    setDateStart(start);
    setDateEnd(end);
    // Clear date errors on change
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next.date_start;
      delete next.date_end;
      return next;
    });
  };

  const handleDeclare = async () => {
    setFieldErrors({});

    const formData = {
      date_start: dateStart,
      date_end: dateEnd,
      motif_type: motifType,
      motif_detail: motifType === "autre" ? motifDetail.trim() : undefined,
    };

    const validation = absenceDeclarationSchema.safeParse(formData);
    if (!validation.success) {
      const errors: Record<string, string> = {};
      (validation.error as ZodError).issues.forEach((issue) => {
        const field = issue.path.join(".");
        if (!errors[field]) errors[field] = issue.message;
      });
      setFieldErrors(errors);
      // Show first error as toast for mobile UX
      const firstError = (validation.error as ZodError).issues[0]?.message;
      if (firstError) onError(firstError);
      return;
    }

    setIsSubmitting(true);
    try {
      const declaration: AbsenceDeclaration = {
        date_start: dateStart,
        date_end: dateEnd,
        motif_type: motifType,
        motif_detail: motifType === "autre" ? motifDetail.trim() : undefined,
      };

      const result = await onDeclare(declaration);

      const successMsg = result.require_justificatif
        ? `Absence déclarée pour ${result.dates.length} jour(s). N'oubliez pas le justificatif sous 48h.`
        : `Absence déclarée pour ${result.dates.length} jour(s).`;
      onSuccess(successMsg);

      // Reset form
      setDateStart(getTodayParis());
      setDateEnd(getTodayParis());
      setMotifType("maladie");
      setMotifDetail("");
      setFieldErrors({});
    } catch (error) {
      // If conflict was handled by parent with dialog, don't show inline error
      if (error instanceof Error && error.message === "__CONFLICT_HANDLED__") {
        return;
      }
      const errorMsg = error instanceof Error ? error.message : "Erreur lors de la déclaration";
      onError(errorMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isDisabled = disabled || isSubmitting;

  return (
    <Card>
      <CardContent className="pt-5 space-y-5">
        {/* Date range picker */}
        <div>
          <MobileDateRangePicker
            dateStart={dateStart}
            dateEnd={dateEnd}
            onRangeChange={handleRangeChange}
            disabled={isDisabled}
          />
          {fieldErrors.date_end && (
            <p className="text-sm text-destructive mt-1">{fieldErrors.date_end}</p>
          )}
        </div>

        {/* Motif selection */}
        {!hideMotifSelector && (
          <div className="space-y-3">
            <Label>Motif</Label>
            <RadioGroup
              value={motifType}
              onValueChange={(v) => {
                setMotifType(v as "maladie" | "cp" | "autre");
                setFieldErrors((prev) => {
                  const next = { ...prev };
                  delete next.motif_type;
                  delete next.motif_detail;
                  return next;
                });
              }}
              disabled={isDisabled}
              className="space-y-2"
            >
              <div className="flex items-center space-x-3 p-3 rounded-lg border bg-card">
                <RadioGroupItem value="maladie" id="mobile-maladie" />
                <Label htmlFor="mobile-maladie" className="font-normal cursor-pointer flex-1">
                  Maladie
                </Label>
              </div>
              <div className="flex items-center space-x-3 p-3 rounded-lg border bg-card">
                <RadioGroupItem value="cp" id="mobile-cp" />
                <Label htmlFor="mobile-cp" className="font-normal cursor-pointer flex-1">
                  Congé payé (CP)
                </Label>
              </div>
              <div className="flex items-center space-x-3 p-3 rounded-lg border bg-card">
                <RadioGroupItem value="autre" id="mobile-autre" />
                <Label htmlFor="mobile-autre" className="font-normal cursor-pointer flex-1">
                  Autre motif
                </Label>
              </div>
            </RadioGroup>
          </div>
        )}

        {motifType === "autre" && (
          <div className="space-y-2">
            <Label htmlFor="mobile_motif_detail">Précisez le motif *</Label>
            <Textarea
              id="mobile_motif_detail"
              value={motifDetail}
              onChange={(e) => {
                setMotifDetail(e.target.value);
                if (fieldErrors.motif_detail) {
                  setFieldErrors((prev) => {
                    const next = { ...prev };
                    delete next.motif_detail;
                    return next;
                  });
                }
              }}
              placeholder="Ex: Rendez-vous médical..."
              disabled={isDisabled}
              rows={3}
              className={`text-base ${fieldErrors.motif_detail ? "border-destructive" : ""}`}
            />
            {fieldErrors.motif_detail && (
              <p className="text-sm text-destructive">{fieldErrors.motif_detail}</p>
            )}
          </div>
        )}

        <Button
          onClick={handleDeclare}
          disabled={isDisabled || (motifType === "autre" && !motifDetail.trim())}
          className="w-full h-12 text-base"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              Déclaration en cours...
            </>
          ) : motifType === "cp" ? (
            "Demander un congé payé"
          ) : (
            "Déclarer l'absence"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
