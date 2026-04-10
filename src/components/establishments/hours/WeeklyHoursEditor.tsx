import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2, Save } from "lucide-react";
import { DAY_LABELS, DEFAULT_WEEKLY_HOURS, type WeeklyHour } from "./types/establishment-hours.types";
import { useWeeklyHours, useUpdateWeeklyHours } from "./hooks/useEstablishmentHours";

interface WeeklyHoursEditorProps {
  establishmentId: string;
}

export function WeeklyHoursEditor({ establishmentId }: WeeklyHoursEditorProps) {
  const { data: savedHours, isLoading } = useWeeklyHours(establishmentId);
  const updateMutation = useUpdateWeeklyHours(establishmentId);
  const [hours, setHours] = useState<WeeklyHour[]>(DEFAULT_WEEKLY_HOURS);

  useEffect(() => {
    if (savedHours && savedHours.length > 0) {
      // Merge saved hours with defaults to ensure all 7 days exist
      const merged = DEFAULT_WEEKLY_HOURS.map((defaultDay) => {
        const saved = savedHours.find((h) => h.day_of_week === defaultDay.day_of_week);
        return saved || defaultDay;
      });
      setHours(merged);
    }
  }, [savedHours]);

  const handleChange = (dayOfWeek: number, field: keyof WeeklyHour, value: string | boolean) => {
    setHours((prev) =>
      prev.map((h) =>
        h.day_of_week === dayOfWeek
          ? { ...h, [field]: value }
          : h
      )
    );
  };

  const handleToggleClosed = (dayOfWeek: number, closed: boolean) => {
    setHours((prev) =>
      prev.map((h) =>
        h.day_of_week === dayOfWeek
          ? { ...h, closed, open_time: closed ? null : "09:00", close_time: closed ? null : "18:00" }
          : h
      )
    );
  };

  const handleSave = () => {
    updateMutation.mutate(hours);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {hours.map((day) => (
          <div
            key={day.day_of_week}
            className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-lg border bg-card"
          >
            <div className="flex items-center justify-between sm:justify-start gap-3">
              <div className="w-20 font-medium text-sm shrink-0">
                {DAY_LABELS[day.day_of_week]}
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={!day.closed}
                  onCheckedChange={(open) => handleToggleClosed(day.day_of_week, !open)}
                />
                <Label className="text-sm text-muted-foreground w-14">
                  {day.closed ? "Fermé" : "Ouvert"}
                </Label>
              </div>
            </div>

            {!day.closed && (
              <div className="flex items-center gap-2 sm:ml-auto">
                <Label className="text-sm text-muted-foreground">De</Label>
                <Input
                  type="time"
                  value={day.open_time || ""}
                  onChange={(e) => handleChange(day.day_of_week, "open_time", e.target.value)}
                  className="w-24"
                />
                <Label className="text-sm text-muted-foreground">à</Label>
                <Input
                  type="time"
                  value={day.close_time || ""}
                  onChange={(e) => handleChange(day.day_of_week, "close_time", e.target.value)}
                  className="w-24"
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <Button onClick={handleSave} disabled={updateMutation.isPending}>
        {updateMutation.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
        ) : (
          <Save className="h-4 w-4 mr-2" />
        )}
        Enregistrer
      </Button>
    </div>
  );
}
