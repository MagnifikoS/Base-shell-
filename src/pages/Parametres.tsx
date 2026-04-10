/**
 * ============================================================================
 * PARAMETRES — Settings Hub (PER-ADM-024/025)
 * ============================================================================
 * Centralized settings hub with a card-grid landing page. Clicking a category
 * card drills into its detail view with a back button.
 *
 * Categories:
 *   1. Etablissement  — Infos, horaires, pauses, coupure, zones, unites, categories
 *   2. Equipe         — Badgeuse tolerances & security (PIN, selfie)
 *   3. Securite       — PIN settings, password policy info
 *   4. Donnees        — CSV export, DSAR export link
 *
 * SSOT: Each section embeds the canonical component for its domain.
 * ============================================================================
 */

import { Component, useState, useMemo, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ResponsiveLayout } from "@/components/mobile/ResponsiveLayout";
import { useEstablishmentAccess } from "@/hooks/useEstablishmentAccess";
import { usePermissions } from "@/hooks/usePermissions";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  Building2,
  Clock,
  Coffee,
  Scissors,
  MapPin,
  Ruler,
  Shield,
  Database,
  Users,
  Fingerprint,
  KeyRound,
  FileDown,
  ExternalLink,
  Tag,
  AlertTriangle,
  ArrowLeft,
  Search,
  ChevronRight,
  Bell,
  Star,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/** Error boundary to catch rendering errors in settings sub-components */
class SettingsErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; errorMessage: string }
> {
  state = { hasError: false, errorMessage: "" };
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, errorMessage: error.message || "Une erreur est survenue" };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
          <AlertTriangle className="h-12 w-12 text-destructive" />
          <p className="text-lg font-medium text-destructive">Erreur de chargement</p>
          <p className="text-sm text-muted-foreground">{this.state.errorMessage}</p>
          <Button
            variant="outline"
            onClick={() => this.setState({ hasError: false, errorMessage: "" })}
          >
            Reessayer
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Tab content — existing canonical components
import { EstablishmentInfoTab } from "@/components/establishments/settings/EstablishmentInfoTab";
import { WeeklyHoursEditor } from "@/components/establishments/hours/WeeklyHoursEditor";
import { DayPartsEditor } from "@/components/establishments/hours/DayPartsEditor";
import { ExceptionsList } from "@/components/establishments/hours/ExceptionsList";
import { BreakRulesTab } from "@/components/establishments/breaks/BreakRulesTab";
import { ServiceDayCutoffEditor } from "@/components/establishments/settings/ServiceDayCutoffEditor";
import { UnifiedUnitsSettings } from "@/components/settings/UnifiedUnitsSettings";
import { ExportCsvSection } from "@/components/settings/ExportCsvSection";
import { StorageZonesInline } from "@/components/establishments/settings/StorageZonesInline";
import { CategoriesInline } from "@/components/establishments/settings/CategoriesInline";
import { BadgeuseSettingsTab } from "@/components/badgeuse/BadgeuseSettingsTab";
import { MobileFavoritesSettings } from "@/components/settings/MobileFavoritesSettings";


/* ─── Settings item definition (for search) ─── */
interface SettingsItem {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Which category this item belongs to */
  categoryId: CategoryId;
  /** Search keywords (French) */
  keywords: string[];
}

/* ─── Top-level category definition ─── */
interface Category {
  id: CategoryId;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Color classes for the hub card icon area */
  colorClass: string;
  /** Number of sub-items shown in the hub card */
  items: SettingsItem[];
}

type CategoryId = "etablissement" | "equipe" | "securite" | "donnees" | "notifications" | "favoris";

