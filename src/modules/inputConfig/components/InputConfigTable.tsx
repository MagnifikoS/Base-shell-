import { Checkbox } from "@/components/ui/checkbox";
import { ConfigStatusBadge } from "./ConfigStatusBadge";
import type { ProductForConfig } from "../types";

interface Props {
  products: ProductForConfig[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  allSelected: boolean;
  onProductClick: (product: ProductForConfig) => void;
}

export function InputConfigTable({ products, selectedIds, onToggle, onToggleAll, allSelected, onProductClick }: Props) {
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      {/* Header — hidden on mobile, shown as cards instead */}
      <div className="hidden sm:grid sm:grid-cols-[40px_1fr_100px_60px_120px_120px] bg-muted/50 text-xs font-medium text-muted-foreground px-3 py-2.5 gap-2 items-center border-b border-border">
        <div className="flex justify-center">
          <Checkbox
            checked={allSelected}
            onCheckedChange={onToggleAll}
          />
        </div>
        <div>Produit</div>
        <div>Unité</div>
        <div className="text-center">Niv.</div>
        <div>Réception</div>
        <div>Interne</div>
      </div>

      {/* Rows */}
      <div className="divide-y divide-border">
        {products.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            Aucun produit trouvé
          </div>
        )}
        {products.map((p) => (
          <ProductRow
            key={p.id}
            product={p}
            selected={selectedIds.has(p.id)}
            onToggle={() => onToggle(p.id)}
            onClick={() => onProductClick(p)}
          />
        ))}
      </div>
    </div>
  );
}

function ProductRow({
  product: p,
  selected,
  onToggle,
  onClick,
}: {
  product: ProductForConfig;
  selected: boolean;
  onToggle: () => void;
  onClick: () => void;
}) {
  return (
    <>
      {/* Desktop row */}
      <div
        className={`hidden sm:grid sm:grid-cols-[40px_1fr_100px_60px_120px_120px] gap-2 items-center px-3 py-2 text-sm transition-colors cursor-pointer hover:bg-muted/30 ${
          selected ? "bg-primary/5" : ""
        }`}
        onClick={onClick}
      >
        <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
          <Checkbox checked={selected} onCheckedChange={onToggle} />
        </div>
        <div className="font-medium truncate uppercase">{p.nom_produit}</div>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground truncate text-xs">{p.final_unit ?? "—"}</span>
        </div>
        <div className="text-center text-muted-foreground">{p.packaging_levels_count}</div>
        <div>
          <ConfigStatusBadge status={p.reception_status} />
        </div>
        <div>
          <ConfigStatusBadge status={p.internal_status} />
        </div>
      </div>

      {/* Mobile card */}
      <div
        className={`sm:hidden flex items-start gap-3 px-3 py-3 transition-colors cursor-pointer ${
          selected ? "bg-primary/5" : ""
        }`}
        onClick={onClick}
      >
        <div className="pt-0.5" onClick={(e) => e.stopPropagation()}>
          <Checkbox checked={selected} onCheckedChange={onToggle} />
        </div>
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="font-medium text-sm truncate uppercase">{p.nom_produit}</div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">{p.final_unit ?? "—"}</span>
            <span className="text-xs text-muted-foreground">· {p.packaging_levels_count} niv.</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Réc.</span>
            <ConfigStatusBadge status={p.reception_status} />
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider ml-1">Int.</span>
            <ConfigStatusBadge status={p.internal_status} />
          </div>
        </div>
      </div>
    </>
  );
}
