/**
 * Shared types for the realtime sync system.
 */

export interface UseAppRealtimeSyncParams {
  establishmentId: string | null;
  /** Organization ID for filtering employee_details (which uses organization_id, not establishment_id) */
  organizationId?: string | null;
  enabled?: boolean;
}

/** Number of realtime channels managed by this orchestrator */
export const CHANNEL_COUNT = 23; // badge_events, planning_shifts, planning_weeks, extra_events, employee_details, planning_rextra_events, payroll_validation, cash_day_reports, personnel_leaves, personnel_leave_requests, invoice_suppliers, invoices, invoice_monthly_statements, stock_events, inventory_sessions, inventory_lines, notification_events, bl_withdrawal_documents, bl_withdrawal_lines, commandes (x2: CL+FO), commande_lines, litiges, litige_lines