/* ─── All settings items (flat, searchable) ─── */
const SETTINGS_ITEMS: SettingsItem[] = [
  // Etablissement
  {
    id: "infos",
    label: "Informations",
    description: "Nom commercial, adresse et email de contact",
    icon: Building2,
    categoryId: "etablissement",
    keywords: ["nom", "adresse", "email", "contact", "etablissement", "restaurant"],
  },
  {
    id: "horaires",
    label: "Horaires d'ouverture",
    description: "Horaires d'ouverture et tranches horaires",
    icon: Clock,
    categoryId: "etablissement",
    keywords: [
      "horaires",
      "ouverture",
      "fermeture",
      "heures",
      "tranches",
      "services",
      "exceptions",
      "feries",
    ],
  },
  {
    id: "pauses",
    label: "Regles de pause",
    description: "Deduction automatique des pauses",
    icon: Coffee,
    categoryId: "etablissement",
    keywords: ["pause", "deduction", "break", "repos"],
  },
  {
    id: "coupure",
    label: "Coupure de journee",
    description: "Heure de fin de journee de service",
    icon: Scissors,
    categoryId: "etablissement",
    keywords: ["coupure", "journee", "service", "cutoff", "publication", "planning"],
  },
  {
    id: "zones",
    label: "Zones de stockage",
    description: "Chambre froide, reserve seche, etc.",
    icon: MapPin,
    categoryId: "etablissement",
    keywords: ["zones", "stockage", "chambre", "froide", "reserve", "seche", "rangement"],
  },
  {
    id: "unites",
    label: "Unites et conditionnements",
    description: "Unites de mesure et conditionnements des produits",
    icon: Ruler,
    categoryId: "etablissement",
    keywords: ["unites", "mesure", "conditionnement", "packaging", "kg", "litre"],
  },
  {
    id: "categories",
    label: "Categories produits",
    description: "Viandes, poissons, epicerie, boissons, etc.",
    icon: Tag,
    categoryId: "etablissement",
    keywords: ["categories", "produits", "viandes", "poissons", "epicerie", "boissons", "laitier"],
  },
  // Equipe
  {
    id: "badgeuse",
    label: "Parametres de la badgeuse",
    description: "Tolerances de pointage, code PIN, selfie et liaison d'appareils",
    icon: Fingerprint,
    categoryId: "equipe",
    keywords: ["badgeuse", "pointage", "pin", "selfie", "appareil", "tolerance"],
  },
  // Securite
  {
    id: "password-policy",
    label: "Politique de mot de passe",
    description: "Regles de complexite des mots de passe",
    icon: KeyRound,
    categoryId: "securite",
    keywords: ["mot de passe", "password", "complexite", "majuscule", "chiffre", "special"],
  },
  {
    id: "auth",
    label: "Authentification",
    description: "Sessions securisees et tokens JWT",
    icon: Shield,
    categoryId: "securite",
    keywords: ["authentification", "session", "jwt", "token", "securite"],
  },
  // Donnees
  {
    id: "csv-export",
    label: "Export CSV",
    description: "Exportez vos donnees au format CSV",
    icon: FileDown,
    categoryId: "donnees",
    keywords: ["export", "csv", "donnees", "telecharger"],
  },
  {
    id: "dsar-export",
    label: "Export DSAR (RGPD)",
    description: "Demande d'acces aux donnees personnelles (Art. 15 & 20 RGPD)",
    icon: Database,
    categoryId: "donnees",
    keywords: ["dsar", "rgpd", "gdpr", "donnees", "personnelles", "export", "portabilite"],
  },
  // Notifications
  {
    id: "push-notif",
    label: "Notifications push",
    description: "Activez les notifications push sur votre appareil",
    icon: Bell,
    categoryId: "notifications",
    keywords: ["notification", "push", "alerte", "mobile", "pwa"],
  },
];

