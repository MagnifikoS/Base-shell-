/**
 * Paramètres d'extraction - Interface redesignée (CTO Audit v2)
 *
 * 7 paramètres exactement comme définis dans le prompt :
 * 1. Détection facture déjà importée (toujours active)
 * 2. Filtrage produits existants
 * 3. Variation de prix
 * 4. Quantité anormale
 * 5. Produits rarement achetés
 * 6. Prix manquant
 * 7. Facture atypique
 *
 * Grouped logically:
 *   - Validation des prix (3, 6)
 *   - Validation des produits (1, 2, 5)
 *   - Validation des quantités (4, 7)
 */

import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Lock,
  AlertTriangle,
  Info,
  ShieldCheck,
  ShieldAlert,
  HelpCircle,
  Euro,
  PackageSearch,
  BarChart3,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useExtractionSettings } from "../hooks/useExtractionSettings";
import { Skeleton } from "@/components/ui/skeleton";

function HelpTooltip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex text-muted-foreground hover:text-foreground transition-colors"
        >
          <HelpCircle className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-sm">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

function BlockingBadge({ blocking }: { blocking: boolean }) {
  if (blocking) {
    return (
      <Badge variant="destructive" className="text-xs gap-1 font-medium">
        <ShieldAlert className="h-3 w-3" />
        Bloquant
      </Badge>
    );
  }
  return (
    <Badge
      variant="secondary"
      className="text-xs gap-1 font-medium bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
    >
      <ShieldCheck className="h-3 w-3" />
      Informatif
    </Badge>
  );
}

