import { describe, it, expect } from "vitest";
import { normalizeName, matchItems, computeScore, scoreRating } from "../scoring";
import type { BenchRun, BenchItem, BenchInsight } from "../../types";

// ─── Helpers ────────────────────────────────────────────────────────────────

function item(
  name: string,
  price: number | null,
  qty: number | null = null,
  unit: string | null = null
): BenchItem {
  return {
    code_produit: null,
    nom_produit_complet: name,
    info_produit: null,
    quantite_commandee: qty,
    prix_total_ligne: price,
    contenu_facture: unit,
  };
}

function run(overrides: Partial<BenchRun> = {}): BenchRun {
  return {
    id: crypto.randomUUID(),
    bench_pdf_id: "pdf-fac-2026-01365",
    model_id: "test/model",
    model_label: "Test",
    prompt_version: "v1",
    source: "manual",
    duration_ms: 3000,
    tokens_input: 8000,
    tokens_output: 2000,
    cost_usd: 0.005,
    result_invoice: null,
    result_items: [],
    result_insights: [],
    items_count: 0,
    insights_count: 0,
    raw_ai_content: null,
    status: "success",
    error_message: null,
    created_at: new Date().toISOString(),
    created_by: null,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// GROUND TRUTH — FAC-2026-01365 (JAWAR FRAIS → LABAJA SAS)
// ═══════════════════════════════════════════════════════════════════════════

const INVOICE_TRUTH = {
  supplier_name: "SARL JAWAR FRAIS",
  invoice_number: "FAC-2026-01365",
  invoice_date: "2026-02-15",
  invoice_total: 1038.24,
};

/** 22 product lines — this is the real content of the invoice */
const ITEMS_TRUTH: BenchItem[] = [
  item("Beurre doux", 42.5, 5, "kg"),
  item("Bûche de chèvre long", 132.0, 60, "piece"),
  item("Crème fraîche normande", 46.0, 10, "kg"),
  item("Crème liquide 30%", 415.8, 108, "litre"),
  item("Lait demi écremé", 21.6, 24, "litre"),
  item("Ail pelé", 11.9, 2, "kg"),
  item("Avocat", 13.0, 10, "piece"),
  item("Brocoli", 15.0, 6, "kg"),
  item("Carotte extra", 14.0, 20, "kg"),
  item("Pied coupé", 48.0, 15, "kg"),
  item("Citron jaune", 26.88, 12.22, "kg"),
  item("Fenouil", 9.84, 5.32, "kg"),
  item("Fraise", 31.9, 2, "kg"),
  item("Haricot vert fin", 17.2, 4, "piece"),
  item("Oignon jaune", 6.5, 10, "kg"),
  item("PDT agria lavé", 12.5, 25, "kg"),
  item("Roquette cristal", 20.85, 3, "kg"),
  item("Tomate cerise trio", 44.0, 8, "kg"),
  item("Tomate datte", 44.33, 7.4, "kg"),
  item("Basilic botte", 2.75, 5, "piece"),
  item("Persil plat", 2.75, 5, "piece"),
  item("Céleri branche", 4.8, 3, "piece"),
];

const INSIGHTS_TRUTH: BenchInsight[] = [
  { label: "IBAN", value: "FR76 1020 7000 3122 2199 4542 894" },
  { label: "BIC", value: "CCBPFRPPMTG" },
  { label: "Échéance", value: "05/03/2026" },
  { label: "Moyen de paiement", value: "Prélèvement" },
  { label: "SIRET", value: "840 518 757 000 25" },
  { label: "N° TVA intracom", value: "FR 58 840518757" },
  { label: "Référence BL", value: "BL-20260215-01350" },
  { label: "Date de livraison", value: "14/02/2026" },
];

// The "perfect" reference run
const REF_RUN = run({
  id: "ref-jawar",
  model_id: "google/gemini-2.5-pro",
  model_label: "Gemini 2.5 Pro (REF)",
  result_invoice: INVOICE_TRUTH,
  result_items: ITEMS_TRUTH,
  result_insights: INSIGHTS_TRUTH,
  items_count: 22,
  insights_count: 8,
  duration_ms: 5200,
  cost_usd: 0.018,
});

// ═══════════════════════════════════════════════════════════════════════════
// UNIT TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe("normalizeName", () => {
  it("strips accents and lowercases", () => {
    expect(normalizeName("Crème Fraîche Épaisse")).toBe("creme fraiche epaisse");
  });
  it("collapses whitespace and trims", () => {
    expect(normalizeName("  Bûche  de   chèvre  ")).toBe("buche de chevre");
  });
  it("removes special chars", () => {
    expect(normalizeName("PDT agria lavé *25 kg NL")).toBe("pdt agria lave 25 kg nl");
  });
});