const CATEGORIES: Category[] = [
  {
    id: "etablissement",
    label: "Etablissement",
    description: "Informations, horaires, pauses, coupure de service, zones, unites et categories",
    icon: Building2,
    colorClass: "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
    items: SETTINGS_ITEMS.filter((i) => i.categoryId === "etablissement"),
  },
  {
    id: "equipe",
    label: "Equipe",
    description: "Parametres de la badgeuse, tolerances de pointage et liaison d'appareils",
    icon: Users,
    colorClass: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400",
    items: SETTINGS_ITEMS.filter((i) => i.categoryId === "equipe"),
  },
  {
    id: "securite",
    label: "Securite",
    description: "Politique de mot de passe et parametres d'authentification",
    icon: Shield,
    colorClass: "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400",
    items: SETTINGS_ITEMS.filter((i) => i.categoryId === "securite"),
  },
  {
    id: "donnees",
    label: "Donnees",
    description: "Export CSV, export DSAR pour conformite RGPD",
    icon: Database,
    colorClass: "bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400",
    items: SETTINGS_ITEMS.filter((i) => i.categoryId === "donnees"),
  },
  {
    id: "notifications",
    label: "Notifications",
    description: "Notifications push sur votre appareil mobile",
    icon: Bell,
    colorClass: "bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400",
    items: SETTINGS_ITEMS.filter((i) => i.categoryId === "notifications"),
  },
  {
    id: "favoris",
    label: "Favoris",
    description: "Personnalisez les raccourcis de votre accueil mobile",
    icon: Star,
    colorClass: "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400",
    items: [],
  },
];

