/**
 * Dialog to redeem a B2B invitation code (client/restaurant side)
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRedeemCode } from "../hooks/useRedeemCode";
import { Handshake, Loader2 } from "lucide-react";

export function RedeemCodeDialog() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const redeemCode = useRedeemCode();

  const handleRedeem = async () => {
    if (!code.trim()) return;
    const result = await redeemCode.mutateAsync(code);
    if (result.ok) {
      setOpen(false);
      setCode("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Handshake className="h-4 w-4 mr-2" />
          Ajouter un fournisseur partenaire
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rejoindre un fournisseur partenaire</DialogTitle>
          <DialogDescription>
            Saisissez le code d'invitation fourni par votre fournisseur.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <Input
            placeholder="Ex: ABCD1234"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            className="text-center text-lg font-mono tracking-widest"
            maxLength={8}
          />
          <Button
            className="w-full"
            onClick={handleRedeem}
            disabled={code.trim().length < 8 || redeemCode.isPending}
          >
            {redeemCode.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Valider le code
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
