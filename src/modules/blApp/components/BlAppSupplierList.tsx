/**
 * MODULE BL-APP — Supplier List (V1)
 */

import { ChevronRight, Package } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface SupplierGroup {
  supplier_id: string | null;
  supplier_name: string;
  count: number;
}

interface Props {
  groups: SupplierGroup[];
  onSelectSupplier: (supplierId: string | null) => void;
  isLoading?: boolean;
}

export function BlAppSupplierList({ groups, onSelectSupplier, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="animate-pulse">
            <CardContent className="p-4">
              <div className="h-5 bg-muted rounded w-1/3 mb-2" />
              <div className="h-4 bg-muted rounded w-1/4" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground">
          <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>Aucun BL-APP pour ce mois</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <Card
          key={g.supplier_id ?? "__unknown__"}
          className="cursor-pointer hover:bg-accent/50 transition-colors"
          onClick={() => onSelectSupplier(g.supplier_id)}
        >
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <h3 className="font-medium">{g.supplier_name}</h3>
              <p className="text-sm text-muted-foreground">
                {g.count} BL{g.count > 1 ? "s" : ""}
              </p>
            </div>
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