export default function Parametres() {
  const { activeEstablishmentId, loading } = useEstablishmentAccess();
  const { isAdmin } = usePermissions();
  const navigate = useNavigate();
  const [activeCategory, setActiveCategory] = useState<CategoryId | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  /** Filtered items matching the search query */
  const filteredItems = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return null;
    return SETTINGS_ITEMS.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.keywords.some((kw) => kw.includes(q))
    );
  }, [searchQuery]);

  if (loading || !activeEstablishmentId) {
    return (
      <ResponsiveLayout>
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </ResponsiveLayout>
    );
  }

  return (
    <ResponsiveLayout>
      <div className="space-y-6">
        {/* ═══ Header ═══ */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            {activeCategory && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => setActiveCategory(null)}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <div>
              <h1 className="text-2xl font-semibold text-foreground">
                {activeCategory
                  ? (CATEGORIES.find((c) => c.id === activeCategory)?.label ?? "Parametres")
                  : "Parametres"}
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                {activeCategory
                  ? CATEGORIES.find((c) => c.id === activeCategory)?.description
                  : "Configuration generale de votre etablissement"}
              </p>
            </div>
          </div>
        </div>

        {/* ═══ Search bar (hub view only) ═══ */}
        {!activeCategory && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Rechercher un parametre..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        )}

        {/* ═══ Search results ═══ */}
        {!activeCategory && filteredItems && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {filteredItems.length} resultat{filteredItems.length !== 1 ? "s" : ""}
            </p>
            {filteredItems.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                Aucun parametre ne correspond a votre recherche
              </p>
            ) : (
              <div className="space-y-2">
                {filteredItems.map((item) => {
                  const category = CATEGORIES.find((c) => c.id === item.categoryId);
                  return (
                    <Card
                      key={item.id}
                      className="cursor-pointer transition-colors hover:bg-accent/50"
                      onClick={() => {
                        setSearchQuery("");
                        setActiveCategory(item.categoryId);
                      }}
                    >
                      <CardContent className="flex items-center gap-3 p-4">
                        <div
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${category?.colorClass ?? "bg-muted"}`}
                        >
                          <item.icon className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{item.label}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {item.description}
                          </p>
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {category?.label}
                        </span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ═══ Hub grid (no category selected, no search) ═══ */}
        {!activeCategory && !filteredItems && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {CATEGORIES.map((category) => {
              const Icon = category.icon;
              return (
                <Card
                  key={category.id}
                  className="cursor-pointer transition-all hover:shadow-md hover:border-primary/30 group"
                  onClick={() => {
                    if (category.id === "notifications") {
                      navigate("/settings/notifications");
                      return;
                    }
                    setActiveCategory(category.id);
                  }}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start gap-3">
                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${category.colorClass}`}
                      >
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-base flex items-center justify-between">
                          {category.label}
                          <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                        </CardTitle>
                        <CardDescription className="mt-1">{category.description}</CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="flex flex-wrap gap-1.5">
                      {category.items.map((item) => (
                        <span
                          key={item.id}
                          className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                        >
                          <item.icon className="h-3 w-3" />
                          {item.label}
                        </span>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* ═══ Category detail views ═══ */}
        {activeCategory === "etablissement" && (
          <SettingsErrorBoundary>
            <EstablishmentSettingsCategory establishmentId={activeEstablishmentId} />
          </SettingsErrorBoundary>
        )}

        {activeCategory === "equipe" && (
          <SettingsErrorBoundary>
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Fingerprint className="h-5 w-5" />
                    Parametres de la badgeuse
                  </CardTitle>
                  <CardDescription>
                    Tolerances de pointage, code PIN, selfie et liaison d'appareils
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <BadgeuseSettingsTab establishmentId={activeEstablishmentId} />
                </CardContent>
              </Card>
            </div>
          </SettingsErrorBoundary>
        )}

        {activeCategory === "securite" && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <KeyRound className="h-5 w-5" />
                  Politique de mot de passe
                </CardTitle>
                <CardDescription>
                  Regles de securite appliquees aux mots de passe utilisateurs
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30">
                    <Shield className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                    <div className="text-sm">
                      <p className="font-medium text-foreground">Criteres de complexite actifs</p>
                      <ul className="mt-2 space-y-1 text-muted-foreground">
                        <li>Minimum 8 caracteres</li>
                        <li>Au moins une lettre majuscule</li>
                        <li>Au moins une lettre minuscule</li>
                        <li>Au moins un chiffre</li>
                        <li>Au moins un caractere special</li>
                      </ul>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Ces regles sont appliquees automatiquement lors de la creation et du changement
                    de mot de passe. Elles ne peuvent pas etre modifiees pour garantir un niveau de
                    securite minimal.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  Authentification
                </CardTitle>
                <CardDescription>Parametres d'authentification et de session</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30">
                  <Shield className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium text-foreground">Sessions securisees</p>
                    <p className="text-muted-foreground mt-1">
                      Les sessions utilisateurs sont gerees par Supabase Auth avec des tokens JWT.
                      Les sessions expirent automatiquement apres une periode d'inactivite.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {activeCategory === "donnees" && (
          <SettingsErrorBoundary>
            <div className="space-y-6">
              <ExportCsvSection />

              {isAdmin && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <FileDown className="h-5 w-5" />
                      Export DSAR (RGPD)
                    </CardTitle>
                    <CardDescription>
                      Demande d'acces aux donnees personnelles conformement au droit d'acces (Art.
                      15 RGPD) et au droit a la portabilite (Art. 20 RGPD)
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30">
                      <Database className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                      <div className="flex-1 text-sm">
                        <p className="text-muted-foreground">
                          Exportez toutes les donnees personnelles d'un employe pour repondre a une
                          demande DSAR. Delai legal de reponse : 30 jours.
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-3 gap-1.5"
                          onClick={() => navigate("/admin/dsar-export")}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Acceder a l'export DSAR
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </SettingsErrorBoundary>
        )}

        {activeCategory === "favoris" && (
          <SettingsErrorBoundary>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Star className="h-5 w-5" />
                  Favoris de l'accueil
                </CardTitle>
                <CardDescription>
                  Choisissez les modules a afficher sur votre accueil mobile
                </CardDescription>
              </CardHeader>
              <CardContent>
                <MobileFavoritesSettings />
              </CardContent>
            </Card>
          </SettingsErrorBoundary>
        )}
      </div>
    </ResponsiveLayout>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Sub-component: Establishment settings with inner tabs                     */
/* ═══════════════════════════════════════════════════════════════════════════ */

function EstablishmentSettingsCategory({ establishmentId }: { establishmentId: string }) {
  return (
    <Tabs defaultValue="infos" className="w-full">
      <TabsList className="flex flex-wrap h-auto gap-1">
        <TabsTrigger value="infos" className="gap-1.5">
          <Building2 className="h-3.5 w-3.5" />
          Infos
        </TabsTrigger>
        <TabsTrigger value="horaires" className="gap-1.5">
          <Clock className="h-3.5 w-3.5" />
          Horaires
        </TabsTrigger>
        <TabsTrigger value="pauses" className="gap-1.5">
          <Coffee className="h-3.5 w-3.5" />
          Pauses
        </TabsTrigger>
        <TabsTrigger value="coupure" className="gap-1.5">
          <Scissors className="h-3.5 w-3.5" />
          Coupure
        </TabsTrigger>
        <TabsTrigger value="zones" className="gap-1.5">
          <MapPin className="h-3.5 w-3.5" />
          Zones
        </TabsTrigger>
        <TabsTrigger value="unites" className="gap-1.5">
          <Ruler className="h-3.5 w-3.5" />
          Unites
        </TabsTrigger>
        <TabsTrigger value="categories" className="gap-1.5">
          <Tag className="h-3.5 w-3.5" />
          Catégories
        </TabsTrigger>
      </TabsList>

      {/* Tab: Infos */}
      <TabsContent value="infos">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Informations de l'etablissement
            </CardTitle>
            <CardDescription>Nom commercial, adresse et email de contact</CardDescription>
          </CardHeader>
          <CardContent>
            <EstablishmentInfoTab establishmentId={establishmentId} />
          </CardContent>
        </Card>
      </TabsContent>

      {/* Tab: Horaires */}
      <TabsContent value="horaires">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Horaires d'ouverture
              </CardTitle>
              <CardDescription>
                Configurez les horaires d'ouverture pour chaque jour de la semaine
              </CardDescription>
            </CardHeader>
            <CardContent>
              <WeeklyHoursEditor establishmentId={establishmentId} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Tranches horaires</CardTitle>
              <CardDescription>
                Definissez les services (matin, midi, soir) et leurs couleurs
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DayPartsEditor establishmentId={establishmentId} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Exceptions</CardTitle>
              <CardDescription>
                Jours feries, fermetures exceptionnelles, horaires speciaux
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ExceptionsList establishmentId={establishmentId} />
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      {/* Tab: Pauses */}
      <TabsContent value="pauses">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Coffee className="h-5 w-5" />
              Regles de pause
            </CardTitle>
            <CardDescription>
              Configurez les regles de deduction automatique des pauses
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BreakRulesTab establishmentId={establishmentId} />
          </CardContent>
        </Card>
      </TabsContent>

      {/* Tab: Coupure */}
      <TabsContent value="coupure">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Scissors className="h-5 w-5" />
              Coupure de journee de service
            </CardTitle>
            <CardDescription>
              Heure de fin de journee de service et publication automatique du planning
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ServiceDayCutoffEditor establishmentId={establishmentId} />
          </CardContent>
        </Card>
      </TabsContent>

      {/* Tab: Zones */}
      <TabsContent value="zones">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              Zones de stockage
            </CardTitle>
            <CardDescription>
              Definissez les zones de stockage de l'etablissement (chambre froide, reserve seche,
              etc.)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <StorageZonesInline />
          </CardContent>
        </Card>
      </TabsContent>

      {/* Tab: Unites */}
      <TabsContent value="unites">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Ruler className="h-5 w-5" />
              Unites et conditionnements
            </CardTitle>
            <CardDescription>
              Gerez les unites de mesure et les conditionnements des produits
            </CardDescription>
          </CardHeader>
          <CardContent>
            <UnifiedUnitsSettings />
          </CardContent>
        </Card>
      </TabsContent>

      {/* Tab: Categories */}
      <TabsContent value="categories">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Tag className="h-5 w-5" />
              Catégories produits
            </CardTitle>
            <CardDescription>
              Gérez les catégories de produits (viandes, poissons, épicerie, etc.)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CategoriesInline />
          </CardContent>
        </Card>
      </TabsContent>

    </Tabs>
  );
}
