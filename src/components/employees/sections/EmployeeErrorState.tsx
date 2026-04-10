import { ShieldAlert } from "lucide-react";

interface EmployeeErrorStateProps {
  message?: string;
}

export function EmployeeErrorState({ message }: EmployeeErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
      <ShieldAlert className="h-12 w-12 text-destructive" />
      <div>
        <p className="text-lg font-medium text-destructive">Accès interdit</p>
        <p className="text-sm text-muted-foreground">
          {message || "Vous n'êtes pas autorisé à consulter cette fiche."}
        </p>
      </div>
    </div>
  );
}
