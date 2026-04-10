/**
 * OnboardingChecklist -- Setup checklist for new admin users.
 * Shows progress on essential configuration steps.
 * Dismissible via localStorage.
 */

import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Circle, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

const DISMISSED_KEY = "onboarding_checklist_dismissed";

interface StepStatus {
  label: string;
  done: boolean;
  href: string;
}

export function OnboardingChecklist() {
  const [dismissed, setDismissed] = useState(() => {
    return localStorage.getItem(DISMISSED_KEY) === "true";
  });

  const [steps, setSteps] = useState<StepStatus[]>([
    { label: "Creer votre etablissement", done: false, href: "/admin" },
    { label: "Inviter des employes", done: false, href: "/salaries" },
    { label: "Configurer les horaires", done: false, href: "/admin" },
    { label: "Creer un planning", done: false, href: "/planning" },
  ]);

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (dismissed) return;

    let cancelled = false;

    async function checkStatus() {
      try {
        const [estabRes, empRes, hoursRes, planningRes] = await Promise.all([
          supabase.from("establishments").select("id", { count: "exact", head: true }),
          supabase.from("invitations").select("id", { count: "exact", head: true }),
          supabase.from("establishment_opening_hours").select("id", { count: "exact", head: true }),
          supabase.from("planning_shifts").select("id", { count: "exact", head: true }),
        ]);

        if (cancelled) return;

        setSteps([
          {
            label: "Creer votre etablissement",
            done: (estabRes.count ?? 0) > 0,
            href: "/admin",
          },
          {
            label: "Inviter des employes",
            done: (empRes.count ?? 0) > 0,
            href: "/salaries",
          },
          {
            label: "Configurer les horaires",
            done: (hoursRes.count ?? 0) > 0,
            href: "/admin",
          },
          {
            label: "Creer un planning",
            done: (planningRes.count ?? 0) > 0,
            href: "/planning",
          },
        ]);
      } catch {
        // Silently fail -- checklist is non-critical
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    checkStatus();
    return () => {
      cancelled = true;
    };
  }, [dismissed]);

  const completedCount = useMemo(() => steps.filter((s) => s.done).length, [steps]);
  const totalCount = steps.length;

  const handleDismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "true");
    setDismissed(true);
  };

  if (dismissed || loading) return null;

  // Hide if all steps are completed
  if (completedCount === totalCount) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base">Configuration initiale</CardTitle>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDismiss}
          aria-label="Masquer la checklist"
          className="text-muted-foreground"
        >
          <X className="h-4 w-4 mr-1" />
          Masquer
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {completedCount}/{totalCount} etapes completees
        </p>
        <ul className="space-y-2">
          {steps.map((step) => (
            <li key={step.label}>
              <Link to={step.href} className="flex items-center gap-2 text-sm hover:underline">
                {step.done ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />
                ) : (
                  <Circle className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
                <span className={step.done ? "line-through text-muted-foreground" : ""}>
                  {step.label}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
