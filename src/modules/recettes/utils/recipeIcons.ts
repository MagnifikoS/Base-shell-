/**
 * ═══════════════════════════════════════════════════════════════
 * MODULE RECETTES — Icon registry for recipe types
 * ═══════════════════════════════════════════════════════════════
 *
 * Maps icon keys (stored in DB) to Lucide components.
 * Used by RecipeTypeSettings (picker) and RecettesPage (display).
 */

import {
  ChefHat,
  Soup,
  Salad,
  Beef,
  Fish,
  Pizza,
  Sandwich,
  CakeSlice,
  Cookie,
  IceCreamCone,
  Egg,
  Wine,
  Coffee,
  GlassWater,
  Citrus,
  Croissant,
  Ham,
  Drumstick,
  Cherry,
  Wheat,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface RecipeIconOption {
  key: string;
  label: string;
  icon: LucideIcon;
}

export const RECIPE_ICON_OPTIONS: RecipeIconOption[] = [
  { key: "chef-hat", label: "Chef", icon: ChefHat },
  { key: "soup", label: "Soupe", icon: Soup },
  { key: "salad", label: "Salade", icon: Salad },
  { key: "beef", label: "Viande", icon: Beef },
  { key: "fish", label: "Poisson", icon: Fish },
  { key: "pizza", label: "Pizza", icon: Pizza },
  { key: "sandwich", label: "Sandwich", icon: Sandwich },
  { key: "cake-slice", label: "Dessert", icon: CakeSlice },
  { key: "cookie", label: "Pâtisserie", icon: Cookie },
  { key: "ice-cream-cone", label: "Glace", icon: IceCreamCone },
  { key: "egg", label: "Œuf", icon: Egg },
  { key: "wine", label: "Vin", icon: Wine },
  { key: "coffee", label: "Café", icon: Coffee },
  { key: "glass-water", label: "Boisson", icon: GlassWater },
  { key: "citrus", label: "Fruit", icon: Citrus },
  { key: "croissant", label: "Viennoiserie", icon: Croissant },
  { key: "ham", label: "Charcuterie", icon: Ham },
  { key: "drumstick", label: "Volaille", icon: Drumstick },
  { key: "cherry", label: "Fruit rouge", icon: Cherry },
  { key: "wheat", label: "Céréale", icon: Wheat },
];

const iconMap = new Map<string, LucideIcon>(
  RECIPE_ICON_OPTIONS.map((o) => [o.key, o.icon])
);

/** Resolve a DB icon key to a Lucide component. Falls back to ChefHat. */
export function getRecipeTypeIcon(key: string | null | undefined): LucideIcon {
  return iconMap.get(key ?? "") ?? ChefHat;
}
