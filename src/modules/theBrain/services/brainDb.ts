/**
 * THE BRAIN -- Database accessor (shared)
 *
 * Typed accessor for tables not yet in auto-generated Supabase types.
 * Centralizes the single cast to avoid spreading `as any` across the file.
 *
 * NOTE: Remove this helper once `supabase gen types` includes brain_events / brain_rules.
 */

import { supabase } from "@/integrations/supabase/client";

/**
 * Row types for brain tables (not yet in auto-generated types).
 * These mirror the actual DB schema.
 */
export interface BrainEventRow {
  id: string;
  establishment_id: string;
  subject: string;
  action: string;
  context: Record<string, unknown>;
  actor_user_id: string | null;
  created_at: string;
}

export interface BrainRuleRow {
  id: string;
  establishment_id: string;
  subject: string;
  context_key: string;
  value: Record<string, unknown>;
  confirmations_count: number;
  corrections_count: number;
  enabled: boolean;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

/** PostgrestError-compatible shape */
interface BrainError {
  message: string;
}

/** Result shape from await */
interface BrainResult<Row> {
  data: Row[] | null;
  error: BrainError | null;
}

/** Single-row result shape */
interface BrainSingleResult<Row> {
  data: Row | null;
  error: BrainError | null;
}

/**
 * A chainable filter builder that is also thenable (awaitable).
 * Mirrors the PostgREST filter builder API surface used by brain services.
 */
interface BrainFilterBuilder<Row> extends PromiseLike<BrainResult<Row>> {
  eq: (column: string, value: unknown) => BrainFilterBuilder<Row>;
  neq: (column: string, value: unknown) => BrainFilterBuilder<Row>;
  gt: (column: string, value: unknown) => BrainFilterBuilder<Row>;
  gte: (column: string, value: unknown) => BrainFilterBuilder<Row>;
  lt: (column: string, value: unknown) => BrainFilterBuilder<Row>;
  lte: (column: string, value: unknown) => BrainFilterBuilder<Row>;
  in: (column: string, values: unknown[]) => BrainFilterBuilder<Row>;
  order: (column: string, options?: { ascending?: boolean }) => BrainFilterBuilder<Row>;
  limit: (count: number) => BrainFilterBuilder<Row>;
  range: (from: number, to: number) => BrainFilterBuilder<Row>;
  maybeSingle: () => PromiseLike<BrainSingleResult<Row>>;
  single: () => PromiseLike<BrainSingleResult<Row>>;
}

/**
 * Generic Supabase-compatible query builder interface for unregistered tables.
 */
interface BrainQueryBuilder<Row> {
  select: (columns?: string) => BrainFilterBuilder<Row>;
  insert: (
    values: Partial<Row>[],
    options?: { count?: "exact" | "planned" | "estimated" }
  ) => BrainFilterBuilder<Row>;
  update: (values: Partial<Row>) => BrainFilterBuilder<Row>;
  delete: () => BrainFilterBuilder<Row>;
}

interface BrainDbClient {
  from(table: "brain_events"): BrainQueryBuilder<BrainEventRow>;
  from(table: "brain_rules"): BrainQueryBuilder<BrainRuleRow>;
}

/**
 * Typed accessor for brain tables.
 * Uses a double cast: supabase -> unknown -> BrainDbClient
 * This is safe because at runtime supabase.from() works with any table name.
 */
export const brainDb: BrainDbClient = supabase as unknown as BrainDbClient;
