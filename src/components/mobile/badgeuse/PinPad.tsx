import { useState, useCallback, useEffect } from "react";
import { Delete, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PinPadProps {
  onSubmit: (pin: string) => void;
  onCancel: () => void;
  isLoading?: boolean;
  error?: string | null;
  mode?: "enter" | "create" | "confirm";
  title?: string;
}

export function PinPad({
  onSubmit,
  onCancel,
  isLoading = false,
  error = null,
  mode = "enter",
  title,
}: PinPadProps) {
  const [pin, setPin] = useState("");
  const [shake, setShake] = useState(false);

  const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];

  const handleDigit = useCallback(
    (digit: string) => {
      if (isLoading) return;

      if (digit === "del") {
        setPin((prev) => prev.slice(0, -1));
        return;
      }

      if (digit === "") return;

      if (pin.length < 4) {
        const newPin = pin + digit;
        setPin(newPin);

        // Auto-submit when 4 digits
        if (newPin.length === 4) {
          onSubmit(newPin);
        }
      }
    },
    [pin, isLoading, onSubmit]
  );

  // A11Y-05: Global keyboard handler for PIN entry
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isLoading) return;

      if (e.key >= "0" && e.key <= "9") {
        handleDigit(e.key);
      } else if (e.key === "Backspace") {
        handleDigit("del");
      } else if (e.key === "Enter" && pin.length === 4) {
        onSubmit(pin);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleDigit, isLoading, onSubmit, pin]);

  // Shake animation on error
  useEffect(() => {
    if (error) {
      setShake(true);
      setPin("");
      const timer = setTimeout(() => setShake(false), 500);
      return () => clearTimeout(timer);
    }
  }, [error]);

  const getTitle = () => {
    if (title) return title;
    switch (mode) {
      case "create":
        return "Créez votre code PIN";
      case "confirm":
        return "Confirmez votre code PIN";
      default:
        return "Entrez votre code PIN";
    }
  };

  return (
    <div className="fixed inset-0 z-[55] bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={onCancel}
          disabled={isLoading}
          aria-label="Fermer"
        >
          <X className="h-6 w-6" />
        </Button>
        <h2 className="font-medium">{getTitle()}</h2>
        <div className="w-10" />
      </div>

      {/* PIN display */}
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        <div
          role="status"
          aria-label={`${pin.length} chiffre${pin.length > 1 ? "s" : ""} saisi${pin.length > 1 ? "s" : ""} sur 4`}
          className={cn("flex gap-4 mb-8", shake && "animate-[shake_0.5s_ease-in-out]")}
        >
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={cn(
                "w-4 h-4 rounded-full border-2 transition-all",
                pin.length > i ? "bg-primary border-primary" : "border-muted-foreground"
              )}
            />
          ))}
        </div>

        {error && <p className="text-destructive text-sm mb-4 text-center">{error}</p>}

        {mode === "create" && (
          <p className="text-muted-foreground text-sm mb-6 text-center">
            Ce code sera requis pour badger
          </p>
        )}
      </div>

      {/* Keypad */}
      <div className="p-6 safe-area-bottom">
        <div
          role="group"
          aria-label="Clavier PIN"
          className="grid grid-cols-3 gap-4 max-w-xs mx-auto"
        >
          {DIGITS.map((digit, i) => (
            <button
              key={i}
              onClick={() => handleDigit(digit)}
              disabled={isLoading || (digit === "" && true)}
              aria-label={
                digit === "del"
                  ? "Supprimer le dernier chiffre"
                  : digit === ""
                    ? undefined
                    : `Chiffre ${digit}`
              }
              className={cn(
                "h-16 rounded-full text-2xl font-medium transition-all",
                "active:scale-95 touch-manipulation",
                digit === ""
                  ? "invisible"
                  : digit === "del"
                    ? "bg-muted hover:bg-muted/80 flex items-center justify-center"
                    : "bg-muted hover:bg-muted/80",
                isLoading && "opacity-50 cursor-not-allowed"
              )}
            >
              {digit === "del" ? <Delete className="h-6 w-6" /> : digit}
            </button>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
          20%, 40%, 60%, 80% { transform: translateX(5px); }
        }
      `}</style>
    </div>
  );
}
