import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Save } from "lucide-react";
import { useDayParts, useUpsertDayParts } from "./hooks/useDayParts";
import { 
  DayPart, 
  DAY_PART_LABELS, 
  DAY_PART_COLORS, 
  DEFAULT_DAY_PARTS 
} from "./types/establishment-hours.types";

interface DayPartsEditorProps {
  establishmentId: string;
}

export function DayPartsEditor({ establishmentId }: DayPartsEditorProps) {
  const { data: existingParts, isLoading } = useDayParts(establishmentId);
  const upsertMutation = useUpsertDayParts(establishmentId);
  
  const [localParts, setLocalParts] = useState<Omit<DayPart, "id">[]>(DEFAULT_DAY_PARTS);
  const [hasChanges, setHasChanges] = useState(false);

  // Initialize from existing data or defaults
  useEffect(() => {
    if (existingParts && existingParts.length > 0) {
      const merged = DEFAULT_DAY_PARTS.map(defaultPart => {
        const existing = existingParts.find(p => p.part === defaultPart.part);
        if (existing) {
          return {
            part: existing.part,
            start_time: existing.start_time,
            end_time: existing.end_time,
            color: existing.color,
          };
        }
        return defaultPart;
      });
      setLocalParts(merged);
    }
  }, [existingParts]);

  const updatePart = (
    partKey: "morning" | "midday" | "evening", 
    field: "start_time" | "end_time" | "color", 
    value: string
  ) => {
    setLocalParts(prev => 
      prev.map(p => p.part === partKey ? { ...p, [field]: value } : p)
    );
    setHasChanges(true);
  };

  const handleSave = () => {
    upsertMutation.mutate(localParts, {
      onSuccess: () => setHasChanges(false),
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {(["morning", "midday", "evening"] as const).map((partKey) => {
          const part = localParts.find(p => p.part === partKey) || DEFAULT_DAY_PARTS.find(p => p.part === partKey)!;
          
          return (
            <div 
              key={partKey} 
              className="flex items-center gap-3 p-3 border border-border rounded-lg bg-card"
            >
              {/* Color preview chip */}
              <div 
                className="w-4 h-4 rounded-full shrink-0 ring-1 ring-border"
                style={{ backgroundColor: part.color }}
              />
              
              {/* Label */}
              <div className="w-20 shrink-0">
                <span className="text-sm font-medium">{DAY_PART_LABELS[partKey]}</span>
              </div>
              
              {/* Start time */}
              <div className="flex items-center gap-1.5">
                <Label className="text-xs text-muted-foreground">De</Label>
                <Input
                  type="time"
                  value={part.start_time}
                  onChange={(e) => updatePart(partKey, "start_time", e.target.value)}
                  className="w-24 h-8 text-sm"
                />
              </div>
              
              {/* End time */}
              <div className="flex items-center gap-1.5">
                <Label className="text-xs text-muted-foreground">à</Label>
                <Input
                  type="time"
                  value={part.end_time}
                  onChange={(e) => updatePart(partKey, "end_time", e.target.value)}
                  className="w-24 h-8 text-sm"
                />
              </div>
              
              {/* Color picker */}
              <div className="flex items-center gap-1.5 ml-auto">
                <Label className="text-xs text-muted-foreground">Couleur</Label>
                <div className="flex gap-1">
                  {DAY_PART_COLORS.slice(0, 6).map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => updatePart(partKey, "color", color)}
                      className={`w-5 h-5 rounded-full ring-1 transition-all ${
                        part.color === color 
                          ? "ring-2 ring-primary ring-offset-1" 
                          : "ring-border hover:ring-primary/50"
                      }`}
                      style={{ backgroundColor: color }}
                      title={color}
                    />
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      
      {/* More colors expandable */}
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          Plus de couleurs
        </summary>
        <div className="mt-2 flex flex-wrap gap-1.5 p-2 border border-border rounded-lg bg-muted/30">
          {DAY_PART_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => {
                // Apply to first part that can use this color (as a helper)
              }}
              className="w-6 h-6 rounded-full ring-1 ring-border hover:ring-primary transition-all"
              style={{ backgroundColor: color }}
              title={color}
            />
          ))}
        </div>
      </details>
      
      {/* Save button */}
      <div className="flex justify-end pt-2">
        <Button 
          onClick={handleSave} 
          disabled={upsertMutation.isPending || !hasChanges}
          size="sm"
        >
          {upsertMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Enregistrer
        </Button>
      </div>
    </div>
  );
}