describe("matchItems", () => {
  it("matches all 22 items perfectly", () => {
    const { matched, missedIndices, extraIndices } = matchItems(ITEMS_TRUTH, ITEMS_TRUTH);
    expect(matched).toHaveLength(22);
    expect(missedIndices).toHaveLength(0);
    expect(extraIndices).toHaveLength(0);
  });

  it("matches items with packaging in the name", () => {
    const variant = [
      item("Beurre doux *250 gr", 42.5, 5),
      item("Buche chevre long *180 gr", 132.0, 60),
    ];
    const { matched } = matchItems(ITEMS_TRUTH.slice(0, 2), variant);
    expect(matched).toHaveLength(2);
  });

  it("detects Commentaire externe as hallucinations", () => {
    const withHallucinations = [
      ...ITEMS_TRUTH,
      item("Commentaire externe 18 pack", null, null),
      item("Commentaire externe a peser", null, null),
    ];
    const { matched, extraIndices } = matchItems(ITEMS_TRUTH, withHallucinations);
    expect(matched).toHaveLength(22);
    expect(extraIndices).toHaveLength(2);
  });
});

describe("scoreRating", () => {
  it("Excellent >= 90", () => expect(scoreRating(92).label).toBe("Excellent"));
  it("Bon 70-89", () => expect(scoreRating(78).label).toBe("Bon"));
  it("Moyen 50-69", () => expect(scoreRating(55).label).toBe("Moyen"));
  it("Faible < 50", () => expect(scoreRating(35).label).toBe("Faible"));
});

// ═══════════════════════════════════════════════════════════════════════════
// FAC-2026-01365 — FULL 17-MODEL COMPARISON
// ═══════════════════════════════════════════════════════════════════════════
//
// Simulated extraction quality per tier based on known model capabilities:
//   Light:    miss items at end, partial supplier name, few insights
//   Standard: miss 0-1 items, good invoice, most insights
//   Premium:  all items, all fields, may hallucinate instructions as items

