import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BENCH_MODELS } from "../constants";

interface BenchModelSelectorProps {
  value: string;
  onChange: (modelId: string) => void;
  disabled?: boolean;
}

const tierLabel = { light: "L", standard: "S", premium: "P" } as const;
const tierColor = {
  light: "text-green-600 dark:text-green-400",
  standard: "text-blue-600 dark:text-blue-400",
  premium: "text-purple-600 dark:text-purple-400",
} as const;

export function BenchModelSelector({ value, onChange, disabled }: BenchModelSelectorProps) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="w-[280px]">
        <SelectValue placeholder="Choisir un modèle" />
      </SelectTrigger>
      <SelectContent>
        {BENCH_MODELS.map((model) => (
          <SelectItem key={model.id} value={model.id}>
            <span className="flex items-center gap-2">
              <span className={`text-[10px] font-bold ${tierColor[model.tier]}`}>
                {tierLabel[model.tier]}
              </span>
              <span>{model.label}</span>
              <span className="text-[10px] text-muted-foreground">
                ${model.pricingPer1M.input}/{model.pricingPer1M.output}
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
