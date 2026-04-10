/**
 * LineStatusBadge — icon-only visual indicator for preparation line status
 */

import { Check, Pencil, XCircle } from "lucide-react";
import type { LineStatus } from "../types";

interface Props {
  status: LineStatus | null;
}

export function LineStatusBadge({ status }: Props) {
  switch (status) {
    case "ok":
      return (
        <div className="h-6 w-6 rounded-full flex items-center justify-center bg-emerald-100 text-emerald-600">
          <Check className="h-3.5 w-3.5" />
        </div>
      );
    case "modifie":
      return (
        <div className="h-6 w-6 rounded-full flex items-center justify-center bg-amber-100 text-amber-600">
          <Pencil className="h-3 w-3" />
        </div>
      );
    case "rupture":
      return (
        <div className="h-6 w-6 rounded-full flex items-center justify-center bg-red-100 text-red-600">
          <XCircle className="h-3.5 w-3.5" />
        </div>
      );
    default:
      return null;
  }
}
