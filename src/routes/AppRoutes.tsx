import { Suspense, lazy } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { PermissionGuard, AdminGuard } from "@/components/PermissionGuard";
import { PlatformAdminGuard } from "@/components/PlatformAdminGuard";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  SIDEBAR_V21_ENABLED,
  SIGNATURE_STUDIO_ENABLED,
  CONGES_ABSENCES_ENABLED,
  VISION_AI_BENCH_ENABLED,
} from "@/config/featureFlags";
const MobileEmployeesList = lazy(() =>
  import("@/components/mobile/employees/MobileEmployeesList").then((m) => ({
    default: m.MobileEmployeesList,
  }))
);
const MobilePresencePage = lazy(() =>
  import("@/components/mobile/presence/MobilePresencePage").then((m) => ({
    default: m.MobilePresencePage,
  }))
);
const MobileNavConfig = lazy(() =>
  import("@/components/mobile/admin/MobileNavConfig").then((m) => ({
    default: m.MobileNavConfig,
  }))
);
import { SmartHomeRedirect } from "./SmartHomeRedirect";

// ══════════════════════════════════════════════════════════════
// Auth: STATIC import — critical path for unauthenticated users.
// Must NOT be lazy to avoid an extra round-trip on the boot path.
// ══════════════════════════════════════════════════════════════
import Auth from "@/pages/Auth";
import NotFound from "@/pages/NotFound";

// ══════════════════════════════════════════════════════════════
// Non-critical auth pages — lazy-loaded (rarely accessed)
// ══════════════════════════════════════════════════════════════
const Bootstrap = lazy(() => import("@/pages/Bootstrap"));
const Invite = lazy(() => import("@/pages/Invite"));
const PolitiqueConfidentialite = lazy(() => import("@/pages/PolitiqueConfidentialite"));

