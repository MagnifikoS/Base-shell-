/**
 * Supplier icon options for category-based visual identity.
 * Used in SupplierDetailPage (icon picker) and SuppliersList (rendering).
 */

import {
  Beef,
  Fish,
  Wheat,
  Milk,
  CupSoda,
  Apple,
  Salad,
  Snowflake,
  CakeSlice,
  Croissant,
  Boxes,
  SprayCan,
  Droplets,
  Coffee,
  Egg,
  Flame,
  type LucideIcon,
} from "lucide-react";

export interface SupplierIconOption {
  key: string;
  label: string;
  icon: LucideIcon;
}

export const SUPPLIER_ICON_OPTIONS: SupplierIconOption[] = [
  { key: "boucherie", label: "Boucherie", icon: Beef },
  { key: "poissonnerie", label: "Poissonnerie", icon: Fish },
  { key: "epicerie", label: "Épicerie", icon: Wheat },
  { key: "laitier", label: "Produits laitiers", icon: Milk },
  { key: "boissons", label: "Boissons", icon: CupSoda },
  { key: "cafe", label: "Café / Torréfacteur", icon: Coffee },
  { key: "fruits", label: "Fruits & Légumes", icon: Apple },
  { key: "legumes", label: "Légumes / Maraîcher", icon: Salad },
  { key: "surgeles", label: "Surgelés", icon: Snowflake },
  { key: "patisserie", label: "Pâtisserie", icon: CakeSlice },
  { key: "boulangerie", label: "Boulangerie", icon: Croissant },
  { key: "oeufs", label: "Œufs", icon: Egg },
  { key: "huiles", label: "Huiles / Condiments", icon: Droplets },
  { key: "epices", label: "Épices", icon: Flame },
  { key: "emballages", label: "Emballages", icon: Boxes },
  { key: "hygiene", label: "Hygiène / Entretien", icon: SprayCan },
];
