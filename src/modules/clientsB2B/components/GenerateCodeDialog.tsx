/**
 * Dialog to generate a B2B invitation code (supplier side)
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
import { useGenerateCode } from "../hooks/useGenerateCode";
import { Plus, Copy, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { B2BInvitationCode } from "../services/b2bPartnershipService";

export function GenerateCodeDialog() {
  const [open, setOpen] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<B2BInvitationCode | null>(null);
  const [copied, setCopied] = useState(false);
  const generateCode = useGenerateCode();

  const handleGenerate = async () => {
    const result = await generateCode.mutateAsync();
    setGeneratedCode(result);
  };

  const handleCopy = () => {
    if (generatedCode) {
      navigator.clipboard.writeText(generatedCode.code);
      setCopied(true);
      toast.success("Code copié !");
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleClose = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      setGeneratedCode(null);
      setCopied(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Générer un code
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Code d'invitation B2B</DialogTitle>
          <DialogDescription>
            Partagez ce code avec votre client pour établir le partenariat. Il expire dans 48h.
          </DialogDescription>
        </DialogHeader>

        {!generatedCode ? (
          <div className="flex justify-center py-6">
            <Button onClick={handleGenerate} disabled={generateCode.isPending} size="lg">
              {generateCode.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Générer le code
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-center gap-3 p-6 bg-muted rounded-xl">
              <span className="text-3xl font-mono font-bold tracking-widest">
                {generatedCode.code}
              </span>
              <Button variant="ghost" size="icon" onClick={handleCopy}>
                {copied ? (
                  <Check className="h-5 w-5 text-primary" />
                ) : (
                  <Copy className="h-5 w-5" />
                )}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground text-center">
              Expire le{" "}
              {new Date(generatedCode.expires_at).toLocaleDateString("fr-FR", {
                day: "numeric",
                month: "long",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