// ══════════════════════════════════════════════════════════════
// PERF-01: All other pages lazy-loaded for code-splitting
// ══════════════════════════════════════════════════════════════
const AgentIAPage = lazy(() => import("@/pages/AgentIAPage"));
const AgentProduitPage = lazy(() => import("@/pages/AgentProduitPage"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const OrganisationDashboard = lazy(() => import("@/pages/OrganisationDashboard"));
const GlobalDashboard = lazy(() => import("@/pages/GlobalDashboard"));
const Planning = lazy(() => import("@/pages/Planning"));
const Salaries = lazy(() => import("@/pages/Salaries"));
const Badgeuse = lazy(() => import("@/pages/Badgeuse"));
const Caisse = lazy(() => import("@/pages/Caisse"));
const Rapports = lazy(() => import("@/pages/Rapports"));
const Admin = lazy(() => import("@/pages/Admin"));
const VisionAI = lazy(() => import("@/pages/VisionAI"));
const GestionPersonnel = lazy(() => import("@/pages/GestionPersonnel"));
const Parametres = lazy(() => import("@/pages/Parametres"));
const Payroll = lazy(() => import("@/pages/Payroll"));
const Presence = lazy(() => import("@/pages/Presence"));
const Notifications = lazy(() => import("@/pages/Notifications"));
const Fournisseurs = lazy(() => import("@/pages/Fournisseurs"));
const SupplierCreatePage = lazy(() =>
  import("@/modules/fournisseurs/pages/SupplierCreatePage").then((m) => ({
    default: m.SupplierCreatePage,
  }))
);
const SupplierDetailPage = lazy(() =>
  import("@/modules/fournisseurs/pages/SupplierDetailPage").then((m) => ({
    default: m.SupplierDetailPage,
  }))
);

// Clients B2B
const ClientsB2B = lazy(() => import("@/pages/ClientsB2B"));
const PlatsFournisseurs = lazy(() => import("@/pages/PlatsFournisseurs"));

// Commandes
const Commandes = lazy(() => import("@/pages/Commandes"));
const DlcCritique = lazy(() => import("@/pages/DlcCritique"));

// Produits V2
const ProduitsV2ListPage = lazy(() => import("@/modules/produitsV2/pages/ProduitsV2ListPage"));
const ProduitV2DetailPage = lazy(() => import("@/modules/produitsV2/pages/ProduitV2DetailPage"));


// MiseEnPlace module — REMOVED (P0 audit V0: orphan module)
const MarchandisePage = lazy(() => import("@/modules/marchandise/pages/MarchandisePage"));
const InventairePageReal = lazy(() => import("@/modules/inventaire/pages/InventairePage"));
const InventaireSettingsPage = lazy(
  () => import("@/modules/inventaire/pages/InventaireSettingsPage")
);
const PertesPage = lazy(() => import("@/pages/PertesPage"));
const RecettesPage = lazy(() => import("@/pages/RecettesPage"));
const FoodCostPage = lazy(() => import("@/pages/FoodCostPage"));
const PlatDuJourPage = lazy(() => import("@/pages/PlatDuJourPage"));
const ContextePage = lazy(() => import("@/pages/ContextePage"));
const AssistantPage = lazy(() => import("@/pages/AssistantPage"));
const MaterielPage = lazy(() => import("@/pages/MaterielPage"));


// Module THE BRAIN
const TheBrainPage = lazy(() =>
  import("@/modules/theBrain/pages/TheBrainPage").then((m) => ({ default: m.TheBrainPage }))
);
// Module Factures
const FacturesPage = lazy(() =>
  import("@/modules/factures/pages/FacturesPage").then((m) => ({ default: m.FacturesPage }))
);
// Module Achat
const AchatPage = lazy(() => import("@/modules/achat/AchatPage"));
// Module Achats Brain Summary
const AchatsBrainSummaryPage = lazy(
  () => import("@/modules/achatsBrainSummary/pages/AchatsBrainSummaryPage")
);
// Signature Studio
const SignatureStudioPage = lazy(() =>
  import("@/modules/signatureStudio/SignatureStudioPage").then((m) => ({
    default: m.SignatureStudioPage,
  }))
);
// Conges & Absences
const CongesAbsencesPage = lazy(() =>
  import("@/modules/congesAbsences/CongesAbsencesPage").then((m) => ({
    default: m.CongesAbsencesPage,
  }))
);
const MobileCongesAbsences = lazy(() =>
  import("@/modules/congesAbsences/mobile/MobileCongesAbsences").then((m) => ({
    default: m.MobileCongesAbsences,
  }))
);
// RGPD-02: DSAR Export
const DsarExport = lazy(() => import("@/pages/DsarExport"));
// Platform Admin (P0)
const PlatformDashboardPage = lazy(() => import("@/pages/PlatformDashboard"));
const PlatformOrgDetailPage = lazy(() => import("@/pages/PlatformOrgDetail"));
const PlatformEstablishmentDetailPage = lazy(() => import("@/pages/PlatformEstablishmentDetail"));
const PlatformOrganisationsPage = lazy(() => import("@/pages/PlatformOrganisations"));
const PlatformModulesPage = lazy(() => import("@/pages/PlatformModules"));
const PlatformLogsPage = lazy(() => import("@/pages/PlatformLogs"));
const PlatformSettingsPage = lazy(() => import("@/pages/PlatformSettings"));
// Activity Log (audit_logs)
const ActivityLog = lazy(() => import("@/pages/ActivityLog"));
const SettingsNotifications = lazy(() => import("@/pages/SettingsNotifications"));
// Vision AI Bench (benchmark tool)
const VisionAIBenchPage = lazy(() =>
  import("@/modules/visionAIBench/pages/VisionAIBenchPage").then((m) => ({
    default: m.VisionAIBenchPage,
  }))
);
// Mobile Planning
const MobilePlanningRouter = lazy(() =>
  import("@/components/mobile/planning/MobilePlanningRouter").then((m) => ({
    default: m.MobilePlanningRouter,
  }))
);

// ══════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════

/**
 * Global loading spinner for lazy-loaded routes.
 * Prevents white flash when navigating between pages.
 */
function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
    </div>
  );
}

function MobilePlanningFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
    </div>
  );
}

