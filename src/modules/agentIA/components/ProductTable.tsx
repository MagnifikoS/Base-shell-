/**
 * ProductTable — Editable table of AI-extracted products.
 * Two sections: AUTO (green) and AMBIGU (orange).
 * Mobile: card layout. Desktop: table layout.
 * Cells are clickable to open edit popups.
 * Toggles for vente_unite and fractionne are inline.
 * Isolated — removing this file has zero impact on the app.
 */

import { useState } from "react";
import { Pencil, ArrowLeft, ChevronRight } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { EditPopup } from "./popups/EditPopup";
import { PackagingPopup } from "./popups/PackagingPopup";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";

interface NiveauConditionnement {
  nom_niveau: string | null;
  contient_quantite: number | null;
  contient_unite_abbr: { id: string; abbreviation: string } | null;
}

interface ProduitExtrait {
  nom: string | null;
  reference: string | null;
  barcode: string | null;
  fournisseur: { id: string; name: string } | null;
  categorie: { id: string; name: string } | null;
  niveaux_conditionnement: NiveauConditionnement[] | null;
  unite_finale_abbr: { id: string; abbreviation: string } | null;
  unite_facturation_abbr: { id: string; abbreviation: string } | null;
  quantite_facturee: number | null;
  prix_unitaire_ht: number | null;
  prix_ligne_ht: number | null;
  tva_rate: number | null;
  tva_source: "explicite_validee" | "calculee" | "suggeree_par_categorie" | "corrigee_utilisateur" | null;
  zone_stockage: { id: string; name: string } | null;
  unite_interne_suggestion: string | null;
  vente_unite: boolean | null;
  fractionne: boolean | null;
  classification: "AUTO" | "AMBIGU" | string;
  manquants: string[];
}

interface UnitOption {
  id: string;
  name: string;
  abbreviation: string;
  family: string | null;
}

interface DropdownOption {
  id: string;
  name: string;
}

interface WizardOptsForTable {
  suppliers: DropdownOption[];
  categories: DropdownOption[];
  storageZones: { id: string; name: string; name_normalized?: string }[];
  units: UnitOption[];
}

interface ProductTableProps {
  produits: ProduitExtrait[];
  wizardOpts: WizardOptsForTable;
  anomalieTotalTtc?: boolean;
  onUpdateProduct: (index: number, updated: ProduitExtrait) => void;
}

// ─── Formatting helpers ───

function formatConditionnement(niveaux: NiveauConditionnement[] | null): string | null {
  if (!niveaux || niveaux.length === 0) return null;

  const segments: string[] = [];
  for (let i = 0; i < niveaux.length; i++) {
    const n = niveaux[i];
    if (i === 0 && n.nom_niveau) {
      segments.push(n.nom_niveau);
    }
    const parts: string[] = [];
    if (n.contient_quantite != null) parts.push(String(n.contient_quantite));
    if (n.contient_unite_abbr) parts.push(n.contient_unite_abbr.abbreviation);
    if (parts.length > 0) {
      segments.push(parts.join(" "));
    }
  }

  return segments.length > 0 ? segments.join(" → ") : null;
}

const NULL_CELL_CLASS = "bg-orange-50 dark:bg-orange-950/20";
const TVA_SUGGESTION_CLASS = "text-orange-500 dark:text-orange-400";

const TVA_OPTIONS = [
  { value: "5.5", label: "5.5%" },
  { value: "10", label: "10%" },
  { value: "20", label: "20%" },
  { value: "", label: "—" },
];

function formatTva(rate: number | null, source: ProduitExtrait["tva_source"]): { text: string; className: string } {
  if (rate == null) return { text: "—", className: "" };
  if (source === "suggeree_par_categorie") return { text: `${rate}%?`, className: TVA_SUGGESTION_CLASS };
  return { text: `${rate}%`, className: "" };
}

// ─── Popup state type ───

