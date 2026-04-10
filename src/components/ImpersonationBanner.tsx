/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ImpersonationBanner — Bandeau rouge permanent pendant impersonation
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Affiché dans AppLayout quand une session d'impersonation est active.
 * Toujours visible + bouton "Quitter" accessible.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { ShieldAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useImpersonation } from "@/hooks/useImpersonation";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

export function ImpersonationBanner() {
  const { isImpersonating, session, stopImpersonation, isStopping } = useImpersonation();
  const navigate = useNavigate();

  if (!isImpersonating || !session) return null;

  const handleStop = async () => {
    try {
      await stopImpersonation();
      toast.success("Impersonation terminée");
      navigate("/platform");
    } catch (err) {
      toast.error("Erreur lors de l'arrêt de l'impersonation");
    }
  };

  return (
    <div
      className="flex items-center justify-between gap-3 px-4 py-2 text-sm font-medium shrink-0"
      style={{
        backgroundColor: "hsl(0 72% 51% / 0.15)",
        color: "hsl(0 72% 40%)",
        borderBottom: "2px solid hsl(0 72% 51% / 0.3)",
      }}
    >
      <div className="flex items-center gap-2">
        <ShieldAlert className="w-4 h-4 shrink-0" />
        <span>
          MODE SUPER ADMIN — Impersonation active
          {session.target_role_name && (
            <span className="opacity-70"> (Rôle : {session.target_role_name})</span>
          )}
        </span>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 border-red-300 text-red-700 hover:bg-red-50 shrink-0"
        onClick={handleStop}
        disabled={isStopping}
      >
        <X className="w-3.5 h-3.5" />
        Quitter impersonation
      </Button>
    </div>
  );
}
