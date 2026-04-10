import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, CheckCircle, XCircle, Save, Clock, Plus, Trash2 } from "lucide-react";
import type { TimepointBreakPolicy } from "./types/breakPolicy.types";
import { timepointPolicySchema } from "@/lib/schemas/admin";

interface TimepointRuleEditorProps {
  onSave: (policy: TimepointBreakPolicy, inputText: string) => Promise<void>;
  isSaving: boolean;
}

// Generate time options every 30 minutes
const TIME_OPTIONS: string[] = [];
for (let h = 0; h < 24; h++) {
  TIME_OPTIONS.push(`${h.toString().padStart(2, "0")}:00`);
  TIME_OPTIONS.push(`${h.toString().padStart(2, "0")}:30`);
}

const BREAK_DURATION_OPTIONS = [0, 15, 30, 45, 60];

const MAX_RULES = 6;

interface RuleRow {
  id: string;
  time: string;
  break_minutes: number;
}

function generateId() {
  return Math.random().toString(36).substring(2, 9);
}

export function TimepointRuleEditor({ onSave, isSaving }: TimepointRuleEditorProps) {
  const [rules, setRules] = useState<RuleRow[]>([
    { id: generateId(), time: "11:00", break_minutes: 30 },
  ]);
  const [errors, setErrors] = useState<string[]>([]);
  const [validated, setValidated] = useState(false);

  const addRule = () => {
    if (rules.length >= MAX_RULES) return;
    setRules([...rules, { id: generateId(), time: "12:00", break_minutes: 30 }]);
    setValidated(false);
    setErrors([]);
  };

  const removeRule = (id: string) => {
    setRules(rules.filter((r) => r.id !== id));
    setValidated(false);
    setErrors([]);
  };

  const updateRule = (id: string, field: "time" | "break_minutes", value: string | number) => {
    setRules(rules.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
    setValidated(false);
    setErrors([]);
  };

  const validate = (): boolean => {
    const policyData = {
      rules: rules.map((r) => ({
        time: r.time,
        break_minutes: r.break_minutes,
      })),
    };
    const result = timepointPolicySchema.safeParse(policyData);
    if (result.success) {
      setErrors([]);
      setValidated(true);
      return true;
    }
    const newErrors = result.error.issues.map((issue) => issue.message);
    setErrors(newErrors);
    setValidated(false);
    return false;
  };

  const handleSave = async () => {
    if (!validate()) return;

    const policy: TimepointBreakPolicy = {
      type: "TIMEPOINTS",
      rules: rules.map((r) => ({
        time: r.time,
        break_minutes: r.break_minutes,
      })),
      apply_if: "SHIFT_START_LT_T_AND_SHIFT_END_GT_T",
    };

    // Generate input_text for display
    const inputText = rules.map((r) => `Pause à ${r.time} : ${r.break_minutes} min`).join("\n");

    await onSave(policy, inputText);
    setRules([{ id: generateId(), time: "11:00", break_minutes: 30 }]);
    setValidated(false);
    setErrors([]);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="h-4 w-4" />
          Nouvelle règle par heure(s)
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Une pause s'applique si le shift passe par l'heure (début &lt; T &lt; fin).
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          {rules.map((rule) => (
            <div key={rule.id} className="flex items-center gap-2">
              <Select value={rule.time} onValueChange={(v) => updateRule(rule.id, "time", v)}>
                <SelectTrigger className="w-[100px]" aria-label="Heure de la pause">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIME_OPTIONS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <span className="text-sm text-muted-foreground">→</span>

              <Select
                value={rule.break_minutes.toString()}
                onValueChange={(v) => updateRule(rule.id, "break_minutes", parseInt(v, 10))}
              >
                <SelectTrigger className="w-[90px]" aria-label="Durée de la pause">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BREAK_DURATION_OPTIONS.map((d) => (
                    <SelectItem key={d} value={d.toString()}>
                      {d} min
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                variant="ghost"
                size="icon"
                onClick={() => removeRule(rule.id)}
                disabled={rules.length <= 1}
                className="text-muted-foreground hover:text-destructive"
                aria-label="Supprimer la règle de pause"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>

        {rules.length < MAX_RULES && (
          <Button variant="outline" size="sm" onClick={addRule}>
            <Plus className="h-4 w-4 mr-1" />
            Ajouter une heure
          </Button>
        )}

        <div className="flex gap-2 pt-2">
          <Button variant="outline" onClick={validate} disabled={rules.length === 0}>
            Valider
          </Button>
          <Button onClick={handleSave} disabled={!validated || isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <Save className="mr-2 h-4 w-4" />
            Enregistrer
          </Button>
        </div>

        {errors.length > 0 && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertDescription>
              <ul className="list-disc list-inside">
                {errors.map((err, idx) => (
                  <li key={idx}>{err}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {validated && errors.length === 0 && (
          <Alert className="border-green-500/50 bg-green-50 dark:bg-green-950/30">
            <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
            <AlertDescription className="text-green-700 dark:text-green-400">
              Règles valides – prêtes à enregistrer
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
