import { useState } from "react";
import { useBreakPolicies } from "./hooks/useBreakPolicies";
import { useBreakPolicyMutations } from "./hooks/useBreakPolicyMutations";
import { BreakRuleEditor } from "./BreakRuleEditor";
import { BreakRuleList } from "./BreakRuleList";
import { BreakRuleTestPanel } from "./BreakRuleTestPanel";
import { TimepointRuleEditor } from "./TimepointRuleEditor";
import { Separator } from "@/components/ui/separator";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, Clock, Timer } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TimepointBreakPolicy } from "./types/breakPolicy.types";

interface BreakRulesTabProps {
  establishmentId: string;
}

type RuleType = "DURATION" | "TIMEPOINTS";

export function BreakRulesTab({ establishmentId }: BreakRulesTabProps) {
  const [editorText, setEditorText] = useState("");
  const [selectedType, setSelectedType] = useState<RuleType>("DURATION");

  const { data: policies, isLoading } = useBreakPolicies(establishmentId);
  const mutations = useBreakPolicyMutations(establishmentId);

  const handleAnalyze = async (text: string) => {
    setEditorText(text);
    return await mutations.analyze.mutateAsync(text);
  };

  const handleSaveDuration = async (text: string) => {
    await mutations.create.mutateAsync({ inputText: text, type: "DURATION" });
    setEditorText("");
  };

  const handleSaveTimepoint = async (policy: TimepointBreakPolicy, inputText: string) => {
    await mutations.createTimepoint.mutateAsync({ policy, inputText });
  };

  const handleTest = async (shiftMinutes: number) => {
    return await mutations.test.mutateAsync({
      inputText: editorText,
      shiftMinutes,
    });
  };

  return (
    <div className="space-y-6 pb-6">
      {/* Type selector */}
      <div>
        <h3 className="text-sm font-medium mb-3">Type de règle</h3>
        <RadioGroup
          value={selectedType}
          onValueChange={(v) => setSelectedType(v as RuleType)}
          className="flex gap-4"
        >
          <div
            className={cn(
              "flex items-center gap-2 p-3 border rounded-lg cursor-pointer transition-colors",
              selectedType === "DURATION"
                ? "border-primary bg-primary/5"
                : "border-border hover:border-muted-foreground/50"
            )}
            onClick={() => setSelectedType("DURATION")}
          >
            <RadioGroupItem value="DURATION" id="duration" />
            <Label htmlFor="duration" className="cursor-pointer flex items-center gap-2">
              <Timer className="h-4 w-4" />
              Durée du shift
            </Label>
          </div>
          <div
            className={cn(
              "flex items-center gap-2 p-3 border rounded-lg cursor-pointer transition-colors",
              selectedType === "TIMEPOINTS"
                ? "border-primary bg-primary/5"
                : "border-border hover:border-muted-foreground/50"
            )}
            onClick={() => setSelectedType("TIMEPOINTS")}
          >
            <RadioGroupItem value="TIMEPOINTS" id="timepoints" />
            <Label htmlFor="timepoints" className="cursor-pointer flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Heure(s) de pause
            </Label>
          </div>
        </RadioGroup>
      </div>

      {/* Duration panel */}
      <Collapsible open={selectedType === "DURATION"}>
        <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium w-full text-left">
          <ChevronDown
            className={cn(
              "h-4 w-4 transition-transform",
              selectedType !== "DURATION" && "-rotate-90"
            )}
          />
          Règle par durée du shift
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3 space-y-4">
          <p className="text-xs text-muted-foreground">
            Décrivez vos règles de pause en français, puis analysez et enregistrez.
          </p>
          <BreakRuleEditor
            onAnalyze={handleAnalyze}
            onSave={handleSaveDuration}
            isAnalyzing={mutations.analyze.isPending}
            isSaving={mutations.create.isPending}
          />
          <BreakRuleTestPanel
            inputText={editorText}
            onTest={handleTest}
            isTesting={mutations.test.isPending}
          />
        </CollapsibleContent>
      </Collapsible>

      {/* Timepoints panel */}
      <Collapsible open={selectedType === "TIMEPOINTS"}>
        <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium w-full text-left">
          <ChevronDown
            className={cn(
              "h-4 w-4 transition-transform",
              selectedType !== "TIMEPOINTS" && "-rotate-90"
            )}
          />
          Règle par heure(s) de pause
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">
          <TimepointRuleEditor
            onSave={handleSaveTimepoint}
            isSaving={mutations.createTimepoint.isPending}
          />
        </CollapsibleContent>
      </Collapsible>

      <Separator />

      <div>
        <h3 className="text-sm font-medium mb-3">Règles enregistrées</h3>
        <BreakRuleList
          policies={policies || []}
          isLoading={isLoading}
          onActivate={(id) => mutations.activate.mutate(id)}
          onDeactivate={(id) => mutations.deactivate.mutate(id)}
          onDelete={(id) => mutations.delete.mutate(id)}
          isActivating={mutations.activate.isPending}
          isDeactivating={mutations.deactivate.isPending}
          isDeleting={mutations.delete.isPending}
        />
      </div>
    </div>
  );
}
