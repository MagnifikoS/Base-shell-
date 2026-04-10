/**
 * orderPrep — Types for the "À commander" memo module
 * 100% isolated: no import from commandes, reception, or stock modules.
 */

export type OrderPrepStatus = "pending" | "checked" | "validated";

export interface OrderPrepLine {
  id: string;
  establishment_id: string;
  product_id: string;
  product_name: string;
  supplier_id: string;
  quantity: number;
  unit_id: string;
  status: OrderPrepStatus;
  created_by: string;
  created_at: string;
  validated_at: string | null;
}

/** Supplier card summary for the supplier list view */
export interface SupplierPrepSummary {
  supplierId: string;
  supplierName: string;
  lineCount: number;
  checkedCount: number;
  allChecked: boolean;
}
