/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INVENTAIRE V0/V1 — Type Selector (mobile-first icon cards)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { Package, ArrowDownToLine, ArrowUpFromLine, AlertTriangle, Boxes } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEstablishment } from "@/contexts/EstablishmentContext";
import { useEstablishmentRoleNavConfig } from "@/hooks/useEstablishmentRoleNavConfig";

export type InventoryType = "produit" | "reception" | "retrait" | "alertes" | "stock";

/** Mapping stable : InventoryType → navRegistry child id */
const TYPE_TO_NAV_ID: Record<InventoryType, string> = {
  stock: "inventaire.produit",
  produit: "inventaire.produit",
  reception: "inventaire.reception",
  retrait: "inventaire.retrait",
  alertes: "inventaire.alertes",
};

interface InventoryTypeItem {
  id: InventoryType;
  label: string;
  description: string;
  icon: React.ElementType;
  gradient: string;
  iconColor: string;
}

const TYPES: InventoryTypeItem[] = [
  {
    id: "stock",
    label: "Stock",
    description: "Consultation & seuils",
    icon: Boxes,
    gradient: "from-blue-500/15 to-blue-500/5",
    iconColor: "text-blue-600 dark:text-blue-400",
  },
  {
    id: "produit",
    label: "Inventaire Produit",
    description: "Comptage par zone",
    icon: Package,
    gradient: "from-primary/15 to-primary/5",
    iconColor: "text-primary",
  },
  {
    id: "reception",
    label: "Réception",
    description: "Entrée marchandise",
    icon: ArrowDownToLine,
    gradient: "from-primary/15 to-primary/5",
    iconColor: "text-primary",
  },
  {
    id: "retrait",
    label: "Retrait",
    description: "Sortie marchandise",
    icon: ArrowUpFromLine,
    gradient: "from-destructive/15 to-destructive/5",
    iconColor: "text-destructive",
  },
  {
    id: "alertes",
    label: "Alertes",
    description: "Stock minimum",
    icon: AlertTriangle,
    gradient: "from-amber-500/15 to-amber-500/5",
    iconColor: "text-amber-600 dark:text-amber-400",
  },
];

interface InventoryTypeSelectorProps {
  onSelect: (type: InventoryType) => void;
}

export function InventoryTypeSelector({ onSelect }: InventoryTypeSelectorProps) {
  const { activeEstablishment } = useEstablishment();
  const { prefs } = useEstablishmentRoleNavConfig(activeEstablishment?.id ?? null);

  // Filter types based on hiddenIds from establishment nav config (DB)
  const visibleTypes = TYPES.filter((type) => !prefs.hiddenIds.includes(TYPE_TO_NAV_ID[type.id]));

  return (
    <div className="grid grid-cols-2 gap-3">
      {visibleTypes.map((type) => {
        const Icon = type.icon;
        return (
          <button
            key={type.id}
            onClick={() => onSelect(type.id)}
            aria-label={`Sélectionner ${type.label}: ${type.description}`}
            className={cn(
              "relative flex flex-col items-center gap-3 p-5 rounded-2xl border transition-all",
              "bg-gradient-to-br",
              type.gradient,
              "border-primary/20 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/10 active:scale-[0.97] cursor-pointer"
            )}
          >
            <div
              className={cn(
                "flex items-center justify-center w-14 h-14 rounded-xl",
                "bg-primary/10 shadow-sm"
              )}
            >
              <Icon className={cn("h-7 w-7", type.iconColor)} />
            </div>
            <div className="text-center space-y-0.5">
              <p className="font-semibold text-sm leading-tight text-foreground">{type.label}</p>
              <p className="text-xs text-muted-foreground">{type.description}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
