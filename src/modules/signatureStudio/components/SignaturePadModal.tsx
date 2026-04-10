import { useRef, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Eraser, Check, X } from "lucide-react";

interface SignaturePadModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (pngDataUrl: string) => void;
  title: string;
  type: "paraphe" | "signature";
}

export function SignaturePadModal({ open, onClose, onSave, title, type }: SignaturePadModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasContent, setHasContent] = useState(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  // Canvas size based on type
  const canvasWidth = type === "paraphe" ? 200 : 400;
  const canvasHeight = type === "paraphe" ? 100 : 150;

  useEffect(() => {
    if (open && canvasRef.current) {
      const ctx = canvasRef.current.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "transparent";
        ctx.clearRect(0, 0, canvasWidth, canvasHeight);
        setHasContent(false);
      }
    }
  }, [open, canvasWidth, canvasHeight]);

  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    if ("touches" in e) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setIsDrawing(true);
    lastPos.current = getPos(e);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing || !canvasRef.current || !lastPos.current) return;
    e.preventDefault();

    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;

    const pos = getPos(e);

    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = "#1a1a2e";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();

    lastPos.current = pos;
    setHasContent(true);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    lastPos.current = null;
  };

  const clearCanvas = () => {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, canvasWidth, canvasHeight);
      setHasContent(false);
    }
  };

  const handleSave = () => {
    if (!canvasRef.current || !hasContent) return;
    const dataUrl = canvasRef.current.toDataURL("image/png");
    onSave(dataUrl);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-4">
          <div className="border-2 border-dashed border-muted-foreground/30 rounded-lg p-2 bg-white">
            <canvas
              ref={canvasRef}
              width={canvasWidth}
              height={canvasHeight}
              className="touch-none cursor-crosshair"
              style={{ width: canvasWidth, height: canvasHeight }}
              onMouseDown={startDrawing}
              onMouseMove={draw}
              onMouseUp={stopDrawing}
              onMouseLeave={stopDrawing}
              onTouchStart={startDrawing}
              onTouchMove={draw}
              onTouchEnd={stopDrawing}
            />
          </div>

          <p className="text-sm text-muted-foreground">
            Dessinez votre {type === "paraphe" ? "paraphe" : "signature"} ci-dessus
          </p>
        </div>

        <DialogFooter className="flex gap-2">
          <Button variant="outline" onClick={clearCanvas}>
            <Eraser className="h-4 w-4 mr-2" />
            Effacer
          </Button>
          <Button variant="outline" onClick={onClose}>
            <X className="h-4 w-4 mr-2" />
            Annuler
          </Button>
          <Button onClick={handleSave} disabled={!hasContent}>
            <Check className="h-4 w-4 mr-2" />
            Valider
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