describe("FAC-2026-01365 — 17-model comparison", () => {
  // ── Light tier ──────────────────────────────────────────────────────────

  const gemma3 = run({
    model_id: "google/gemma-3-27b-it",
    model_label: "Gemma 3 27B",
    result_invoice: {
      supplier_name: "JAWAR",
      invoice_number: "01365",
      invoice_date: "2026-02-15",
      invoice_total: 1038.24,
    },
    result_items: ITEMS_TRUTH.slice(0, 15), // misses last 7
    result_insights: [],
    items_count: 15,
    insights_count: 0,
    duration_ms: 1800,
    cost_usd: 0.0004,
  });

  const novaLite = run({
    model_id: "amazon/nova-lite-v1",
    model_label: "Nova Lite",
    result_invoice: {
      supplier_name: "JAWAR FRAIS",
      invoice_number: "FAC-2026-01365",
      invoice_date: "2026-02-15",
      invoice_total: 984.1, // HT instead of TTC
    },
    result_items: ITEMS_TRUTH.slice(0, 18), // misses last 4
    result_insights: [{ label: "IBAN", value: "FR76 1020 7000 3122 2199 4542 894" }],
    items_count: 18,
    insights_count: 1,
    duration_ms: 1200,
    cost_usd: 0.0005,
  });

  const llamaScout = run({
    model_id: "meta-llama/llama-4-scout",
    model_label: "Llama 4 Scout",
    result_invoice: {
      supplier_name: "SARL JAWAR FRAIS",
      invoice_number: "FAC-2026-01365",
      invoice_date: "2026-02-15",
      invoice_total: 1038.24,
    },
    result_items: ITEMS_TRUTH.slice(0, 17), // misses last 5
    result_insights: [{ label: "IBAN", value: "FR76 1020 7000 3122 2199 4542 894" }],
    items_count: 17,
    insights_count: 1,
    duration_ms: 1500,
    cost_usd: 0.0006,
  });

  const flashLite = run({
    model_id: "google/gemini-2.5-flash-lite",
    model_label: "Gemini 2.5 Flash Lite",
    result_invoice: {
      supplier_name: "SARL JAWAR FRAIS",
      invoice_number: "FAC-2026-01365",
      invoice_date: "2026-02-15",
      invoice_total: 1038.24,
    },
    result_items: ITEMS_TRUTH.slice(0, 20), // misses Persil + Céleri
    result_insights: [
      { label: "IBAN", value: "FR76 1020 7000 3122 2199 4542 894" },
      { label: "BIC", value: "CCBPFRPPMTG" },
    ],
    items_count: 20,
    insights_count: 2,
    duration_ms: 2100,
    cost_usd: 0.0012,
  });

  const gpt4oMini = run({
    model_id: "openai/gpt-4o-mini",
    model_label: "GPT-4o Mini",
    result_invoice: {
      supplier_name: "SARL JAWAR FRAIS",
      invoice_number: "FAC-2026-01365",
      invoice_date: "2026-02-15",
      invoice_total: 1038.24,
    },
    result_items: ITEMS_TRUTH.slice(0, 19), // misses last 3
    result_insights: [
      { label: "IBAN", value: "FR76 1020 7000 3122 2199 4542 894" },
      { label: "BIC", value: "CCBPFRPPMTG" },
      { label: "Échéance", value: "05/03/2026" },
    ],
    items_count: 19,
    insights_count: 3,
    duration_ms: 3200,
    cost_usd: 0.0018,
  });

  // ── Standard tier ───────────────────────────────────────────────────────

  const geminiFlash = run({
    model_id: "google/gemini-2.5-flash",
    model_label: "Gemini 2.5 Flash",
    result_invoice: INVOICE_TRUTH,
    result_items: ITEMS_TRUTH.slice(0, 21), // misses only Céleri branche
    result_insights: [
      { label: "IBAN", value: "FR76 1020 7000 3122 2199 4542 894" },
      { label: "BIC", value: "CCBPFRPPMTG" },
      { label: "Échéance", value: "05/03/2026" },
      { label: "Moyen de paiement", value: "Prélèvement" },
      { label: "Référence BL", value: "BL-20260215-01350" },
    ],
    items_count: 21,
    insights_count: 5,
    duration_ms: 2800,
    cost_usd: 0.0045,
  });

  const gpt41Mini = run({
    model_id: "openai/gpt-4.1-mini",
    model_label: "GPT-4.1 Mini",
    result_invoice: INVOICE_TRUTH,
    result_items: ITEMS_TRUTH, // all 22
    result_insights: [
      { label: "IBAN", value: "FR76 1020 7000 3122 2199 4542 894" },
      { label: "BIC", value: "CCBPFRPPMTG" },
      { label: "Échéance", value: "05/03/2026" },
      { label: "Moyen de paiement", value: "Prélèvement" },
    ],
    items_count: 22,
    insights_count: 4,
    duration_ms: 3500,
    cost_usd: 0.0065,
  });

  const gemini3Flash = run({
    model_id: "google/gemini-3-flash-preview",
    model_label: "Gemini 3 Flash",
    result_invoice: INVOICE_TRUTH,
    result_items: ITEMS_TRUTH, // all 22
    result_insights: [
      { label: "IBAN", value: "FR76 1020 7000 3122 2199 4542 894" },
      { label: "BIC", value: "CCBPFRPPMTG" },
      { label: "Échéance", value: "05/03/2026" },
      { label: "Moyen de paiement", value: "Prélèvement" },
      { label: "SIRET", value: "840 518 757 000 25" },
      { label: "Référence BL", value: "BL-20260215-01350" },
    ],
    items_count: 22,
    insights_count: 6,
    duration_ms: 3100,
    cost_usd: 0.0072,
  });

  const mistralLarge = run({
    model_id: "mistralai/mistral-large-2512",
    model_label: "Mistral Large 3",
    result_invoice: INVOICE_TRUTH,
    result_items: [
      ...ITEMS_TRUTH.slice(0, 21),
      item("Celeri branche", 4.8, 3, "piece"), // slight accent diff
    ],
    result_insights: [
      { label: "IBAN", value: "FR76 1020 7000 3122 2199 4542 894" },
      { label: "BIC", value: "CCBPFRPPMTG" },
      { label: "Échéance", value: "05/03/2026" },
      { label: "Moyen de paiement", value: "Prélèvement" },
    ],
    items_count: 22,
    insights_count: 4,
    duration_ms: 4100,
    cost_usd: 0.0058,
  });

  // ── Premium tier ────────────────────────────────────────────────────────

  const gpt51 = run({
    model_id: "openai/gpt-5.1",
    model_label: "GPT-5.1",
    result_invoice: INVOICE_TRUTH,
    result_items: ITEMS_TRUTH,
    result_insights: [
      { label: "IBAN", value: "FR76 1020 7000 3122 2199 4542 894" },
      { label: "BIC", value: "CCBPFRPPMTG" },
      { label: "Échéance", value: "05/03/2026" },
      { label: "Moyen de paiement", value: "Prélèvement" },
      { label: "SIRET", value: "840 518 757 000 25" },
      { label: "N° TVA intracom", value: "FR 58 840518757" },
      { label: "Référence BL", value: "BL-20260215-01350" },
    ],
    items_count: 22,
    insights_count: 7,
    duration_ms: 4800,
    cost_usd: 0.016,
  });

  const pixtralLarge = run({
    model_id: "mistralai/pixtral-large-2411",
    model_label: "Pixtral Large",
    result_invoice: INVOICE_TRUTH,
    result_items: ITEMS_TRUTH,
    result_insights: INSIGHTS_TRUTH,
    items_count: 22,
    insights_count: 8,
    duration_ms: 3800,
    cost_usd: 0.014,
  });

  const gpt41 = run({
    model_id: "openai/gpt-4.1",
    model_label: "GPT-4.1",
    result_invoice: INVOICE_TRUTH,
    result_items: [
      ...ITEMS_TRUTH,
      item("Commentaire externe 18 pack", null, null), // hallucination
    ],
    result_insights: [
      { label: "IBAN", value: "FR76 1020 7000 3122 2199 4542 894" },
      { label: "BIC", value: "CCBPFRPPMTG" },
      { label: "Échéance", value: "05/03/2026" },
      { label: "Moyen de paiement", value: "Prélèvement" },
      { label: "SIRET", value: "840 518 757 000 25" },
      { label: "Référence BL", value: "BL-20260215-01350" },
    ],
    items_count: 23,
    insights_count: 6,
    duration_ms: 5500,
    cost_usd: 0.02,
  });

  const gemini3Pro = run({
    model_id: "google/gemini-3-pro-preview",
    model_label: "Gemini 3 Pro",
    result_invoice: INVOICE_TRUTH,
    result_items: ITEMS_TRUTH,
    result_insights: INSIGHTS_TRUTH,
    items_count: 22,
    insights_count: 8,
    duration_ms: 6200,
    cost_usd: 0.025,
  });

  const gpt4o = run({
    model_id: "openai/gpt-4o",
    model_label: "GPT-4o",
    result_invoice: INVOICE_TRUTH,
    result_items: [
      ...ITEMS_TRUTH.slice(0, 9),
      item("Pied coupé", 45.0, 15, "kg"), // price diff: 48→45
      ...ITEMS_TRUTH.slice(10),
    ],
    result_insights: [
      { label: "IBAN", value: "FR76 1020 7000 3122 2199 4542 894" },
      { label: "BIC", value: "CCBPFRPPMTG" },
      { label: "Échéance", value: "05/03/2026" },
      { label: "Moyen de paiement", value: "Prélèvement" },
      { label: "SIRET", value: "840 518 757 000 25" },
    ],
    items_count: 22,
    insights_count: 5,
    duration_ms: 5800,
    cost_usd: 0.022,
  });

  const claudeSonnet4 = run({
    model_id: "anthropic/claude-sonnet-4",
    model_label: "Claude Sonnet 4",
    result_invoice: INVOICE_TRUTH,
    result_items: ITEMS_TRUTH,
    result_insights: INSIGHTS_TRUTH,
    items_count: 22,
    insights_count: 8,
    duration_ms: 4500,
    cost_usd: 0.024,
  });

  const claudeSonnet45 = run({
    model_id: "anthropic/claude-sonnet-4.5",
    model_label: "Claude Sonnet 4.5",
    result_invoice: INVOICE_TRUTH,
    result_items: ITEMS_TRUTH,
    result_insights: INSIGHTS_TRUTH,
    items_count: 22,
    insights_count: 8,
    duration_ms: 4200,
    cost_usd: 0.024,
  });

  const ALL_RUNS = [
    REF_RUN,
    gemma3,
    novaLite,
    llamaScout,
    flashLite,
    gpt4oMini,
    geminiFlash,
    gpt41Mini,
    gemini3Flash,
    mistralLarge,
    gpt51,
    pixtralLarge,
    gpt41,
    gemini3Pro,
    gpt4o,
    claudeSonnet4,
    claudeSonnet45,
  ];

  it("scores all 16 models and prints the comparison table", () => {
    const testedRuns = ALL_RUNS.filter((r) => r.id !== REF_RUN.id);

    const results = testedRuns.map((r) => ({
      run: r,
      score: computeScore(r, REF_RUN, ALL_RUNS),
    }));
    results.sort((a, b) => b.score.overall - a.score.overall);

    // Pretty table
    console.log(
      "\n╔═══════════════════════╤══════════╤═════════╤═══════╤════════╤════════╤══════╤══════╤══════════╤══════════════════════════════╗"
    );
    console.log(
      "║ Model                 │ Overall  │ Invoice │ Items │ Recall │ Precis │ Ins. │ Perf │ Cost     │ Issues                       ║"
    );
    console.log(
      "╠═══════════════════════╪══════════╪═════════╪═══════╪════════╪════════╪══════╪══════╪══════════╪══════════════════════════════╣"
    );

    for (const { run: r, score: s } of results) {
      const rating = scoreRating(s.overall);
      const issues: string[] = [];
      if (s.missedItems.length > 0) issues.push(`-${s.missedItems.length} missed`);
      if (s.extraItems.length > 0) issues.push(`+${s.extraItems.length} halluc`);
      if (s.priceDiffs.length > 0) issues.push(`~${s.priceDiffs.length} price`);
      if (issues.length === 0) issues.push("clean");

      console.log(
        `║ ${r.model_label.padEnd(21)} │ ${String(s.overall).padStart(3)} ${rating.label.padEnd(4).slice(0, 4)} │ ${String(s.invoice).padStart(7)} │ ${String(s.items).padStart(5)} │ ${String(s.itemsRecall).padStart(4)}%  │ ${String(s.itemsPrecision).padStart(4)}%  │ ${String(s.insights).padStart(4)} │ ${String(s.performance).padStart(4)} │ $${(r.cost_usd ?? 0).toFixed(4).padStart(7)} │ ${issues.join(", ").padEnd(28)} ║`
      );
    }
    console.log(
      "╚═══════════════════════╧══════════╧═════════╧═══════╧════════╧════════╧══════╧══════╧══════════╧══════════════════════════════╝"
    );

    // ── Assertions ────────────────────────────────────────────────────

    // Pixtral Large: perfect run → 100 on items + insights
    const pixtralScore = results.find(
      (r) => r.run.model_id === "mistralai/pixtral-large-2411"
    )!.score;
    expect(pixtralScore.items).toBe(100);
    expect(pixtralScore.insights).toBe(100);
    expect(pixtralScore.missedItems).toHaveLength(0);

    // Gemini 3 Pro: perfect data → score >= 90
    const g3proScore = results.find((r) => r.run.model_id === "google/gemini-3-pro-preview")!.score;
    expect(g3proScore.overall).toBeGreaterThanOrEqual(90);

    // GPT-4.1: hallucinated "Commentaire externe"
    const gpt41Score = results.find((r) => r.run.model_id === "openai/gpt-4.1")!.score;
    expect(gpt41Score.extraItems).toHaveLength(1);
    expect(gpt41Score.itemsPrecision).toBeLessThan(100);

    // GPT-4o: price diff on Pied coupé
    const gpt4oScore = results.find((r) => r.run.model_id === "openai/gpt-4o")!.score;
    expect(gpt4oScore.priceDiffs).toHaveLength(1);
    expect(gpt4oScore.priceDiffs[0].expected).toBe(48.0);
    expect(gpt4oScore.priceDiffs[0].got).toBe(45.0);

    // Nova Lite: wrong total (HT not TTC) → invoice < 100
    const novaScore = results.find((r) => r.run.model_id === "amazon/nova-lite-v1")!.score;
    expect(novaScore.invoice).toBeLessThan(100);

    // Gemma 3: misses 7 items, worst recall
    const gemmaScore = results.find((r) => r.run.model_id === "google/gemma-3-27b-it")!.score;
    expect(gemmaScore.missedItems).toHaveLength(7);
    expect(gemmaScore.itemsRecall).toBeLessThan(75);
  });
});