function SectionHeader({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
  return (
    <div className="flex items-center gap-2 pt-2 pb-1">
      <Icon className="h-5 w-5 text-foreground/70" />
      <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">{title}</h3>
    </div>
  );
}

export function ExtractionSettingsPanel() {
  const { settings, isLoading, updateSettings, isUpdating } = useExtractionSettings();

  if (isLoading) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 max-w-2xl">
      {/* Intro */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold">Regles de validation</h2>
        <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
          Ces parametres controlent la validation automatique lors de l'extraction de documents.
          Activez les regles pour detecter les erreurs avant l'import. Les regles{" "}
          <span className="font-medium text-destructive">bloquantes</span> empechent la validation
          tant que le probleme n'est pas resolu. Les regles{" "}
          <span className="font-medium text-blue-600 dark:text-blue-400">informatives</span>{" "}
          affichent un avertissement sans bloquer.
        </p>
      </div>

      {/* ───────── SECTION: Validation des produits ───────── */}
      <SectionHeader icon={PackageSearch} title="Validation des produits" />

      {/* 1. Détection facture déjà importée - TOUJOURS ACTIVE */}
      <Card className="border-destructive/40 bg-red-50 dark:bg-red-950/40">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-destructive" />
              <CardTitle className="text-sm font-semibold">
                Detection facture deja importee
              </CardTitle>
              <HelpTooltip text="Si une facture avec le meme numero et le meme fournisseur a deja ete importee, l'import est bloque. Exemple : la facture FAC-2024-001 de Metro a deja ete enregistree le 15/01." />
            </div>
            <Badge variant="destructive" className="text-xs font-medium">
              Toujours actif
            </Badge>
          </div>
          <CardDescription className="text-sm text-foreground/70">
            Bloque automatiquement l'import si la facture existe deja dans le systeme. Cette
            protection ne peut pas etre desactivee.
          </CardDescription>
        </CardHeader>
      </Card>

      {/* 2. Filtrage produits existants */}
      <Card className="bg-muted/40">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Info className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              <CardTitle className="text-sm font-semibold">Filtrage produits existants</CardTitle>
              <HelpTooltip text="Les produits deja presents dans votre catalogue sont masques de la liste d'extraction. Exemple : si 'Tomates cerises 500g' existe deja, il n'apparaitra pas dans les produits extraits a valider." />
            </div>
            <div className="flex items-center gap-2">
              <BlockingBadge blocking={false} />
              <Switch
                checked={settings.filter_existing_products}
                onCheckedChange={(checked) => updateSettings({ filter_existing_products: checked })}
                disabled={isUpdating}
              />
            </div>
          </div>
          <CardDescription className="text-sm text-foreground/70">
            Masque les produits deja presents dans votre catalogue lors de l'extraction.
          </CardDescription>
        </CardHeader>
        {settings.filter_existing_products && (
          <CardContent className="pt-0">
            <div className="flex items-center gap-2 p-2 rounded-md bg-background/60">
              <Switch
                id="debug-existing"
                checked={settings.show_existing_products_debug}
                onCheckedChange={(checked) =>
                  updateSettings({ show_existing_products_debug: checked })
                }
                disabled={isUpdating}
              />
              <Label htmlFor="debug-existing" className="text-xs text-muted-foreground">
                Afficher quand meme (mode debug)
              </Label>
            </div>
          </CardContent>
        )}
      </Card>

      {/* 5. Produits rarement achetés */}
      <Card className="bg-muted/40">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Info className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              <CardTitle className="text-sm font-semibold">Produits rarement achetes</CardTitle>
              <HelpTooltip text="Signale les produits que vous n'avez commandes que rarement sur une periode donnee. Exemple : si vous n'avez achete 'Huile de truffe' qu'une seule fois en 3 mois, une alerte apparaitra pour verifier que c'est bien intentionnel." />
            </div>
            <div className="flex items-center gap-2">
              <BlockingBadge blocking={false} />
              <Switch
                checked={settings.rarely_bought_enabled}
                onCheckedChange={(checked) => updateSettings({ rarely_bought_enabled: checked })}
                disabled={isUpdating}
              />
            </div>
          </div>
          <CardDescription className="text-sm text-foreground/70">
            Signale les produits peu commandes recemment pour eviter les erreurs de saisie.
          </CardDescription>
        </CardHeader>
        {settings.rarely_bought_enabled && (
          <CardContent className="pt-0 space-y-3">
            <div className="flex items-center gap-2 p-2 rounded-md bg-background/60">
              <Label className="text-xs w-24">Seuil</Label>
              <span className="text-xs text-muted-foreground">{"<"}</span>
              <Input
                type="number"
                min={1}
                max={10}
                value={settings.rarely_bought_threshold_count}
                onChange={(e) =>
                  updateSettings({ rarely_bought_threshold_count: Number(e.target.value) })
                }
                className="w-16 h-8 text-sm"
                disabled={isUpdating}
                aria-label="Nombre minimum d'achats"
              />
              <span className="text-xs text-muted-foreground">fois /</span>
              <Input
                type="number"
                min={1}
                max={12}
                value={settings.rarely_bought_period_months}
                onChange={(e) =>
                  updateSettings({ rarely_bought_period_months: Number(e.target.value) })
                }
                className="w-16 h-8 text-sm"
                disabled={isUpdating}
                aria-label="Periode en mois"
              />
              <span className="text-xs text-muted-foreground">mois</span>
            </div>
          </CardContent>
        )}
      </Card>

      {/* ───────── SECTION: Validation des prix ───────── */}
      <SectionHeader icon={Euro} title="Validation des prix" />

      {/* 3. Variation de prix */}
      <Card className="bg-amber-50 dark:bg-amber-950/30">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              <CardTitle className="text-sm font-semibold">Variation de prix</CardTitle>
              <HelpTooltip text="Compare le prix sur la facture avec le dernier prix connu pour ce produit. Exemple : si le 'Saumon frais' coutait 12.50 EUR/kg et passe a 18.00 EUR/kg (+44%), une alerte sera declenchee car la tolerance de 15% est depassee." />
            </div>
            <div className="flex items-center gap-2">
              <BlockingBadge blocking={settings.price_variation_blocking} />
              <Switch
                checked={settings.price_variation_enabled}
                onCheckedChange={(checked) => updateSettings({ price_variation_enabled: checked })}
                disabled={isUpdating}
              />
            </div>
          </div>
          <CardDescription className="text-sm text-foreground/70">
            Alerte si le prix d'un produit differe significativement du dernier prix connu.
          </CardDescription>
        </CardHeader>
        {settings.price_variation_enabled && (
          <CardContent className="pt-0 space-y-3">
            <div className="flex items-center gap-2 p-2 rounded-md bg-background/60">
              <Label className="text-xs w-24">Tolerance</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={settings.price_variation_tolerance_pct}
                onChange={(e) =>
                  updateSettings({ price_variation_tolerance_pct: Number(e.target.value) })
                }
                className="w-20 h-8 text-sm"
                disabled={isUpdating}
              />
              <span className="text-xs text-muted-foreground">%</span>
            </div>
            <div className="flex items-center gap-2 p-2 rounded-md bg-background/60">
              <Switch
                id="price-blocking"
                checked={settings.price_variation_blocking}
                onCheckedChange={(checked) => updateSettings({ price_variation_blocking: checked })}
                disabled={isUpdating}
              />
              <Label htmlFor="price-blocking" className="text-xs text-muted-foreground">
                Bloquer la validation
              </Label>
            </div>
          </CardContent>
        )}
      </Card>

      {/* 6. Prix manquant */}
      <Card className="bg-amber-50 dark:bg-amber-950/30">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              <CardTitle className="text-sm font-semibold">Prix manquant</CardTitle>
              <HelpTooltip text="Detecte les lignes de la facture qui n'ont pas de prix unitaire. Exemple : une ligne 'Basilic frais x3' sans prix affiche = impossible de calculer le cout total. Par defaut, cette regle bloque la validation." />
            </div>
            <div className="flex items-center gap-2">
              <BlockingBadge blocking={settings.missing_price_blocking} />
              <Switch
                checked={settings.missing_price_enabled}
                onCheckedChange={(checked) => updateSettings({ missing_price_enabled: checked })}
                disabled={isUpdating}
              />
            </div>
          </div>
          <CardDescription className="text-sm text-foreground/70">
            Detecte les lignes sans prix unitaire pour eviter les imports incomplets.
          </CardDescription>
        </CardHeader>
        {settings.missing_price_enabled && (
          <CardContent className="pt-0">
            <div className="flex items-center gap-2 p-2 rounded-md bg-background/60">
              <Switch
                id="price-missing-blocking"
                checked={settings.missing_price_blocking}
                onCheckedChange={(checked) => updateSettings({ missing_price_blocking: checked })}
                disabled={isUpdating}
              />
              <Label htmlFor="price-missing-blocking" className="text-xs text-muted-foreground">
                Bloquer la validation (par defaut)
              </Label>
            </div>
          </CardContent>
        )}
      </Card>

      {/* ───────── SECTION: Validation des quantités ───────── */}
      <SectionHeader icon={BarChart3} title="Validation des quantites" />

      {/* 4. Quantité anormale */}
      <Card className="bg-amber-50 dark:bg-amber-950/30">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              <CardTitle className="text-sm font-semibold">Quantite anormale</CardTitle>
              <HelpTooltip text="Compare la quantite commandee avec l'historique de commandes pour ce produit. Exemple : vous commandez habituellement 5 caisses de lait, mais cette facture en contient 50. L'ecart depasse la tolerance, une alerte est declenchee." />
            </div>
            <div className="flex items-center gap-2">
              <BlockingBadge blocking={settings.abnormal_quantity_blocking} />
              <Switch
                checked={settings.abnormal_quantity_enabled}
                onCheckedChange={(checked) =>
                  updateSettings({ abnormal_quantity_enabled: checked })
                }
                disabled={isUpdating}
              />
            </div>
          </div>
          <CardDescription className="text-sm text-foreground/70">
            Alerte si la quantite commandee s'ecarte significativement de l'historique.
          </CardDescription>
        </CardHeader>
        {settings.abnormal_quantity_enabled && (
          <CardContent className="pt-0 space-y-3">
            <div className="flex items-center gap-2 p-2 rounded-md bg-background/60">
              <Label className="text-xs w-24">Tolerance</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={settings.abnormal_quantity_tolerance_pct}
                onChange={(e) =>
                  updateSettings({ abnormal_quantity_tolerance_pct: Number(e.target.value) })
                }
                className="w-20 h-8 text-sm"
                disabled={isUpdating}
              />
              <span className="text-xs text-muted-foreground">%</span>
            </div>
            <div className="flex items-center gap-2 p-2 rounded-md bg-background/60">
              <Switch
                id="qty-blocking"
                checked={settings.abnormal_quantity_blocking}
                onCheckedChange={(checked) =>
                  updateSettings({ abnormal_quantity_blocking: checked })
                }
                disabled={isUpdating}
              />
              <Label htmlFor="qty-blocking" className="text-xs text-muted-foreground">
                Bloquer la validation
              </Label>
            </div>
          </CardContent>
        )}
      </Card>

      {/* 7. Facture atypique */}
      <Card className="bg-muted/40">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Info className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              <CardTitle className="text-sm font-semibold">Facture atypique</CardTitle>
              <HelpTooltip text="Analyse globale de la facture pour detecter des anomalies : montant total inhabituel, fournisseur inconnu, nombre de lignes anormal. Exemple : une facture Metro de 15 000 EUR alors que vos commandes habituelles sont autour de 3 000 EUR." />
            </div>
            <div className="flex items-center gap-2">
              <BlockingBadge blocking={false} />
              <Switch
                checked={settings.atypical_invoice_enabled}
                onCheckedChange={(checked) => updateSettings({ atypical_invoice_enabled: checked })}
                disabled={isUpdating}
              />
            </div>
          </div>
          <CardDescription className="text-sm text-foreground/70">
            Signale les factures inhabituelles (montant, fournisseur, nombre de lignes). Information
            uniquement, ne bloque jamais.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
