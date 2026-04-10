import { HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface HelpTooltipProps {
  text: string;
  className?: string;
}

export function HelpTooltip({ text, className }: HelpTooltipProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <HelpCircle
          className={`h-4 w-4 text-muted-foreground inline-block cursor-help ${className ?? ""}`}
        />
      </TooltipTrigger>
      <TooltipContent>
        <span>{text}</span>
      </TooltipContent>
    </Tooltip>
  );
}
