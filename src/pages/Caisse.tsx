/**
 * Caisse Page - Entry point for Cash Module
 * Simply re-exports the isolated module component
 */

import { CASH_ENABLED, CashPage } from "@/modules/cash";
import { Navigate } from "react-router-dom";

export default function Caisse() {
  // If feature is disabled, redirect to home
  if (!CASH_ENABLED) {
    return <Navigate to="/" replace />;
  }

  return <CashPage />;
}
