/**
 * Displays a EUR amount or masked placeholder depending on visibility state.
 */

import { formatEur } from "../utils/money";

interface AmountCellProps {
  value: number;
  visible: boolean;
  className?: string;
}

export function AmountCell({ value, visible, className = "" }: AmountCellProps) {
  if (!visible) {
    return <span className={`text-muted-foreground ${className}`}>•••• €</span>;
  }
  return <span className={className}>{formatEur(value)}</span>;
}
