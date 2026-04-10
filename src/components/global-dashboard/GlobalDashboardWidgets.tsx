/**
 * Sub-components for the Global Dashboard page.
 * Extracted to keep GlobalDashboard.tsx under 250 lines.
 */

import { Component, memo, useMemo, useState, type ReactNode } from "react";
import type { OrganizationOverview } from "@/hooks/dashboard/useGlobalKPIs";
import { Card, CardContent } from "@/components/ui/card";
import { CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowUpDown, ExternalLink, TrendingUp, Users } from "lucide-react";

// ── Error boundary for each section ─────────────────────────────────

export class SectionErrorBoundary extends Component<
  { children: ReactNode; label: string },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-sm text-muted-foreground">
              Donnees non disponibles pour : {this.props.label}
            </p>
          </CardContent>
        </Card>
      );
    }
    return this.props.children;
  }
}

// ── KPI Stat Card ───────────────────────────────────────────────────

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: ReactNode;
}

export const StatCard = memo(function StatCard({ title, value, subtitle, icon }: StatCardProps) {
  return (
    <Card role="region" aria-label={title}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <span className="text-muted-foreground" aria-hidden="true">
          {icon}
        </span>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
      </CardContent>
    </Card>
  );
});

// ── Loading skeleton ────────────────────────────────────────────────

export function GlobalDashboardSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-64" />
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}

// ── Organisations Table ─────────────────────────────────────────────

type SortField = "name" | "establishmentCount" | "userCount" | "createdAt";

export const OrgsTable = memo(function OrgsTable({ orgs }: { orgs: OrganizationOverview[] }) {
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortAsc, setSortAsc] = useState(false);

  const sorted = useMemo(() => {
    const copy = [...orgs];
    copy.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "establishmentCount":
          cmp = a.establishmentCount - b.establishmentCount;
          break;
        case "userCount":
          cmp = a.userCount - b.userCount;
          break;
        case "createdAt":
          cmp = a.createdAt.localeCompare(b.createdAt);
          break;
      }
      return sortAsc ? cmp : -cmp;
    });
    return copy;
  }, [orgs, sortField, sortAsc]);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortAsc((prev) => !prev);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  }

  if (orgs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">Aucune organisation trouvee.</p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>
            <button
              className="inline-flex items-center gap-1 hover:text-foreground"
              onClick={() => toggleSort("name")}
            >
              Organisation <ArrowUpDown className="h-3 w-3" />
            </button>
          </TableHead>
          <TableHead className="text-center">
            <button
              className="inline-flex items-center gap-1 hover:text-foreground"
              onClick={() => toggleSort("establishmentCount")}
            >
              Etablissements <ArrowUpDown className="h-3 w-3" />
            </button>
          </TableHead>
          <TableHead className="text-center">
            <button
              className="inline-flex items-center gap-1 hover:text-foreground"
              onClick={() => toggleSort("userCount")}
            >
              Utilisateurs <ArrowUpDown className="h-3 w-3" />
            </button>
          </TableHead>
          <TableHead>
            <button
              className="inline-flex items-center gap-1 hover:text-foreground"
              onClick={() => toggleSort("createdAt")}
            >
              Cree le <ArrowUpDown className="h-3 w-3" />
            </button>
          </TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((org) => (
          <TableRow key={org.id}>
            <TableCell className="font-medium text-sm">{org.name}</TableCell>
            <TableCell className="text-center text-sm">
              {org.activeEstablishmentCount}
              {org.establishmentCount !== org.activeEstablishmentCount && (
                <span className="text-muted-foreground"> / {org.establishmentCount}</span>
              )}
            </TableCell>
            <TableCell className="text-center text-sm">
              {org.activeUserCount}
              {org.userCount !== org.activeUserCount && (
                <span className="text-muted-foreground"> / {org.userCount}</span>
              )}
            </TableCell>
            <TableCell className="text-sm font-mono">{org.createdAt.slice(0, 10)}</TableCell>
            <TableCell className="text-right">
              <Button variant="ghost" size="sm" className="gap-1.5 h-7 text-xs" disabled>
                <ExternalLink className="h-3 w-3" />
                Voir
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
});

// ── Growth Summary ──────────────────────────────────────────────────

export const GrowthSummary = memo(function GrowthSummary({
  newOrgs,
  newUsers,
  organizations,
}: {
  newOrgs: number;
  newUsers: number;
  organizations: OrganizationOverview[];
}) {
  const recentOrgs = useMemo(
    () => [...organizations].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5),
    [organizations]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 text-sm">
        <Badge variant="secondary" className="gap-1">
          <TrendingUp className="h-3 w-3" />+{newOrgs} org{newOrgs > 1 ? "s" : ""} ce mois
        </Badge>
        <Badge variant="secondary" className="gap-1">
          <Users className="h-3 w-3" />+{newUsers} utilisateur{newUsers > 1 ? "s" : ""} ce mois
        </Badge>
      </div>
      {recentOrgs.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground mb-2">Dernieres organisations creees</p>
          <ul className="space-y-1">
            {recentOrgs.map((org) => (
              <li key={org.id} className="flex items-center justify-between text-sm">
                <span>{org.name}</span>
                <span className="text-xs text-muted-foreground font-mono">
                  {org.createdAt.slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
});
