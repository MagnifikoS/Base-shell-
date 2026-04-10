/**
 * CommandeStatusBadge — visual status indicator with icons for all statuses
 */

import { Badge } from "@/components/ui/badge";
import { Lock, Unlock, FileEdit, Truck, PackageCheck, CheckCircle2, AlertTriangle } from "lucide-react";
import type { CommandeStatus } from "../types";

interface Props {
  status: CommandeStatus;
  isSender: boolean;
}

export function CommandeStatusBadge({ status, isSender }: Props) {
  switch (status) {
    case "brouillon":
      return (
        <Badge variant="outline" className="text-xs flex items-center gap-1">
          <FileEdit className="h-3 w-3" />
          Brouillon
        </Badge>
      );
    case "envoyee":
      return (
        <Badge variant="secondary" className="text-xs flex items-center gap-1">
          <Unlock className="h-3 w-3" />
          Envoyée
        </Badge>
      );
    case "ouverte":
      return (
        <Badge className="text-xs flex items-center gap-1 bg-amber-500 text-white hover:bg-amber-600">
          <Lock className="h-3 w-3" />
          En préparation
        </Badge>
      );
    case "expediee":
      return (
        <Badge className="text-xs flex items-center gap-1 bg-blue-600 text-white hover:bg-blue-700">
          <Truck className="h-3 w-3" />
          Expédiée
        </Badge>
      );
    case "litige":
      return (
        <Badge className="text-xs flex items-center gap-1 bg-amber-500 text-white hover:bg-amber-600">
          <AlertTriangle className="h-3 w-3" />
          Litige
        </Badge>
      );
    case "recue":
      return (
        <Badge className="text-xs flex items-center gap-1 bg-emerald-100 text-emerald-700 hover:bg-emerald-200 border-emerald-200">
          <PackageCheck className="h-3 w-3" />
          Reçue
        </Badge>
      );
    case "cloturee":
      return (
        <Badge className="text-xs flex items-center gap-1 bg-muted text-muted-foreground">
          <CheckCircle2 className="h-3 w-3" />
          Facturée
        </Badge>
      );
    default:
      return null;
  }
}
