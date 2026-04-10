/**
 * PackagingPopup — Multi-level packaging editor.
 * Edits niveaux_conditionnement for a single product.
 * No backend calls. No business logic.
 */

import { useState } from "react";
import { Plus, Trash2, AlertTriangle } from "lucide-react";
import { EditPopup } from "./EditPopup";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface NiveauConditionnement {
  nom_niveau: string | null;
  contient_quantite: number | null;
  contient_unite_abbr: { id: string; abbreviation: string } | null;
}

interface UnitOption {
  id: string;
  name: string;
  abbreviation: string;
  family: string | null;
}

interface PackagingPopupProps {
  niveaux: NiveauConditionnement[] | null;
  units: UnitOption[];
  onClose: () => void;
  onValidate: (niveaux: NiveauConditionnement[]) => void;
}

export function PackagingPopup({ niveaux, units, onClose, onValidate }: PackagingPopupProps) {
  const [draft, setDraft] = useState<NiveauConditionnement[]>(
    niveaux && niveaux.length > 0
      ? niveaux.map((n) => ({ ...n }))
      : []
  );

  const updateLevel = (index: number, field: keyof NiveauConditionnement, value: NiveauConditionnement[keyof NiveauConditionnement]) => {
    const updated = draft.map((n, i) =>
      i === index ? { ...n, [field]: value } : n
    );
    setDraft(updated);
  };

  const removeLevel = (index: number) => {
    setDraft(draft.filter((_, i) => i !== index));
  };

  const addLevel = () => {
    setDraft([...draft, { nom_niveau: null, contient_quantite: null, contient_unite_abbr: null }]);
  };

  const handleValidate = () => {
    onValidate(draft);
  };

  return (
    <EditPopup title="Conditionnement" onClose={onClose} onValidate={handleValidate}>
      <div className="space-y-3">
        {draft.length === 0 && (
          <div className="flex items-center gap-2 text-sm text-orange-600 dark:text-orange-400">
            <AlertTriangle className="h-4 w-4" />
            <span>Aucun niveau de conditionnement défini</span>
          </div>
        )}

        {draft.map((niveau, i) => (
          <div key={i} className="flex items-end gap-2 p-2 rounded border bg-muted/30">
            <div className="flex-1 space-y-1">
              <label className="text-xs text-muted-foreground">Nom</label>
              <Input
                value={niveau.nom_niveau ?? ""}
                onChange={(e) => updateLevel(i, "nom_niveau", e.target.value || null)}
                placeholder="Ex: Carton"
                className="h-8 text-sm"
              />
            </div>
            <div className="w-20 space-y-1">
              <label className="text-xs text-muted-foreground">Qté</label>
              <Input
                type="number"
                value={niveau.contient_quantite ?? ""}
                onChange={(e) =>
                  updateLevel(i, "contient_quantite", e.target.value ? Number(e.target.value) : null)
                }
                placeholder="0"
                className="h-8 text-sm"
              />
            </div>
            <div className="w-28 space-y-1">
              <label className="text-xs text-muted-foreground">Unité</label>
              <select
                value={niveau.contient_unite_abbr?.id ?? ""}
                onChange={(e) => {
                  const selected = e.target.value ? units.find((u) => u.id === e.target.value) : null;
                  updateLevel(i, "contient_unite_abbr", selected ? { id: selected.id, abbreviation: selected.abbreviation } : null);
                }}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">—</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.abbreviation}
                  </option>
                ))}
              </select>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive"
              onClick={() => removeLevel(i)}
              aria-label="Supprimer ce niveau"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}

        <Button variant="outline" size="sm" onClick={addLevel} className="w-full">
          <Plus className="h-3.5 w-3.5 mr-1" />
          Ajouter un niveau
        </Button>
      </div>
    </EditPopup>
  );
}
