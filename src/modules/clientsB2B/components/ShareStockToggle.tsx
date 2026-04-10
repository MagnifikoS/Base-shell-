/**
 * ShareStockToggle — Toggle "Partager le stock" for a B2B partnership
 * Supplier-side only. Isolated component, no side effects.
 */

import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2, Eye } from "lucide-react";
import { toggleShareStock } from "../services/shareStockService";
import { toast } from "sonner";

interface Props {
  partnershipId: string;
  initialValue: boolean;
}

export function ShareStockToggle({ partnershipId, initialValue }: Props) {
  const [enabled, setEnabled] = useState(initialValue);
  const [saving, setSaving] = useState(false);

  const handleToggle = async (checked: boolean) => {
    setSaving(true);
    try {
      await toggleShareStock(partnershipId, checked);
      setEnabled(checked);
      toast.success(checked ? "Partage de stock activé" : "Partage de stock désactivé");
    } catch {
      toast.error("Erreur lors de la mise à jour");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/50">
      <Eye className="h-4 w-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <Label htmlFor={`share-stock-${partnershipId}`} className="text-sm font-medium cursor-pointer">
          Partager le stock
        </Label>
        <p className="text-xs text-muted-foreground leading-tight">
          Permet au client de voir un stock indicatif lors de la commande. Le stock peut varier, confirmation finale à l'expédition.
        </p>
      </div>
      {saving ? (
        <Loader2 className="h-4 w-4 animate-spin shrink-0" />
      ) : (
        <Switch
          id={`share-stock-${partnershipId}`}
          checked={enabled}
          onCheckedChange={handleToggle}
        />
      )}
    </div>
  );
}
