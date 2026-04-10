import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { useExceptions, useAddException, useRemoveException } from "./hooks/useEstablishmentHours";
import type { OpeningException } from "./types/establishment-hours.types";
import { openingExceptionSchema } from "@/lib/schemas/settings";
import type { ZodError } from "zod";

interface ExceptionsListProps {
  establishmentId: string;
}

export function ExceptionsList({ establishmentId }: ExceptionsListProps) {
  const { data: exceptions, isLoading } = useExceptions(establishmentId);
  const addMutation = useAddException(establishmentId);
  const removeMutation = useRemoveException(establishmentId);

  const [newException, setNewException] = useState<Omit<OpeningException, "id">>({
    date: "",
    open_time: "09:00",
    close_time: "18:00",
    closed: false,
    reason: "",
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handleAdd = () => {
    setFieldErrors({});
    const result = openingExceptionSchema.safeParse(newException);
    if (!result.success) {
      const errors: Record<string, string> = {};
      (result.error as ZodError).issues.forEach((issue) => {
        const field = issue.path.join(".");
        if (!errors[field]) errors[field] = issue.message;
      });
      setFieldErrors(errors);
      return;
    }
    addMutation.mutate(newException, {
      onSuccess: () => {
        setNewException({
          date: "",
          open_time: "09:00",
          close_time: "18:00",
          closed: false,
          reason: "",
        });
      },
    });
  };

  const handleRemove = (id: string) => {
    removeMutation.mutate(id);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Add new exception form */}
      <div className="p-4 rounded-lg border bg-card space-y-4">
        <h4 className="font-medium">Ajouter une exception</h4>
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <Label className="text-sm">Date</Label>
            <Input
              type="date"
              aria-label="Date de l'exception"
              value={newException.date}
              onChange={(e) => {
                setNewException((prev) => ({ ...prev, date: e.target.value }));
                setFieldErrors((prev) => {
                  const n = { ...prev };
                  delete n.date;
                  return n;
                });
              }}
              className={fieldErrors.date ? "w-40 border-destructive" : "w-40"}
            />
            {fieldErrors.date && (
              <p className="text-sm text-destructive mt-1">{fieldErrors.date}</p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Switch
              aria-label="Jour ouvert ou fermé"
              checked={!newException.closed}
              onCheckedChange={(open) =>
                setNewException((prev) => ({
                  ...prev,
                  closed: !open,
                  open_time: open ? "09:00" : null,
                  close_time: open ? "18:00" : null,
                }))
              }
            />
            <Label className="text-sm text-muted-foreground">
              {newException.closed ? "Fermé" : "Ouvert"}
            </Label>
          </div>

          {!newException.closed && (
            <>
              <div className="space-y-1">
                <Label className="text-sm">De</Label>
                <Input
                  type="time"
                  aria-label="Heure d'ouverture"
                  value={newException.open_time || ""}
                  onChange={(e) =>
                    setNewException((prev) => ({ ...prev, open_time: e.target.value }))
                  }
                  className="w-28"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-sm">à</Label>
                <Input
                  type="time"
                  aria-label="Heure de fermeture"
                  value={newException.close_time || ""}
                  onChange={(e) =>
                    setNewException((prev) => ({ ...prev, close_time: e.target.value }))
                  }
                  className="w-28"
                />
              </div>
            </>
          )}

          <div className="space-y-1 flex-1 min-w-48">
            <Label className="text-sm">Raison (optionnel)</Label>
            <Input
              value={newException.reason || ""}
              onChange={(e) => setNewException((prev) => ({ ...prev, reason: e.target.value }))}
              placeholder="Jour férié, fermeture exceptionnelle..."
            />
          </div>

          <Button
            onClick={handleAdd}
            disabled={!newException.date || addMutation.isPending}
            aria-label="Ajouter une exception"
          >
            {addMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
          </Button>
        </div>
        {fieldErrors.open_time && (
          <p className="text-sm text-destructive">{fieldErrors.open_time}</p>
        )}
      </div>

      {/* List of exceptions */}
      <div className="space-y-2">
        {exceptions?.length === 0 && (
          <p className="text-sm text-muted-foreground py-4 text-center">
            Aucune exception configurée
          </p>
        )}
        {exceptions?.map((exc) => (
          <div
            key={exc.id}
            className="flex items-center justify-between p-3 rounded-lg border bg-card"
          >
            <div className="flex items-center gap-4">
              <div className="font-medium">
                {format(new Date(exc.date), "EEEE d MMMM yyyy", { locale: fr })}
              </div>
              <span className="text-sm text-muted-foreground">
                {exc.closed
                  ? "Fermé"
                  : `${exc.open_time?.slice(0, 5)} - ${exc.close_time?.slice(0, 5)}`}
              </span>
              {exc.reason && (
                <span className="text-sm text-muted-foreground italic">({exc.reason})</span>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleRemove(exc.id)}
              disabled={removeMutation.isPending}
              aria-label="Supprimer l'exception"
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
