/**
 * SSOT: Supplier Name Normalization for Frontend
 * 
 * Two normalization modes:
 * - STRICT: Mirrors DB name_normalized (keeps legal forms) → for exact 100% match
 * - LOOSE: Removes legal forms → for fuzzy Levenshtein matching
 */

/**
 * Normalisation "DB-like" : garde les formes juridiques (SAS, SARL, ...)
 * Objectif: produire la même chaîne que `name_normalized` côté DB
 */
export function normalizeStrictForExactMatch(input: string): string {
  return baseNormalize(input);
}

/**
 * Normalisation "loose" : supprime les formes juridiques pour le fuzzy matching
 * Objectif: mieux matcher "SAS BAYT UL LAHM" avec "BAYT UL LAHM"
 */
export function normalizeLooseForFuzzyMatch(input: string): string {
  const strict = baseNormalize(input);
  return removeLegalForms(strict);
}

/**
 * Legacy alias - maps to loose normalization for backward compatibility
 * @deprecated Use normalizeStrictForExactMatch or normalizeLooseForFuzzyMatch
 */
export function normalizeSupplierName(name: string): string {
  return normalizeLooseForFuzzyMatch(name);
}

/**
 * Legacy alias for comparison (lowercase version)
 * @deprecated Use normalizeStrictForExactMatch or normalizeLooseForFuzzyMatch
 */
export function normalizeForComparison(name: string): string {
  return normalizeLooseForFuzzyMatch(name).toLowerCase();
}

/** ----------------- Helpers ----------------- **/

function baseNormalize(input: string): string {
  if (!input) return "";

  // 1) trim + uppercase
  let s = input.trim().toUpperCase();

  // 2) remove accents/diacritics
  s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // 3) replace punctuation with spaces (keep letters/numbers)
  //    Example: "BAYT-UL,LAHM" => "BAYT UL LAHM"
  s = s.replace(/[^A-Z0-9]+/g, " ");

  // 4) collapse spaces
  s = s.replace(/\s+/g, " ").trim();

  return s;
}

/**
 * Retire les formes juridiques seulement pour le fuzzy matching.
 * On enlève en début ET en fin (cas "BAYT UL LAHM SAS").
 */
function removeLegalForms(normalized: string): string {
  if (!normalized) return "";

  // Liste exhaustive des formes juridiques (fuzzy matching only)
  // Ordered by length (longer first for multi-word patterns)
  const LEGAL_FORMS = [
    // French - multi-word first
    "ENTREPRISE INDIVIDUELLE",
    "AUTO ENTREPRENEUR",
    "MICRO ENTREPRISE",
    "COOPERATIVE",
    "ASSOCIATION",
    "FONDATION",
    // French legal forms
    "SELASU",
    "SELAFA",
    "SELARL",
    "SELAS",
    "SASU",
    "SARL",
    "EURL",
    "SCEA",
    "SNC",
    "SCI",
    "SCA",
    "SCS",
    "SCP",
    "SAS",
    "SA",
    "SC",
    "EI",
    "GIE",
    "COOP",
    // Italian
    "SRLS",
    "SAPA",
    "SRL",
    "SPA",
    // English/International
    "CORPORATION",
    "INCORPORATED",
    "COMPANY",
    "LIMITED",
    "CORP",
    "INC",
    "LLC",
    "LTD",
    "LLP",
    "PLC",
    "PTY",
    "PVT",
    "CO",
    "LP",
    // German
    "GMBH",
    "OHG",
    "AG",
    "KG",
    "UG",
    // Dutch/Belgian
    "BV",
    "NV",
    "CV",
    // Spanish
    "SL",
    "SLU",
    // Common additions
    "GROUPE",
    "GROUP",
    "HOLDING",
    "FRERES",
    "FILS",
    "CIE",
    "AND",
    "ET",
  ];

  // On veut matcher des mots complets, pas des sous-chaînes
  // On traite en tokens
  let tokens = normalized.split(" ").filter(Boolean);

  const findMatchingForm = (slice: string[]): string | null => {
    for (let len = Math.min(3, slice.length); len >= 1; len--) {
      const joined = slice.slice(0, len).join(" ");
      if (LEGAL_FORMS.includes(joined)) return joined;
    }
    return null;
  };

  const findMatchingSuffix = (slice: string[]): number => {
    for (let len = Math.min(3, slice.length); len >= 1; len--) {
      const joined = slice.slice(-len).join(" ");
      if (LEGAL_FORMS.includes(joined)) return len;
    }
    return 0;
  };

  // Enlever autant que possible en début (certaines boîtes ont "SAS SASU ..." etc)
  let changed = true;
  while (changed && tokens.length > 0) {
    changed = false;
    const match = findMatchingForm(tokens);
    if (match) {
      const wordCount = match.split(" ").length;
      tokens = tokens.slice(wordCount);
      changed = true;
    }
  }

  // Enlever autant que possible en fin
  changed = true;
  while (changed && tokens.length > 0) {
    changed = false;
    const suffixLen = findMatchingSuffix(tokens);
    if (suffixLen > 0) {
      tokens = tokens.slice(0, -suffixLen);
      changed = true;
    }
  }

  return tokens.join(" ").trim();
}
