import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Calculator } from "lucide-react";
import type { TestResult } from "./types/breakPolicy.types";

interface BreakRuleTestPanelProps {
  inputText: string;
  onTest: (shiftMinutes: number) => Promise<TestResult>;
  isTesting: boolean;
}

function parseShiftInput(input: string): number | null {
  // Accept formats: "6h30", "6h", "6:30", "390" (minutes)
  const trimmed = input.trim().toLowerCase();

  // Format: 6h30 or 6h
  const hMatch = trimmed.match(/^(\d+)h(\d+)?$/);
  if (hMatch) {
    const hours = parseInt(hMatch[1], 10);
    const minutes = hMatch[2] ? parseInt(hMatch[2], 10) : 0;
    return hours * 60 + minutes;
  }

  // Format: 6:30
  const colonMatch = trimmed.match(/^(\d+):(\d+)$/);
  if (colonMatch) {
    const hours = parseInt(colonMatch[1], 10);
    const minutes = parseInt(colonMatch[2], 10);
    return hours * 60 + minutes;
  }

  // Pure number = minutes
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10);
  }

  return null;
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h${m.toString().padStart(2, "0")}`;
}

export function BreakRuleTestPanel({
  inputText,
  onTest,
  isTesting,
}: BreakRuleTestPanelProps) {
  const [shiftInput, setShiftInput] = useState("");
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleTest = async () => {
    setError(null);
    setResult(null);

    if (!inputText.trim()) {
      setError("Veuillez d'abord saisir des règles ci-dessus");
      return;
    }

    const minutes = parseShiftInput(shiftInput);
    if (minutes === null || minutes < 0) {
      setError("Format invalide. Ex: 6h30, 8h, 5:30, ou 360 (minutes)");
      return;
    }

    try {
      const res = await onTest(minutes);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de test");
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Calculator className="h-4 w-4" />
          Test rapide
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            placeholder="Durée shift (ex: 6h30)"
            value={shiftInput}
            onChange={(e) => {
              setShiftInput(e.target.value);
              setResult(null);
              setError(null);
            }}
            className="flex-1"
          />
          <Button
            onClick={handleTest}
            disabled={!shiftInput.trim() || isTesting}
            variant="outline"
          >
            {isTesting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Tester
          </Button>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {result && (
          <div className="p-3 border rounded-md bg-muted/30 text-sm space-y-1">
            <div>
              <span className="text-muted-foreground">Pause:</span>{" "}
              <span className="font-medium">{result.breakMinutes} min</span>
            </div>
            <div>
              <span className="text-muted-foreground">Net:</span>{" "}
              <span className="font-medium">{formatMinutes(result.netMinutes)}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
