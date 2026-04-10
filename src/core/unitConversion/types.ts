/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CORE — UNIT CONVERSION TYPES
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface ConversionRule {
  id: string;
  from_unit_id: string;
  to_unit_id: string;
  factor: number;
  establishment_id: string | null;
  is_active: boolean;
}

export interface UnitWithFamily {
  id: string;
  name: string;
  abbreviation: string;
  category: string;
  family: string | null;
  is_reference: boolean;
  aliases: string[] | null;
}
