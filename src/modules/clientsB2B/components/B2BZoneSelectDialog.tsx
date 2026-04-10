/**
 * B2B Zone Select Dialog — Step 2 of import flow
 * User picks a storage zone before import starts
 */

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { useStorageZones } from "@/modules/produitsV2";
import { supabase } from "@/integrations/supabase/client";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { MapPin } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCount: number;
  onConfirm: (zoneId: string) => void;
}

export function B2BZoneSelectDialog({ open, onOpenChange, selectedCount, onConfirm }: Props) {
  const { zones, isLoading } = useStorageZones();
  const { activeEstablishment } = useEstablishment();
  const [selectedZone, setSelectedZone] = useState<string>("");

  // Pre-select default receipt zone
  useEffect(() => {
    if (!activeEstablishment?.id || !open) return;
    supabase
      .from("establishment_stock_settings")
      .select("default_receipt_zone_id")
      .eq("establishment_id", activeEstablishment.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.default_receipt_zone_id) {
          setSelectedZone(data.default_receipt_zone_id);
        } else if (zones.length > 0) {
          setSelectedZone(zones[0].id);
        }
      });
  }, [activeEstablishment?.id, open, zones]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Choisir la zone de stockage
          </DialogTitle>
          <DialogDescription>
            {selectedCount} produit{selectedCount > 1 ? "s" : ""} sélectionné{selectedCount > 1 ? "s" : ""} seront créé{selectedCount > 1 ? "s" : ""} dans cette zone.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-6 text-center text-muted-foreground">Chargement...</div>
        ) : zones.length === 0 ? (
          <div className="py-6 text-center text-muted-foreground">
            Aucune zone configurée. Créez une zone dans Paramètres.
          </div>
        ) : (
          <RadioGroup value={selectedZone} onValueChange={setSelectedZone} className="space-y-3">
            {zones.map((zone) => (
              <div key={zone.id} className="flex items-center space-x-3 rounded-lg border p-3 hover:bg-accent/50 transition-colors">
                <RadioGroupItem value={zone.id} id={`zone-${zone.id}`} />
                <Label htmlFor={`zone-${zone.id}`} className="flex-1 cursor-pointer font-medium">
                  {zone.name}
                </Label>
              </div>
            ))}
          </RadioGroup>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            onClick={() => onConfirm(selectedZone)}
            disabled={!selectedZone || zones.length === 0}
          >
            Confirmer l'import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
