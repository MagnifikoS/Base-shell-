/**
 * ═══════════════════════════════════════════════════════════════════════════
 * COMING SOON PLACEHOLDER — Reusable Placeholder Component
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Standard placeholder page for upcoming modules.
 * RBAC protection is handled at the route level (PermissionGuard in AppRoutes).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { LucideIcon, Rocket } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import type { ModuleKey } from "@/hooks/usePermissions";

interface ComingSoonPageProps {
  /** Module key for RBAC (kept for interface compatibility, guard is at route level) */
  moduleKey: ModuleKey;
  /** Page title */
  title: string;
  /** Description of the module */
  description?: string;
  /** Icon to display */
  icon?: LucideIcon;
  /** Features coming with this module */
  features?: string[];
}

export function ComingSoonPage({
  moduleKey: _moduleKey,
  title,
  description = "Ce module est en cours de développement.",
  icon: Icon = Rocket,
  features = [],
}: ComingSoonPageProps) {
  return (
    <AppLayout>
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
        <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-6">
          <Icon className="w-10 h-10 text-primary" />
        </div>

        <h1 className="text-3xl font-bold text-foreground mb-3">{title}</h1>

        <p className="text-muted-foreground text-lg max-w-md mb-8">{description}</p>

        {features.length > 0 && (
          <div className="bg-card border border-border rounded-lg p-6 max-w-md w-full">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
              Fonctionnalités à venir
            </h3>
            <ul className="space-y-2 text-left">
              {features.map((feature, index) => (
                <li key={index} className="flex items-center gap-2 text-foreground">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-8 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-muted">
            <Rocket className="w-4 h-4" />
            En préparation
          </span>
        </div>
      </div>
    </AppLayout>
  );
}
