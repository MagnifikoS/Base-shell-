/**
 * Left vertical column: Module section icons (no text).
 * Clicking opens the section's sub-items in the center zone.
 * Gear icon at the bottom opens favorites editor (accessible to all users).
 * Isolated — removing this file has zero impact on the app.
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import { LucideIcon, Star, Plus } from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { MobileFavoritesSettings } from "@/components/settings/MobileFavoritesSettings";

export interface ModuleSidebarItem {
  id: string;
  label: string;
  icon: LucideIcon;
  color: string;
}

interface ModuleSidebarProps {
  sections: ModuleSidebarItem[];
  activeId: string | null;
  onSelect: (id: string | null) => void;
}

export function ModuleSidebar({ sections, activeId, onSelect }: ModuleSidebarProps) {
  const isFavoritesActive = activeId === null;
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="flex flex-col items-center gap-1.5 py-2 h-full">
      {/* Favorites button — always first */}
      <button
        onClick={() => onSelect(null)}
        aria-label="Favoris"
        title="Favoris"
        className={cn(
          "flex items-center justify-center w-11 h-11 rounded-xl",
          "transition-all duration-150 touch-manipulation",
          isFavoritesActive
            ? "bg-amber-50 text-amber-500 shadow-sm ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:ring-amber-800"
            : "text-muted-foreground hover:bg-muted/50 active:bg-muted"
        )}
      >
        <Star className={cn("h-5 w-5", isFavoritesActive && "fill-amber-400 stroke-[2.5]")} />
      </button>

      {/* Divider */}
      <div className="w-6 h-px bg-border my-0.5" />

      {/* Section icons */}
      {sections.map((section) => {
        const Icon = section.icon;
        const isActive = activeId === section.id;
        return (
          <button
            key={section.id}
            onClick={() => onSelect(isActive ? null : section.id)}
            aria-label={section.label}
            title={section.label}
            className={cn(
              "flex items-center justify-center w-11 h-11 rounded-xl",
              "transition-all duration-150 touch-manipulation",
              isActive
                ? `${section.color} shadow-sm ring-1 ring-primary/20`
                : "text-muted-foreground hover:bg-muted/50 active:bg-muted"
            )}
          >
            <Icon className={cn("h-5 w-5", isActive && "stroke-[2.5]")} />
          </button>
        );
      })}

      {/* Divider before gear */}
      <div className="w-6 h-px bg-border my-0.5" />

      {/* Gear icon — opens favorites editor drawer */}
      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DrawerTrigger asChild>
          <button
            aria-label="Gérer les favoris"
            title="Gérer les favoris"
            className={cn(
              "relative flex items-center justify-center w-11 h-11 rounded-xl",
              "transition-all duration-150 touch-manipulation",
              "text-amber-400 hover:bg-amber-50/50 active:bg-amber-50 dark:hover:bg-amber-950/30"
            )}
          >
            <Star className="h-5 w-5" />
            <Plus className="absolute -top-0.5 -right-0.5 h-3 w-3 text-primary bg-background rounded-full" strokeWidth={3} />
          </button>
        </DrawerTrigger>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2">
              <Star className="h-5 w-5 text-amber-500 fill-amber-400" />
              Gérer mes favoris
            </DrawerTitle>
          </DrawerHeader>
          <div className="px-4 pb-6 max-h-[60vh] overflow-y-auto">
            <MobileFavoritesSettings />
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
