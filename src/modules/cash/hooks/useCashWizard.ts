/**
 * State machine hook for the cash wizard (5-step quick entry)
 */

import { useState, useCallback } from "react";
import type { CashWizardValues, WizardStep } from "../utils/types";
import { DEFAULT_WIZARD_VALUES, WIZARD_STEPS } from "../utils/types";

export function useCashWizard(prefill?: Partial<CashWizardValues>) {
  const [step, setStep] = useState<WizardStep>("cb");
  const [values, setValues] = useState<CashWizardValues>({
    ...DEFAULT_WIZARD_VALUES,
    ...prefill,
  });

  const stepIndex = WIZARD_STEPS.indexOf(step);

  const next = useCallback(() => {
    const idx = WIZARD_STEPS.indexOf(step);
    if (idx < WIZARD_STEPS.length - 1) {
      setStep(WIZARD_STEPS[idx + 1]);
    }
  }, [step]);

  const back = useCallback(() => {
    const idx = WIZARD_STEPS.indexOf(step);
    if (idx > 0) {
      setStep(WIZARD_STEPS[idx - 1]);
    }
  }, [step]);

  const updateField = useCallback(
    <K extends keyof CashWizardValues>(key: K, value: CashWizardValues[K]) => {
      setValues((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const reset = useCallback(
    (newPrefill?: Partial<CashWizardValues>) => {
      setStep("cb");
      setValues({ ...DEFAULT_WIZARD_VALUES, ...newPrefill });
    },
    []
  );

  const isFirst = stepIndex === 0;
  const isLast = step === "summary";

  return {
    step,
    stepIndex,
    values,
    next,
    back,
    updateField,
    reset,
    isFirst,
    isLast,
    totalSteps: WIZARD_STEPS.length,
  };
}
