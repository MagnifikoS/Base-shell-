/**
 * Query invalidation helpers for the realtime sync system.
 *
 * Each function invalidates a specific group of React Query keys
 * when a realtime event is received.
 */

import type { QueryClient } from "@tanstack/react-query";

/**
 * Invalidate all presence-related queries scoped to one establishment.
 *
 * Uses prefix matching (exact: false) because realtime events don't carry
 * the specific dayDate. All query keys start with [category, establishmentId, ...]
 * so this only invalidates the affected establishment, not others.
 */
export function invalidatePresence(queryClient: QueryClient, establishmentId: string) {
  // Presence queries (all dates for this establishment)
  queryClient.invalidateQueries({
    queryKey: ["presence", establishmentId],
    exact: false,
  });

  // Service day (scoped — triggers presence cascade)
  queryClient.invalidateQueries({
    queryKey: ["service-day-today", establishmentId],
  });

  // Alerts queries
  queryClient.invalidateQueries({
    queryKey: ["alerts", establishmentId],
    exact: false,
  });

  // Absence queries (scoped by establishmentId)
  queryClient.invalidateQueries({
    queryKey: ["absence", "monthly", establishmentId],
    exact: false,
  });
  queryClient.invalidateQueries({
    queryKey: ["absence", "detail", establishmentId],
    exact: false,
  });

  // Badge status queries
  queryClient.invalidateQueries({
    queryKey: ["badge-status", establishmentId],
    exact: false,
  });

  // Late data queries
  queryClient.invalidateQueries({
    queryKey: ["late", establishmentId],
    exact: false,
  });

  // Extras data queries
  queryClient.invalidateQueries({
    queryKey: ["extras", establishmentId],
    exact: false,
  });
}

/**
 * Invalidate all planning-related queries by prefix (exact: false)
 * PHASE D: Also invalidate payroll queries when planning changes
 */
export function invalidatePlanning(queryClient: QueryClient, establishmentId: string) {
  queryClient.invalidateQueries({
    queryKey: ["planning-week", establishmentId],
    exact: false,
  });

  // PHASE D: Invalidate payroll when planning shifts change
  queryClient.invalidateQueries({
    queryKey: ["payroll", "month", establishmentId],
    exact: false,
  });
}

/**
 * Invalidate cash-related queries (for cash_day_reports changes)
 */
export function invalidateCash(queryClient: QueryClient, establishmentId: string) {
  queryClient.invalidateQueries({
    queryKey: ["cash-day", establishmentId],
    exact: false,
  });
  queryClient.invalidateQueries({
    queryKey: ["cash-month", establishmentId],
    exact: false,
  });
}

/**
 * Invalidate payroll-related queries (for extras and employee_details changes)
 */
export function invalidatePayroll(queryClient: QueryClient, establishmentId: string) {
  queryClient.invalidateQueries({
    queryKey: ["payroll", "month", establishmentId],
    exact: false,
  });
}

/**
 * Invalidate stock/inventory-related queries (for stock_events changes).
 *
 * These keys match the ones used in the inventaire module's usePostDocument
 * and related hooks. Uses prefix matching since the query keys don't always
 * include establishmentId as a suffix.
 */
export function invalidateStock(queryClient: QueryClient, establishmentId: string) {
  queryClient.invalidateQueries({ queryKey: ["estimated-stock", establishmentId], exact: false });
  queryClient.invalidateQueries({ queryKey: ["stock-alerts", establishmentId], exact: false });
  queryClient.invalidateQueries({ queryKey: ["desktop-stock", establishmentId], exact: false });
  queryClient.invalidateQueries({ queryKey: ["stock-documents-posted", establishmentId], exact: false });
}

/**
 * Invalidate inventory session/line queries (for inventory_sessions & inventory_lines changes).
 *
 * Covers the query keys used by useInventorySessions, useInventoryLines, and
 * the desktop stock view. Also cascades to estimated-stock and stock-alerts
 * so the realtime stock view stays accurate after counting.
 */
