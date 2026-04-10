/**
 * CP (Congés Payés) Computation Engine - PHASE TRANSITOIRE
 * 
 * SSOT for CP balance calculation.
 * Pure function, no React/Supabase dependencies.
 * Easily removable when transitioning to a proper CP module.
 * 
 * Rule: Consume CP N-1 first, then CP N (CP N can go negative)
 */

export interface CpBalanceInputs {
  /** CP N-1: Reliquat année précédente (from employee contract) */
  cpN1: number;
  /** CP N: Droits année en cours (from employee contract) */
  cpN: number;
  /** CP pris ce mois (from payroll calculation) */
  cpTakenThisMonth: number;
}

export interface CpBalanceResult {
  /** Remaining CP N-1 after consumption */
  remainingCpN1: number;
  /** Remaining CP N after consumption (can be negative) */
  remainingCpN: number;
  /** How many days consumed from CP N-1 this month */
  consumedFromN1: number;
  /** How many days consumed from CP N this month */
  consumedFromN: number;
}

/**
 * Compute CP balances after consumption.
 * 
 * Consumption rule:
 * 1. First consume from CP N-1 (reliquat)
 * 2. Then consume from CP N (current year)
 * 3. CP N can become negative if over-consumed
 * 
 * @param inputs - CP inputs from contract and payroll
 * @returns Computed CP balances
 */
export function computeCpBalances(inputs: CpBalanceInputs): CpBalanceResult {
  const { cpN1, cpN, cpTakenThisMonth } = inputs;
  
  // Handle edge case: no consumption
  if (cpTakenThisMonth <= 0) {
    return {
      remainingCpN1: cpN1,
      remainingCpN: cpN,
      consumedFromN1: 0,
      consumedFromN: 0,
    };
  }
  
  // Consume from N-1 first
  const consumedFromN1 = Math.min(cpTakenThisMonth, Math.max(0, cpN1));
  const remainingAfterN1 = cpTakenThisMonth - consumedFromN1;
  
  // Then consume from N (can go negative)
  const consumedFromN = remainingAfterN1;
  
  return {
    remainingCpN1: cpN1 - consumedFromN1,
    remainingCpN: cpN - consumedFromN,
    consumedFromN1,
    consumedFromN,
  };
}

/**
 * Format CP balance for display
 * Shows value with sign if negative
 */
export function formatCpBalance(value: number): string {
  if (value < 0) {
    return `${value.toFixed(1)} j`;
  }
  return `${value.toFixed(1)} j`;
}
