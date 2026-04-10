import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle, XCircle, Save, FlaskConical } from "lucide-react";
import type { AnalyzeResult, DurationBreakPolicy } from "./types/breakPolicy.types";

interface BreakRuleEditorProps {
  onAnalyze: (text: string) => Promise<AnalyzeResult>;
  onSave: (text: string) => Promise<void>;
  isAnalyzing: boolean;
  isSaving: boolean;
}

const PLACEHOLDER_TEXT = `Exemples de règles :
Si shift >= 6h alors pause 30 min
Si shift >= 9h alors pause 45 min
Pause non payée
Pas de pause si shift < 5h`;

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h${m.toString().padStart(2, "0")}`;
}

function PolicyPreview({ policy }: { policy: DurationBreakPolicy }) {
  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="font-medium">Type de pause:</span>
        <Badge variant={policy.paid_break ? "default" : "secondary"}>
          {policy.paid_break ? "Payée" : "Non payée"}
        </Badge>
      </div>
      <div>
        <span className="font-medium">Règles:</span>
        <ul className="mt-1 space-y-1 ml-4">
          {policy.rules.map((rule, idx) => (
            <li key={idx} className="text-muted-foreground">
              Shift ≥ {formatMinutes(rule.min_shift_minutes)} → Pause {rule.break_minutes} min
            </li>
          ))}
        </ul>
      </div>
      <div className="text-muted-foreground text-xs">
        Mode: {policy.apply === "largest_match" ? "Plus haute règle applicable" : policy.apply}
      </div>
    </div>
  );
}

export function BreakRuleEditor({
  onAnalyze,
  onSave,
  isAnalyzing,
  isSaving,
}: BreakRuleEditorProps) {
  const [inputText, setInputText] = useState("");
  const [analyzeResult, setAnalyzeResult] = useState<AnalyzeResult | null>(null);

  const handleAnalyze = async () => {
    if (!inputText.trim()) return;
    try {
      const result = await onAnalyze(inputText);
      setAnalyzeResult(result);
    } catch (err) {
      setAnalyzeResult({
        valid: false,
        errors: [err instanceof Error ? err.message : "Erreur inconnue"],
        policy: null,
      });
    }
  };

  const handleSave = async () => {
    if (!analyzeResult?.valid) return;
    await onSave(inputText);
    setInputText("");
    setAnalyzeResult(null);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FlaskConical className="h-4 w-4" />
          Nouvelle règle de pause
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Textarea
          placeholder={PLACEHOLDER_TEXT}
          value={inputText}
          onChange={(e) => {
            setInputText(e.target.value);
            setAnalyzeResult(null);
          }}
          className="min-h-[120px] font-mono text-sm"
        />

        <div className="flex gap-2">
          <Button
            onClick={handleAnalyze}
            disabled={!inputText.trim() || isAnalyzing}
            variant="outline"
          >
            {isAnalyzing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Analyser
          </Button>
          <Button onClick={handleSave} disabled={!analyzeResult?.valid || isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <Save className="mr-2 h-4 w-4" />
            Enregistrer
          </Button>
        </div>

        {analyzeResult && (
          <div className="space-y-3">
            {analyzeResult.valid ? (
              <Alert className="border-green-500/50 bg-green-50 dark:bg-green-950/30">
                <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                <AlertDescription className="text-green-700 dark:text-green-400">
                  Règles valides
                </AlertDescription>
              </Alert>
            ) : (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertDescription>
                  <ul className="list-disc list-inside">
                    {analyzeResult.errors.map((err, idx) => (
                      <li key={idx}>{err}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {analyzeResult.policy && analyzeResult.policy.type !== "TIMEPOINTS" && (
              <div className="p-3 border rounded-md bg-muted/30">
                <PolicyPreview policy={analyzeResult.policy as DurationBreakPolicy} />
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