export function invalidateInventory(queryClient: QueryClient, establishmentId: string) {
  // Session queries (scoped by establishmentId)
  queryClient.invalidateQueries({
    queryKey: ["inventory-sessions", establishmentId],
    exact: false,
  });
  // Line queries (scoped by sessionId — prefix match catches all sessions)
  queryClient.invalidateQueries({ queryKey: ["inventory-lines"], exact: false });
  // Desktop stock view (scoped)
  queryClient.invalidateQueries({
    queryKey: ["desktop-stock", establishmentId],
    exact: false,
  });
  // Zone lines stats (batch query used by zone selector)
  queryClient.invalidateQueries({ queryKey: ["zone-lines-stats-batch"], exact: false });
  // Cascade: estimated stock + alerts (scoped)
  queryClient.invalidateQueries({ queryKey: ["estimated-stock", establishmentId], exact: false });
  queryClient.invalidateQueries({ queryKey: ["stock-alerts", establishmentId], exact: false });
}

/**
 * PHASE C: Invalidate ALL employee-related query variants (prefix-based)
 * Ensures sync for employees desktop, mobile, admin-users, archived views
 *
 * PERF 4B: When establishmentId is provided, only invalidate queries scoped
 * to that establishment instead of every cached employee list.
 */
/**
 * Invalidate BL Retrait (withdrawal) queries.
 * Triggered by bl_withdrawal_documents / bl_withdrawal_lines realtime channels.
 * Also cascades to commande queries so shipped quantities update instantly.
 */
export function invalidateBlRetrait(queryClient: QueryClient, establishmentId?: string) {
  // BL Retrait list + detail (scoped when possible)
  queryClient.invalidateQueries({ queryKey: ["bl-retraits"], exact: false });
  queryClient.invalidateQueries({ queryKey: ["bl-retrait-lines"], exact: false });
  queryClient.invalidateQueries({ queryKey: ["bl-retrait-doc-detail"], exact: false });
  if (establishmentId) {
    queryClient.invalidateQueries({ queryKey: ["bl-retrait-documents", establishmentId], exact: false });
  } else {
    queryClient.invalidateQueries({ queryKey: ["bl-retrait-documents"], exact: false });
  }
  // Shipped lines used in commande OrderDetail
  queryClient.invalidateQueries({ queryKey: ["bl-withdrawal-lines"], exact: false });
  // Correction indicator
  queryClient.invalidateQueries({ queryKey: ["bl-correction-exists"], exact: false });
}

export function invalidateEmployees(queryClient: QueryClient, establishmentId?: string) {
  if (establishmentId) {
    // Scoped invalidation — only the affected establishment
    queryClient.invalidateQueries({
      queryKey: ["employees", establishmentId],
      exact: false,
    });
    queryClient.invalidateQueries({
      queryKey: ["employees-mobile", establishmentId],
      exact: false,
    });
    queryClient.invalidateQueries({
      queryKey: ["admin-users", establishmentId],
      exact: false,
    });
    queryClient.invalidateQueries({
      queryKey: ["archived-employees", establishmentId],
      exact: false,
    });
    queryClient.invalidateQueries({
      queryKey: ["archived-employees-mobile", establishmentId],
      exact: false,
    });
    // Also invalidate employee detail sheet (scoped)
    queryClient.invalidateQueries({
      queryKey: ["employee", establishmentId],
      exact: false,
    });
  } else {
    // Fallback: invalidate ALL variants via prefix (exact: false)
    queryClient.invalidateQueries({
      queryKey: ["employees"],
      exact: false,
    });
    queryClient.invalidateQueries({
      queryKey: ["employees-mobile"],
      exact: false,
    });
    queryClient.invalidateQueries({
      queryKey: ["admin-users"],
      exact: false,
    });
    queryClient.invalidateQueries({
      queryKey: ["archived-employees"],
      exact: false,
    });
    queryClient.invalidateQueries({
      queryKey: ["archived-employees-mobile"],
      exact: false,
    });
    // Also invalidate employee detail sheet
    queryClient.invalidateQueries({
      queryKey: ["employee"],
      exact: false,
    });
  }
}
