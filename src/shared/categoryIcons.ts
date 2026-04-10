/**
 * Shared category icon mapping — used by Reception, Withdrawal, and Inventory Desktop.
 * Single source of truth for category → icon associations.
 */

import {
  Milk,
  CupSoda,
  Coffee,
  Beef,
  Wheat,
  Fish,
  Egg,
  Apple,
  Salad,
  Snowflake,
  CakeSlice,
  Croissant,
  Droplets,
  Flame,
  Boxes,
  SprayCan,
  CircleDot,
  type LucideIcon,
} from "lucide-react";

export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  "produits laitiers": Milk,
  "boissons": CupSoda,
  "boissons (soft)": CupSoda,
  "boissons (alcool)": Coffee,
  "viandes": Beef,
  "boucherie": Beef,
  "épicerie": Wheat,
  "poissons": Fish,
  "poissonnerie": Fish,
  "oeufs": Egg,
  "fruits": Apple,
  "fruits et légumes": Apple,
  "légumes": Salad,
  "surgelés": Snowflake,
  "pâtisserie": CakeSlice,
  "boulangerie": Croissant,
  "huiles": Droplets,
  "condiments": Flame,
  "emballages": Boxes,
  "hygiène": SprayCan,
  "hygiene": SprayCan,
  "entretien": SprayCan,
};

export function getCategoryIcon(category: string): LucideIcon {
  const key = category
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  for (const [k, icon] of Object.entries(CATEGORY_ICONS)) {
    if (key.includes(k)) return icon;
  }
  return CircleDot;
}
