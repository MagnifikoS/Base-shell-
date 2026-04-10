/**
 * Suppliers Grid — Card-based layout with logo/icon support
 */

import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Building2, Trash2, type LucideIcon } from "lucide-react";
import { SUPPLIER_ICON_OPTIONS } from "../utils/supplierIcons";
import type { Supplier } from "../services/supplierService";

interface SuppliersListProps {
  suppliers: Supplier[];
  onEdit: (supplier: Supplier) => void;
  onDelete: (supplier: Supplier) => void;
}

/** Resolve logo_url: either an uploaded image URL or an icon: reference */
function resolveLogoDisplay(logoUrl: string | null | undefined): {
  type: "image" | "icon" | "default";
  src?: string;
  Icon?: LucideIcon;
} {
  if (!logoUrl) return { type: "default" };
  if (logoUrl.startsWith("icon:")) {
    const iconKey = logoUrl.replace("icon:", "");
    const found = SUPPLIER_ICON_OPTIONS.find((o) => o.key === iconKey);
    return found ? { type: "icon", Icon: found.icon } : { type: "default" };
  }
  return { type: "image", src: logoUrl };
}

export function SuppliersList({ suppliers, onDelete }: SuppliersListProps) {
  const navigate = useNavigate();

  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
      {suppliers.map((supplier) => {
        const logoUrl = supplier.logo_url;
        const display = resolveLogoDisplay(logoUrl);
        return (
          <div key={supplier.id} className="group relative">
            <button
              onClick={() => navigate(`/fournisseurs/${supplier.id}`)}
              className="w-full text-left"
            >
              <Card className="hover:bg-accent/50 transition-colors h-full">
                <CardContent className="p-3 flex flex-col items-center text-center h-full">
                  <div
                    className={`w-full aspect-[3/2] rounded-lg flex items-center justify-center overflow-hidden mb-2 ${display.type === "image" ? "p-2" : "bg-muted/30"}`}
                  >
                    {display.type === "image" && (
                      <img
                        src={display.src}
                        alt={supplier.name}
                        className="max-w-full max-h-full object-contain"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = "none";
                          const parent = e.currentTarget.parentElement;
                          if (parent) {
                            parent.classList.add("bg-muted/30");
                            const icon = document.createElement("span");
                            icon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-muted-foreground"><rect width="16" height="20" x="4" y="2" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/></svg>';
                            parent.appendChild(icon);
                          }
                        }}
                      />
                    )}
                    {display.type === "icon" && display.Icon && (
                      <display.Icon className="h-6 w-6 text-muted-foreground" />
                    )}
                    {display.type === "default" && <Building2 className="h-5 w-5 text-muted-foreground" />}
                  </div>
                  <p className="font-medium text-xs uppercase leading-tight line-clamp-2">
                    {supplier.name}
                  </p>
                  {supplier.supplier_type && (
                    <Badge variant="secondary" className="mt-1.5 text-xs">
                      {supplier.supplier_type}
                    </Badge>
                  )}
                </CardContent>
              </Card>
            </button>
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(supplier);
              }}
              aria-label="Supprimer le fournisseur"
            >
              <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          </div>
        );
      })}
    </div>
  );
}