type PopupState =
  | null
  | { type: "text"; productIndex: number; field: "nom"; value: string }
  | { type: "number"; productIndex: number; field: "prix_unitaire_ht" | "prix_ligne_ht"; value: string }
  | { type: "dropdown-supplier"; productIndex: number; value: string }
  | { type: "dropdown"; productIndex: number; field: "categorie" | "zone_stockage" | "unite_finale_abbr" | "unite_facturation_abbr"; value: string }
  | { type: "dropdown-tva"; productIndex: number; value: string }
  | { type: "packaging"; productIndex: number };

// ─── Mobile: clickable field row ───

function ClickableField({
  label,
  isNull,
  onClick,
  children,
}: {
  label: string;
  isNull: boolean;
  onClick: () => void;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-between w-full text-left px-2 py-1.5 rounded text-sm transition-colors hover:bg-accent/50 group ${isNull ? NULL_CELL_CLASS : ""}`}
    >
      <span className="text-muted-foreground text-xs min-w-[80px]">{label}</span>
      <span className="flex items-center gap-1 text-right flex-1 justify-end">
        <span className="truncate">{children}</span>
        <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0" />
      </span>
    </button>
  );
}

// ─── Desktop: clickable table cell ───

function ClickableCell({
  isNull,
  onClick,
  children,
}: {
  isNull: boolean;
  onClick: () => void;
  children?: React.ReactNode;
}) {
  return (
    <td
      className={`px-2 py-1.5 text-xs cursor-pointer hover:bg-accent/50 transition-colors group whitespace-nowrap ${isNull ? NULL_CELL_CLASS : ""}`}
      onClick={onClick}
    >
      <div className="flex items-center gap-1">
        <span className="flex-1">{children}</span>
        <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
      </div>
    </td>
  );
}

// ─── Mobile: product list item ───

function MobileProductListItem({
  product,
  globalIndex,
  onClick,
}: {
  product: ProduitExtrait;
  globalIndex: number;
  onClick: (index: number) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(globalIndex)}
      className="flex items-center gap-3 w-full text-left rounded-lg border bg-card px-4 py-3 transition-colors hover:bg-accent/50"
    >
      <StatusBadge classification={product.classification} manquants={product.manquants ?? []} />
      <span className="flex-1 text-sm font-medium truncate">{product.nom ?? "—"}</span>
      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
    </button>
  );
}

// ─── Mobile: product detail view ───

function MobileProductDetail({
  product: p,
  globalIndex,
  onBack,
  onOpenPopup,
  onToggle,
}: {
  product: ProduitExtrait;
  globalIndex: number;
  onBack: () => void;
  onOpenPopup: (popup: PopupState) => void;
  onToggle: (index: number, field: "vente_unite" | "fractionne", value: boolean) => void;
}) {
  const condText = formatConditionnement(p.niveaux_conditionnement);
  const tva = formatTva(p.tva_rate, p.tva_source);

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Retour à la liste
      </button>

      <div className="flex items-center gap-2">
        <StatusBadge classification={p.classification} manquants={p.manquants ?? []} />
        <h3 className="text-base font-semibold">{p.nom ?? "—"}</h3>
      </div>

      <div className="rounded-lg border bg-card divide-y">
        <ClickableField label="Nom" isNull={p.nom == null} onClick={() => onOpenPopup({ type: "text", productIndex: globalIndex, field: "nom", value: p.nom ?? "" })}>
          {p.nom}
        </ClickableField>
        <ClickableField label="Fournisseur" isNull={p.fournisseur == null} onClick={() => onOpenPopup({ type: "dropdown-supplier", productIndex: globalIndex, value: p.fournisseur?.id ?? "" })}>
          {p.fournisseur?.name}
        </ClickableField>
        <ClickableField label="Catégorie" isNull={p.categorie == null} onClick={() => onOpenPopup({ type: "dropdown", productIndex: globalIndex, field: "categorie", value: p.categorie?.id ?? "" })}>
          {p.categorie?.name}
        </ClickableField>
        <ClickableField label="Conditionnement" isNull={condText == null} onClick={() => onOpenPopup({ type: "packaging", productIndex: globalIndex })}>
          {condText && <span className="font-mono text-xs">{condText}</span>}
        </ClickableField>
        <ClickableField label="Unité finale" isNull={p.unite_finale_abbr == null} onClick={() => onOpenPopup({ type: "dropdown", productIndex: globalIndex, field: "unite_finale_abbr", value: p.unite_finale_abbr?.id ?? "" })}>
          {p.unite_finale_abbr?.abbreviation}
        </ClickableField>
        <ClickableField label="Unité fact." isNull={p.unite_facturation_abbr == null} onClick={() => onOpenPopup({ type: "dropdown", productIndex: globalIndex, field: "unite_facturation_abbr", value: p.unite_facturation_abbr?.id ?? "" })}>
          {p.unite_facturation_abbr?.abbreviation}
        </ClickableField>
        <ClickableField label="Quantité" isNull={p.quantite_facturee == null} onClick={() => {}}>
          {p.quantite_facturee != null ? String(p.quantite_facturee) : null}
        </ClickableField>
        <ClickableField label="P.U. HT" isNull={p.prix_unitaire_ht == null} onClick={() => onOpenPopup({ type: "number", productIndex: globalIndex, field: "prix_unitaire_ht", value: p.prix_unitaire_ht != null ? String(p.prix_unitaire_ht) : "" })}>
          {p.prix_unitaire_ht != null ? `${Number(p.prix_unitaire_ht).toFixed(2)} €` : null}
        </ClickableField>
        <ClickableField label="Total ligne HT" isNull={p.prix_ligne_ht == null} onClick={() => onOpenPopup({ type: "number", productIndex: globalIndex, field: "prix_ligne_ht", value: p.prix_ligne_ht != null ? String(p.prix_ligne_ht) : "" })}>
          {p.prix_ligne_ht != null ? `${Number(p.prix_ligne_ht).toFixed(2)} €` : null}
        </ClickableField>
        <ClickableField label="TVA" isNull={p.tva_rate == null} onClick={() => onOpenPopup({ type: "dropdown-tva", productIndex: globalIndex, value: p.tva_rate != null ? String(p.tva_rate) : "" })}>
          <span className={tva.className}>{tva.text}</span>
        </ClickableField>
        <ClickableField label="Zone" isNull={p.zone_stockage == null} onClick={() => onOpenPopup({ type: "dropdown", productIndex: globalIndex, field: "zone_stockage", value: p.zone_stockage?.id ?? "" })}>
          {p.zone_stockage?.name}
        </ClickableField>
      </div>

      <div className="rounded-lg border bg-card px-4 py-3 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Vente à l'unité</span>
          <Switch checked={p.vente_unite ?? false} onCheckedChange={(checked) => onToggle(globalIndex, "vente_unite", checked)} />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Fractionné</span>
          <Switch checked={p.fractionne ?? false} onCheckedChange={(checked) => onToggle(globalIndex, "fractionne", checked)} />
        </div>
      </div>
    </div>
  );
}

// ─── Product Section (desktop only now) ───

function ProductSection({
  title,
  produits,
  globalIndices,
  onOpenPopup,
  onToggle,
}: {
  title: string;
  produits: ProduitExtrait[];
  globalIndices: number[];
  onOpenPopup: (popup: PopupState) => void;
  onToggle: (index: number, field: "vente_unite" | "fractionne", value: boolean) => void;
}) {
  if (produits.length === 0) return null;

  const paired = produits.map((p, i) => ({ product: p, globalIndex: globalIndices[i] }));
  paired.sort((a, b) => (a.product.nom ?? "").localeCompare(b.product.nom ?? "", "fr"));

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-muted-foreground">{title}</h3>

      {/* Desktop only: table */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="text-left" style={{ minWidth: "1290px", width: "100%" }}>
          <colgroup>
            <col style={{ width: "60px" }} />
            <col style={{ width: "180px" }} />
            <col style={{ width: "140px" }} />
            <col style={{ width: "130px" }} />
            <col style={{ width: "200px" }} />
            <col style={{ width: "50px" }} />
            <col style={{ width: "50px" }} />
            <col style={{ width: "80px" }} />
            <col style={{ width: "90px" }} />
            <col style={{ width: "55px" }} />
            <col style={{ width: "120px" }} />
            <col style={{ width: "55px" }} />
            <col style={{ width: "55px" }} />
          </colgroup>
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-2 py-2 text-xs font-medium">Statut</th>
              <th className="px-2 py-2 text-xs font-medium">Nom</th>
              <th className="px-2 py-2 text-xs font-medium">Fourn.</th>
              <th className="px-2 py-2 text-xs font-medium">Catégorie</th>
              <th className="px-2 py-2 text-xs font-medium">Cond.</th>
              <th className="px-2 py-2 text-xs font-medium">U.f</th>
              <th className="px-2 py-2 text-xs font-medium">U.fact</th>
              <th className="px-2 py-2 text-xs font-medium">P.U. HT</th>
              <th className="px-2 py-2 text-xs font-medium">Total ligne HT</th>
              <th className="px-2 py-2 text-xs font-medium" title="Taux de TVA">TVA</th>
              <th className="px-2 py-2 text-xs font-medium">Zone</th>
              <th className="px-2 py-2 text-xs font-medium text-center" title="Vente à l'unité">Vente/u.</th>
              <th className="px-2 py-2 text-xs font-medium text-center" title="Fractionnable">Fract.</th>
            </tr>
          </thead>
          <tbody>
            {paired.map(({ product: p, globalIndex }, i) => {
              const condText = formatConditionnement(p.niveaux_conditionnement);
              return (
                <tr key={globalIndex} className={i % 2 === 1 ? "bg-muted/20" : ""}>
                  <td className="px-2 py-1.5">
                    <StatusBadge classification={p.classification} manquants={p.manquants ?? []} />
                  </td>
                  <ClickableCell isNull={p.nom == null} onClick={() => onOpenPopup({ type: "text", productIndex: globalIndex, field: "nom", value: p.nom ?? "" })}>
                    {p.nom}
                  </ClickableCell>
                  <ClickableCell isNull={p.fournisseur == null} onClick={() => onOpenPopup({ type: "dropdown-supplier", productIndex: globalIndex, value: p.fournisseur?.id ?? "" })}>
                    {p.fournisseur?.name}
                  </ClickableCell>
                  <ClickableCell isNull={p.categorie == null} onClick={() => onOpenPopup({ type: "dropdown", productIndex: globalIndex, field: "categorie", value: p.categorie?.id ?? "" })}>
                    {p.categorie?.name}
                  </ClickableCell>
                  <ClickableCell isNull={condText == null} onClick={() => onOpenPopup({ type: "packaging", productIndex: globalIndex })}>
                    {condText && <span className="font-mono text-[11px]">{condText}</span>}
                  </ClickableCell>
                  <ClickableCell isNull={p.unite_finale_abbr == null} onClick={() => onOpenPopup({ type: "dropdown", productIndex: globalIndex, field: "unite_finale_abbr", value: p.unite_finale_abbr?.id ?? "" })}>
                    {p.unite_finale_abbr?.abbreviation}
                  </ClickableCell>
                  <ClickableCell isNull={p.unite_facturation_abbr == null} onClick={() => onOpenPopup({ type: "dropdown", productIndex: globalIndex, field: "unite_facturation_abbr", value: p.unite_facturation_abbr?.id ?? "" })}>
                    {p.unite_facturation_abbr?.abbreviation}
                  </ClickableCell>
                  <ClickableCell isNull={p.prix_unitaire_ht == null} onClick={() => onOpenPopup({ type: "number", productIndex: globalIndex, field: "prix_unitaire_ht", value: p.prix_unitaire_ht != null ? String(p.prix_unitaire_ht) : "" })}>
                    {p.prix_unitaire_ht != null ? `${Number(p.prix_unitaire_ht).toFixed(2)}€` : null}
                  </ClickableCell>
                  <ClickableCell isNull={p.prix_ligne_ht == null} onClick={() => onOpenPopup({ type: "number", productIndex: globalIndex, field: "prix_ligne_ht", value: p.prix_ligne_ht != null ? String(p.prix_ligne_ht) : "" })}>
                    {p.prix_ligne_ht != null ? `${Number(p.prix_ligne_ht).toFixed(2)}€` : null}
                  </ClickableCell>
                  {(() => { const tva = formatTva(p.tva_rate, p.tva_source); return (
                  <ClickableCell isNull={p.tva_rate == null} onClick={() => onOpenPopup({ type: "dropdown-tva", productIndex: globalIndex, value: p.tva_rate != null ? String(p.tva_rate) : "" })}>
                    <span className={tva.className}>{tva.text}</span>
                  </ClickableCell>
                  ); })()}
                  <ClickableCell isNull={p.zone_stockage == null} onClick={() => onOpenPopup({ type: "dropdown", productIndex: globalIndex, field: "zone_stockage", value: p.zone_stockage?.id ?? "" })}>
                    {p.zone_stockage?.name}
                  </ClickableCell>
                  <td className="px-1 py-1.5 text-center">
                    <Switch checked={p.vente_unite ?? false} onCheckedChange={(checked) => onToggle(globalIndex, "vente_unite", checked)} />
                  </td>
                  <td className="px-1 py-1.5 text-center">
                    <Switch checked={p.fractionne ?? false} onCheckedChange={(checked) => onToggle(globalIndex, "fractionne", checked)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Dropdown popup content ───

function DropdownPopupContent({
  options,
  value,
  onChange,
  allowFreeText,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  allowFreeText?: boolean;
}) {
  return (
    <div className="space-y-2">
      <select
        value={options.some((o) => o.value === value) ? value : "__custom__"}
        onChange={(e) => {
          if (e.target.value !== "__custom__") {
            onChange(e.target.value);
          }
        }}
        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
      >
        <option value="">— Aucun —</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
        {allowFreeText && value && !options.some((o) => o.value === value) && (
          <option value="__custom__">Autre: {value}</option>
        )}
      </select>
      {allowFreeText && (
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Saisie libre</label>
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Nom du fournisseur"
            className="h-8 text-sm"
          />
        </div>
      )}
    </div>
  );
}

// ─── Main component ───

export function ProductTable({ produits, wizardOpts, anomalieTotalTtc, onUpdateProduct }: ProductTableProps) {
  const [popup, setPopup] = useState<PopupState>(null);
  const [draftValue, setDraftValue] = useState("");
  const [selectedMobileIndex, setSelectedMobileIndex] = useState<number | null>(null);

  const autoIndices: number[] = [];
  const ambiguIndices: number[] = [];
  const autoProducts: ProduitExtrait[] = [];
  const ambiguProducts: ProduitExtrait[] = [];

  produits.forEach((p, i) => {
    if (p.classification === "AUTO") {
      autoProducts.push(p);
      autoIndices.push(i);
    } else if (p.classification === "AMBIGU") {
      ambiguProducts.push(p);
      ambiguIndices.push(i);
    }
  });

  const handleOpenPopup = (p: PopupState) => {
    if (!p) return;
    setPopup(p);
    if (p.type === "text" || p.type === "number" || p.type === "dropdown" || p.type === "dropdown-supplier" || p.type === "dropdown-tva") {
      setDraftValue(p.value);
    }
  };

  const handleToggle = (index: number, field: "vente_unite" | "fractionne", value: boolean) => {
    const product = produits[index];
    onUpdateProduct(index, { ...product, [field]: value });
  };

  const handleValidateSimple = () => {
    if (!popup) return;

    if (popup.type === "text") {
      const product = produits[popup.productIndex];
      onUpdateProduct(popup.productIndex, { ...product, [popup.field]: draftValue || null });
    } else if (popup.type === "number") {
      const product = produits[popup.productIndex];
      const numVal = draftValue ? Number(draftValue) : null;
      onUpdateProduct(popup.productIndex, { ...product, [popup.field]: numVal });
    } else if (popup.type === "dropdown") {
      const product = produits[popup.productIndex];
      if (popup.field === "categorie") {
        const selected = draftValue ? wizardOpts.categories.find((c) => c.id === draftValue) : null;
        onUpdateProduct(popup.productIndex, { ...product, categorie: selected ? { id: selected.id, name: selected.name } : null });
      } else if (popup.field === "zone_stockage") {
        const selected = draftValue ? wizardOpts.storageZones.find((z) => z.id === draftValue) : null;
        onUpdateProduct(popup.productIndex, { ...product, zone_stockage: selected ? { id: selected.id, name: selected.name } : null });
      } else if (popup.field === "unite_finale_abbr" || popup.field === "unite_facturation_abbr") {
        const selected = draftValue ? wizardOpts.units.find((u) => u.id === draftValue) : null;
        onUpdateProduct(popup.productIndex, { ...product, [popup.field]: selected ? { id: selected.id, abbreviation: selected.abbreviation } : null });
      }
    } else if (popup.type === "dropdown-supplier") {
      const product = produits[popup.productIndex];
      const selectedSupplier = draftValue ? wizardOpts.suppliers.find((s) => s.id === draftValue) : null;
      onUpdateProduct(popup.productIndex, { ...product, fournisseur: selectedSupplier ? { id: selectedSupplier.id, name: selectedSupplier.name } : null });
    } else if (popup.type === "dropdown-tva") {
      const product = produits[popup.productIndex];
      const tvaVal = draftValue ? Number(draftValue) : null;
      onUpdateProduct(popup.productIndex, {
        ...product,
        tva_rate: tvaVal,
        tva_source: tvaVal != null ? "corrigee_utilisateur" : null,
      });
    }

    setPopup(null);
  };

  const handleValidatePackaging = (niveaux: NiveauConditionnement[]) => {
    if (!popup || popup.type !== "packaging") return;
    const product = produits[popup.productIndex];
    onUpdateProduct(popup.productIndex, { ...product, niveaux_conditionnement: niveaux.length > 0 ? niveaux : null });
    setPopup(null);
  };

  const getDropdownOptions = (): { value: string; label: string }[] => {
    if (!popup) return [];
    if (popup.type === "dropdown-supplier") {
      return wizardOpts.suppliers.map((s) => ({ value: s.id, label: s.name }));
    }
    if (popup.type === "dropdown-tva") {
      return TVA_OPTIONS;
    }
    if (popup.type === "dropdown") {
      switch (popup.field) {
        case "categorie":
          return wizardOpts.categories.map((c) => ({ value: c.id, label: c.name }));
        case "zone_stockage":
          return wizardOpts.storageZones.map((z) => ({ value: z.id, label: z.name }));
        case "unite_finale_abbr":
        case "unite_facturation_abbr":
          return wizardOpts.units.map((u) => ({ value: u.id, label: u.abbreviation }));
        default:
          return [];
      }
    }
    return [];
  };

  const getPopupTitle = (): string => {
    if (!popup) return "";
    switch (popup.type) {
      case "text": return "Modifier le nom";
      case "number": return popup.field === "prix_unitaire_ht" ? "Prix unitaire HT" : "Total ligne HT";
      case "dropdown-supplier": return "Fournisseur";
      case "dropdown-tva": return "Taux de TVA";
      case "dropdown": {
        switch (popup.field) {
          case "categorie": return "Catégorie";
          case "zone_stockage": return "Zone de stockage";
          case "unite_finale_abbr": return "Unité finale";
          case "unite_facturation_abbr": return "Unité de facturation";
          default: return "Modifier";
        }
      }
      default: return "";
    }
  };

  // Build sorted list for mobile (AUTO first, then AMBIGU, alphabetical within each)
  const allSorted = [
    ...autoIndices.map((gi) => ({ globalIndex: gi, product: produits[gi], section: "AUTO" as const })),
    ...ambiguIndices.map((gi) => ({ globalIndex: gi, product: produits[gi], section: "AMBIGU" as const })),
  ];
  allSorted.sort((a, b) => {
    if (a.section !== b.section) return a.section === "AUTO" ? -1 : 1;
    return (a.product.nom ?? "").localeCompare(b.product.nom ?? "", "fr");
  });

  const mobileProduct = selectedMobileIndex != null ? produits[selectedMobileIndex] : null;

  return (
    <div className="space-y-6">
      {/* Anomaly banner */}
      {anomalieTotalTtc && (
        <div className="flex items-center gap-2 text-sm bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800 rounded-lg px-4 py-3">
          <span>⚠️</span>
          <span>Écart détecté entre le total TTC calculé et le total de la facture. Vérifiez les TVA avant de valider.</span>
        </div>
      )}

      {/* ═══ MOBILE VIEW ═══ */}
      <div className="md:hidden">
        {mobileProduct && selectedMobileIndex != null ? (
          <MobileProductDetail
            product={mobileProduct}
            globalIndex={selectedMobileIndex}
            onBack={() => setSelectedMobileIndex(null)}
            onOpenPopup={handleOpenPopup}
            onToggle={handleToggle}
          />
        ) : (
          <div className="space-y-4">
            {autoIndices.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-muted-foreground">Prêts ({autoProducts.length})</h3>
                <div className="flex flex-col gap-2">
                  {allSorted.filter((s) => s.section === "AUTO").map(({ globalIndex, product }) => (
                    <MobileProductListItem
                      key={globalIndex}
                      product={product}
                      globalIndex={globalIndex}
                      onClick={setSelectedMobileIndex}
                    />
                  ))}
                </div>
              </div>
            )}
            {ambiguIndices.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-muted-foreground">À compléter ({ambiguProducts.length})</h3>
                <div className="flex flex-col gap-2">
                  {allSorted.filter((s) => s.section === "AMBIGU").map(({ globalIndex, product }) => (
                    <MobileProductListItem
                      key={globalIndex}
                      product={product}
                      globalIndex={globalIndex}
                      onClick={setSelectedMobileIndex}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══ DESKTOP VIEW (unchanged) ═══ */}
      <div className="hidden md:block space-y-6">
        <ProductSection
          title={`Prêts (${autoProducts.length})`}
          produits={autoProducts}
          globalIndices={autoIndices}
          onOpenPopup={handleOpenPopup}
          onToggle={handleToggle}
        />
        <ProductSection
          title={`À compléter (${ambiguProducts.length})`}
          produits={ambiguProducts}
          globalIndices={ambiguIndices}
          onOpenPopup={handleOpenPopup}
          onToggle={handleToggle}
        />
      </div>

      {/* Simple popups (text, number, dropdown) */}
      {popup && popup.type !== "packaging" && (
        <EditPopup
          title={getPopupTitle()}
          onClose={() => setPopup(null)}
          onValidate={handleValidateSimple}
        >
          {popup.type === "text" && (
            <Input
              value={draftValue}
              onChange={(e) => setDraftValue(e.target.value)}
              placeholder="Saisir une valeur"
              autoFocus
            />
          )}
          {popup.type === "number" && (
            <Input
              type="number"
              step="0.01"
              value={draftValue}
              onChange={(e) => setDraftValue(e.target.value)}
              placeholder="0.00"
              autoFocus
            />
          )}
          {(popup.type === "dropdown" || popup.type === "dropdown-supplier" || popup.type === "dropdown-tva") && (
            <DropdownPopupContent
              options={getDropdownOptions()}
              value={draftValue}
              onChange={setDraftValue}
            />
          )}
        </EditPopup>
      )}

      {/* Packaging popup */}
      {popup?.type === "packaging" && (
        <PackagingPopup
          niveaux={produits[popup.productIndex].niveaux_conditionnement}
          units={wizardOpts.units}
          onClose={() => setPopup(null)}
          onValidate={handleValidatePackaging}
        />
      )}
    </div>
  );
}
