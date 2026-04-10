/**
 * Grouping Grid Component -- reusable card grid for grouping items by category/supplier/zone.
 *
 * Originally in inventaire module, extracted to shared to break the
 * produitsV2 <-> inventaire circular dependency.
 *
 * Used by: inventaire (DesktopInventoryView), produitsV2 (ProduitsV2ListPage).
 */

import { ArrowLeft, FileDown, Package } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getCategoryIcon } from "@/shared/categoryIcons";
import type { LucideIcon } from "lucide-react";

export interface GroupItem {
  key: string;
  label: string;
  count: number;
  icon?: LucideIcon;
  logoUrl?: string | null;
}

interface Props {
  groups: GroupItem[];
  selectedGroup: string | null;
  onSelectGroup: (key: string) => void;
  onBack: () => void;
  mode: "category" | "supplier" | "zone";
  onExportPdf?: (groupKey: string) => void;
}

export function GroupingGrid({
  groups,
  selectedGroup,
  onSelectGroup,
  onBack: _onBack,
  mode,
  onExportPdf,
}: Props) {
  if (selectedGroup) return null; // parent handles filtered table

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {groups.map((group) => {
          const IconComp =
            group.icon ?? (mode === "category" ? getCategoryIcon(group.label) : Package);
          return (
            <div key={group.key} className="group relative">
              <button
                onClick={() => onSelectGroup(group.key)}
                className="text-left w-full"
                aria-label={`Ouvrir le groupe ${group.label}`}
              >
                <Card className="hover:bg-accent/50 transition-colors h-full">
                  <CardContent className="p-4 flex flex-col items-center gap-3 text-center">
                    <div
                      className={`w-16 h-16 min-w-[4rem] min-h-[4rem] max-w-[4rem] max-h-[4rem] rounded-xl flex items-center justify-center transition-colors overflow-hidden ${group.logoUrl ? "" : "bg-primary/10 group-hover:bg-primary/20"}`}
                    >
                      {group.logoUrl ? (
                        <img
                          src={group.logoUrl}
                          alt={group.label}
                          className="max-w-[3.5rem] max-h-[3.5rem] object-contain"
                        />
                      ) : (
                        <IconComp className="h-8 w-8 text-primary" />
                      )}
                    </div>
                    <div>
                      <p className="font-medium text-sm uppercase leading-tight">{group.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {group.count} produit{group.count > 1 ? "s" : ""}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </button>
              {mode === "supplier" && onExportPdf && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation();
                    onExportPdf(group.key);
                  }}
                  aria-label={`Telecharger PDF stock pour ${group.label}`}
                >
                  <FileDown className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function GroupBackHeader({
  label,
  onBack,
  onExportPdf,
}: {
  label: string;
  onBack: () => void;
  onExportPdf?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <Button
        variant="ghost"
        size="icon"
        onClick={onBack}
        aria-label="Retour a la liste des groupes"
      >
        <ArrowLeft className="h-5 w-5" />
      </Button>
      <h2 className="text-lg font-semibold uppercase flex-1">{label}</h2>
      {onExportPdf && (
        <Button
          variant="outline"
          size="sm"
          onClick={onExportPdf}
          className="gap-2"
          aria-label={`Exporter PDF stock pour ${label}`}
        >
          <FileDown className="h-4 w-4" />
          PDF Stock
        </Button>
      )}
    </div>
  );
}