/**
 * Responsive route wrapper: renders the mobile component (with Suspense + ErrorBoundary)
 * on mobile devices and the desktop component on desktop.
 * All mobile components passed here are React.lazy() so they always need a Suspense boundary.
 */
function ResponsiveRoute({
  mobileComponent: Mobile,
  desktopComponent: Desktop,
  mobileFallback,
}: {
  mobileComponent: React.ComponentType;
  desktopComponent: React.ComponentType;
  mobileFallback?: React.ReactNode;
}) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <ErrorBoundary>
        <Suspense fallback={mobileFallback ?? <PageLoader />}>
          <Mobile />
        </Suspense>
      </ErrorBoundary>
    );
  }

  return <Desktop />;
}

// ══════════════════════════════════════════════════════════════
// Main Routes
// ══════════════════════════════════════════════════════════════

export function AppRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/" element={<SmartHomeRedirect />} />
        <Route path="/auth" element={<Auth />} />
        <Route path="/politique-confidentialite" element={<PolitiqueConfidentialite />} />
        <Route path="/bootstrap" element={<Bootstrap />} />
        <Route path="/invite" element={<Invite />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <PermissionGuard moduleKey="dashboard">
                <Dashboard />
              </PermissionGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/organisation"
          element={
            <ProtectedRoute>
              <PermissionGuard moduleKey="etablissements">
                <OrganisationDashboard />
              </PermissionGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/global-dashboard"
          element={
            <ProtectedRoute>
              <AdminGuard>
                <GlobalDashboard />
              </AdminGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/planning"
          element={
            <ProtectedRoute>
              <PermissionGuard moduleKey="planning">
                <ResponsiveRoute
                  mobileComponent={MobilePlanningRouter}
                  desktopComponent={Planning}
                  mobileFallback={<MobilePlanningFallback />}
                />
              </PermissionGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/salaries"
          element={
            <ProtectedRoute>
              <PermissionGuard moduleKey="salaries">
                <ResponsiveRoute
                  mobileComponent={MobileEmployeesList}
                  desktopComponent={Salaries}
                />
              </PermissionGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/badgeuse"
          element={
            <ProtectedRoute>
              <PermissionGuard moduleKey="badgeuse">
                <Badgeuse />
              </PermissionGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/caisse"
          element={
            <ProtectedRoute>
              <PermissionGuard moduleKey="caisse">
                <Caisse />
              </PermissionGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/rapports"
          element={
            <ProtectedRoute>
              <PermissionGuard moduleKey="rapports">
                <Rapports />
              </PermissionGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <ProtectedRoute>
              <AdminGuard>
                <Admin />
              </AdminGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/vision-ai"
          element={
            <ProtectedRoute>
              <PermissionGuard moduleKey="vision_ai">
                <VisionAI />
              </PermissionGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/pilotage/the-brain"
          element={
            <ProtectedRoute>
              <AdminGuard>
                <TheBrainPage />
              </AdminGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/gestion-personnel"
          element={
            <ProtectedRoute>
              <PermissionGuard moduleKey="gestion_personnel">
                <GestionPersonnel />
              </PermissionGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/presence"
          element={
            <ProtectedRoute>
              <PermissionGuard moduleKey="presence">
                <ResponsiveRoute mobileComponent={MobilePresencePage} desktopComponent={Presence} />
              </PermissionGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/parametres"
          element={
            <ProtectedRoute>
              <PermissionGuard moduleKey="parametres">
                <Parametres />
              </PermissionGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/notifications"
          element={
            <ProtectedRoute>
              <Notifications />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings/notifications"
          element={
            <ProtectedRoute>
              <SettingsNotifications />
            </ProtectedRoute>
          }
        />
        <Route
          path="/paie"
          element={
            <ProtectedRoute>
              <PermissionGuard moduleKey="paie">
                <Payroll />
              </PermissionGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/dsar-export"
          element={
            <ProtectedRoute>
              <AdminGuard>
                <DsarExport />
              </AdminGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/activity-log"
          element={
            <ProtectedRoute>
              <AdminGuard>
                <ActivityLog />
              </AdminGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/mobile/admin/nav-config"
          element={
            <ProtectedRoute>
              <AdminGuard>
                <MobileNavConfig />
              </AdminGuard>
            </ProtectedRoute>
          }
        />
        {VISION_AI_BENCH_ENABLED && (
          <Route
            path="/vision-ai-bench"
            element={
              <ProtectedRoute>
                <AdminGuard>
                  <VisionAIBenchPage />
                </AdminGuard>
              </ProtectedRoute>
            }
          />
        )}
        {CONGES_ABSENCES_ENABLED && (
          <Route
            path="/conges-absences"
            element={
              <ProtectedRoute>
                <PermissionGuard moduleKey="conges_absences">
                  <ResponsiveRoute
                    mobileComponent={MobileCongesAbsences}
                    desktopComponent={CongesAbsencesPage}
                  />
                </PermissionGuard>
              </ProtectedRoute>
            }
          />
        )}
        {SIGNATURE_STUDIO_ENABLED && (
          <Route
            path="/studio-signature"
            element={
              <ProtectedRoute>
                <AdminGuard>
                  <SignatureStudioPage />
                </AdminGuard>
              </ProtectedRoute>
            }
          />
        )}
        <Route
          path="/factures"
          element={
            <ProtectedRoute>
              <PermissionGuard moduleKey="factures">
                <FacturesPage />
              </PermissionGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/fournisseurs"
          element={
            <ProtectedRoute>
              <PermissionGuard moduleKey="fournisseurs">
                <Fournisseurs />
              </PermissionGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/fournisseurs/nouveau"
          element={
            <ProtectedRoute>
              <PermissionGuard moduleKey="fournisseurs">
                <SupplierCreatePage />
              </PermissionGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/fournisseurs/:id"
          element={
            <ProtectedRoute>
              <PermissionGuard moduleKey="fournisseurs">
                <SupplierDetailPage />
              </PermissionGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/clients-b2b"
          element={
            <ProtectedRoute>
              <PermissionGuard moduleKey="clients_b2b">
                <ClientsB2B />
              </PermissionGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/plats-fournisseurs"
          element={
            <ProtectedRoute>
              <PermissionGuard moduleKey="fournisseurs">
                <PlatsFournisseurs />
              </PermissionGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/commandes"
          element={
            <ProtectedRoute>
              <PermissionGuard moduleKey="commandes">
                <Commandes />
              </PermissionGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/dlc-critique"
          element={
            <ProtectedRoute>
              <PermissionGuard moduleKey="dlc_critique">
                <DlcCritique />
              </PermissionGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/produits-v2"
          element={
            <ProtectedRoute>
              <PermissionGuard moduleKey="produits_v2">
                <ProduitsV2ListPage />
              </PermissionGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/produits-v2/:id"
          element={
            <ProtectedRoute>
              <PermissionGuard moduleKey="produits_v2">
                <ProduitV2DetailPage />
              </PermissionGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/achat"
          element={
            <ProtectedRoute>
              <PermissionGuard moduleKey="factures">
                <AchatPage />
              </PermissionGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/achat/the-brain-summary"
          element={
            <ProtectedRoute>
              <PermissionGuard moduleKey="factures">
                <AchatsBrainSummaryPage />
              </PermissionGuard>
            </ProtectedRoute>
          }
        />

        {SIDEBAR_V21_ENABLED && (
          <>
            <Route
              path="/inventaire"
              element={
                <ProtectedRoute>
                  <PermissionGuard moduleKey="inventaire">
                    <ErrorBoundary>
                      <Suspense fallback={<PageLoader />}>
                        <InventairePageReal />
                      </Suspense>
                    </ErrorBoundary>
                  </PermissionGuard>
                </ProtectedRoute>
              }
            />
            <Route
              path="/inventaire/parametres"
              element={
                <ProtectedRoute>
                  <PermissionGuard moduleKey="inventaire">
                    <ErrorBoundary>
                      <Suspense fallback={<PageLoader />}>
                        <InventaireSettingsPage />
                      </Suspense>
                    </ErrorBoundary>
                  </PermissionGuard>
                </ProtectedRoute>
              }
            />
            <Route
              path="/pertes"
              element={
                <ProtectedRoute>
                  <PermissionGuard moduleKey="pertes">
                    <PertesPage />
                  </PermissionGuard>
                </ProtectedRoute>
              }
            />
            <Route
              path="/recettes"
              element={
                <ProtectedRoute>
                  <PermissionGuard moduleKey="recettes">
                    <RecettesPage />
                  </PermissionGuard>
                </ProtectedRoute>
              }
            />
            <Route
              path="/food-cost"
              element={
                <ProtectedRoute>
                  <PermissionGuard moduleKey="food_cost">
                    <FoodCostPage />
                  </PermissionGuard>
                </ProtectedRoute>
              }
            />
            <Route
              path="/plat-du-jour"
              element={
                <ProtectedRoute>
                  <PermissionGuard moduleKey="plat_du_jour">
                    <PlatDuJourPage />
                  </PermissionGuard>
                </ProtectedRoute>
              }
            />
            <Route
              path="/contexte"
              element={
                <ProtectedRoute>
                  <PermissionGuard moduleKey="contexte">
                    <ContextePage />
                  </PermissionGuard>
                </ProtectedRoute>
              }
            />
            <Route
              path="/assistant"
              element={
                <ProtectedRoute>
                  <PermissionGuard moduleKey="assistant">
                    <AssistantPage />
                  </PermissionGuard>
                </ProtectedRoute>
              }
            />
            <Route
              path="/materiel"
              element={
                <ProtectedRoute>
                  <PermissionGuard moduleKey="materiel">
                    <MaterielPage />
                  </PermissionGuard>
                </ProtectedRoute>
              }
            />
          </>
        )}
        {/* Finance > Marchandise — isolated module, SSOT read-only */}
        <Route
          path="/finance/marchandise"
          element={
            <ProtectedRoute>
              <PermissionGuard moduleKey="inventaire">
                <ErrorBoundary>
                  <Suspense fallback={<PageLoader />}>
                    <MarchandisePage />
                  </Suspense>
                </ErrorBoundary>
              </PermissionGuard>
            </ProtectedRoute>
          }
        />
        <Route path="/produits" element={<Navigate to="/produits-v2" replace />} />
        <Route
          path="/platform"
          element={
            <ProtectedRoute>
              <PlatformAdminGuard>
                <PlatformDashboardPage />
              </PlatformAdminGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/platform/organisations"
          element={
            <ProtectedRoute>
              <PlatformAdminGuard>
                <PlatformOrganisationsPage />
              </PlatformAdminGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/platform/modules"
          element={
            <ProtectedRoute>
              <PlatformAdminGuard>
                <PlatformModulesPage />
              </PlatformAdminGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/platform/logs"
          element={
            <ProtectedRoute>
              <PlatformAdminGuard>
                <PlatformLogsPage />
              </PlatformAdminGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/platform/settings"
          element={
            <ProtectedRoute>
              <PlatformAdminGuard>
                <PlatformSettingsPage />
              </PlatformAdminGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/platform/org/:orgId"
          element={
            <ProtectedRoute>
              <PlatformAdminGuard>
                <PlatformOrgDetailPage />
              </PlatformAdminGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/platform/org/:orgId/establishment/:estId"
          element={
            <ProtectedRoute>
              <PlatformAdminGuard>
                <PlatformEstablishmentDetailPage />
              </PlatformAdminGuard>
            </ProtectedRoute>
          }
        />
        {/* Agent IA — RBAC via vision_ai (MVP, même bundle Stock & Achat) */}
        <Route
          path="/agent-ia"
          element={
            <ProtectedRoute>
              <PermissionGuard moduleKey="vision_ai">
                <AgentIAPage />
              </PermissionGuard>
            </ProtectedRoute>
          }
        />
        <Route
          path="/agent-ia/produit"
          element={
            <ProtectedRoute>
              <PermissionGuard moduleKey="vision_ai">
                <AgentProduitPage />
              </PermissionGuard>
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
