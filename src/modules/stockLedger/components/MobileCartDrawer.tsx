/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MOBILE CART DRAWER — Panier for Reception & Withdrawal
 * ═══════════════════════════════════════════════════════════════════════════
 * Pure view over existing draft lines — no duplication, no recalculation.
 * Actions (edit/delete) delegate to parent callbacks.
 */

import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { ShoppingBasket, Pencil, Trash2, ArrowLeft, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export interface CartLine {
  id: string;
  product_id: string;
  product_name: string;
  delta_quantity_canonical: number;
  canonical_label: string | null;
  /** Pre-formatted contextual display (e.g. "2 Bidon"). Falls back to canonical if absent. */
  displayLabel?: string | null;
}

interface MobileCartDrawerProps {
  open: boolean;
  onClose: () => void;
  lines: CartLine[];
  /** "reception" uses primary colors, "withdrawal" uses destructive */
  variant: "reception" | "withdrawal";
  onEditLine: (lineId: string) => void;
  onDeleteLine: (lineId: string) => void;
  /** If provided, shows "Valider" button at bottom */
  onValidate?: () => void;
  validateLabel?: string;
  validateDisabled?: boolean;
}

export function MobileCartDrawer({
  open,
  onClose,
  lines,
  variant,
  onEditLine,
  onDeleteLine,
  onValidate,
  validateLabel,
  validateDisabled,
}: MobileCartDrawerProps) {
  const isWithdrawal = variant === "withdrawal";
  const accentClass = isWithdrawal ? "text-destructive" : "text-primary";
  const borderClass = isWithdrawal ? "border-destructive/20" : "border-primary/20";
  const bgClass = isWithdrawal ? "bg-destructive/5" : "bg-primary/5";

  return (
    <Drawer open={open} onOpenChange={(v) => !v && onClose()}>
      <DrawerContent className="max-h-[85dvh]">
        <DrawerHeader className="border-b border-border pb-3">
          <div className="flex items-center justify-between">
            <DrawerTitle className="flex items-center gap-2 text-base">
              <ShoppingBasket className="h-5 w-5" />
              Panier
              <Badge variant="secondary" className="ml-1">
                {lines.length}
              </Badge>
            </DrawerTitle>
          </div>
        </DrawerHeader>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 min-h-0">
          {lines.length === 0 ? (
            <p className="text-center text-muted-foreground text-sm py-8">Aucun produit ajouté</p>
          ) : (
            lines.map((line) => (
              <div
                key={line.id}
                className={`rounded-xl border ${borderClass} ${bgClass} p-3 flex items-center justify-between gap-2`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate uppercase">{line.product_name}</p>
                  <p className={`text-xs font-semibold ${accentClass}`}>
                    {isWithdrawal ? "−" : "+"}
                    {line.displayLabel ?? `${Math.abs(line.delta_quantity_canonical)} ${line.canonical_label ?? ""}`}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground"
                    onClick={() => onEditLine(line.id)}
                    aria-label="Modifier la ligne"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive"
                    onClick={() => onDeleteLine(line.id)}
                    aria-label="Supprimer la ligne"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Bottom actions */}
        <div className="border-t border-border p-4 space-y-2">
          {onValidate && lines.length > 0 && (
            <Button
              className="h-11 px-6 text-sm font-semibold rounded-full shadow-sm mx-auto"
              variant={isWithdrawal ? "destructive" : "default"}
              onClick={onValidate}
              disabled={validateDisabled}
            >
              <Send className="h-4 w-4 mr-2" />
              {validateLabel ?? `Valider (${lines.length})`}
            </Button>
          )}
          <Button variant="outline" className="w-full" onClick={onClose}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Retour à la saisie
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

/** Cart trigger button — replaces the old chip */
export function CartTriggerButton({
  count,
  onClick,
  variant = "reception",
}: {
  count: number;
  onClick: () => void;
  variant?: "reception" | "withdrawal";
}) {
  if (count === 0) return null;
  const isWithdrawal = variant === "withdrawal";

  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 text-xs font-medium rounded-full px-3 py-1.5 transition-all active:scale-[0.96] ${
        isWithdrawal
          ? "bg-destructive/10 text-destructive border border-destructive/20"
          : "bg-primary/10 text-primary border border-primary/20"
      }`}
    >
      <ShoppingBasket className="h-3.5 w-3.5" />
      <span className="font-semibold">{count}</span>
      <span>Panier</span>
    </button>
  );
}
