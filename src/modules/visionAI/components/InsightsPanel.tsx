import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, Info, Tag } from "lucide-react";
import { Insight, ExtractedProductLine } from "../types";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface InsightsPanelProps {
  insights: Insight[];
  items?: ExtractedProductLine[];
}

/**
 * Infos comprises par Vision AI - Collapsible panel
 */
export function InsightsPanel({ insights, items = [] }: InsightsPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  
  // Filter items with category suggestions
  const itemsWithCategories = items.filter(item => item.category_suggestion);
  const hasContent = insights.length > 0 || itemsWithCategories.length > 0;
  
  if (!hasContent) {
    return null;
  }

  const totalCount = insights.length + itemsWithCategories.length;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          className="w-full justify-between px-4 py-3 h-auto text-left hover:bg-muted/50"
        >
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Info className="h-4 w-4" />
            <span>Infos comprises par Vision AI</span>
            <span className="text-xs bg-muted px-1.5 py-0.5 rounded">
              {totalCount}
            </span>
          </div>
          {isOpen ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </Button>
      </CollapsibleTrigger>
      
      <CollapsibleContent>
        <div className="px-4 pb-4 space-y-4">
          {/* Standard insights */}
          {insights.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {insights.map((insight, index) => (
                <div
                  key={index}
                  className="bg-muted/50 rounded-md px-3 py-2 border border-border/50"
                >
                  <div className="text-xs text-muted-foreground">{insight.label}</div>
                  <div className="text-sm">{insight.value}</div>
                </div>
              ))}
            </div>
          )}
          
          {/* Category suggestions */}
          {itemsWithCategories.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Tag className="h-3.5 w-3.5" />
                <span>Catégories suggérées</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {itemsWithCategories.map((item, index) => {
                  const suggestion = item.category_suggestion!;
                  const confidencePercent = Math.round(suggestion.confidence * 100);
                  
                  return (
                    <div
                      key={index}
                      className="bg-muted/30 rounded-md px-3 py-2 flex items-center justify-between gap-2 border border-border/30"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-muted-foreground truncate">
                          {item.nom_produit_complet}
                        </div>
                        <div className="text-sm font-medium">{suggestion.label}</div>
                      </div>
                      <div className="text-xs text-muted-foreground shrink-0">
                        {confidencePercent}%
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
