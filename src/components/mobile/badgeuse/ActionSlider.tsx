import { useState, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import { ChevronRight, Loader2 } from "lucide-react";

interface ActionSliderProps {
  onComplete: () => void;
  label: string;
  sublabel?: string;
  disabled?: boolean;
  isLoading?: boolean;
  variant?: "arrival" | "departure";
}

export function ActionSlider({
  onComplete,
  label,
  sublabel,
  disabled = false,
  isLoading = false,
  variant = "arrival",
}: ActionSliderProps) {
  const [progress, setProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const THRESHOLD = 0.85;

  const getProgress = useCallback((clientX: number): number => {
    if (!containerRef.current) return 0;
    const rect = containerRef.current.getBoundingClientRect();
    const thumbWidth = 56;
    const maxTravel = rect.width - thumbWidth - 8;
    const traveled = clientX - rect.left - thumbWidth / 2 - 4;
    return Math.max(0, Math.min(1, traveled / maxTravel));
  }, []);

  const handleStart = useCallback(
    (clientX: number) => {
      if (disabled || isLoading) return;
      startXRef.current = clientX;
      setIsDragging(true);
    },
    [disabled, isLoading]
  );

  const handleMove = useCallback(
    (clientX: number) => {
      if (!isDragging) return;
      const newProgress = getProgress(clientX);
      setProgress(newProgress);
    },
    [isDragging, getProgress]
  );

  const handleEnd = useCallback(() => {
    if (!isDragging) return;
    setIsDragging(false);

    if (progress >= THRESHOLD) {
      setProgress(1);
      onComplete();
    } else {
      setProgress(0);
    }
  }, [isDragging, progress, onComplete]);

  const handleTouchStart = (e: React.TouchEvent) => {
    handleStart(e.touches[0].clientX);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    handleMove(e.touches[0].clientX);
  };

  const handleTouchEnd = () => {
    handleEnd();
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    handleStart(e.clientX);
    e.preventDefault();
  };

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      handleMove(e.clientX);
    },
    [handleMove]
  );

  const handleMouseUp = useCallback(() => {
    handleEnd();
  }, [handleEnd]);

  const handleThumbMouseDown = (e: React.MouseEvent) => {
    handleMouseDown(e);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", () => {
      handleMouseUp();
      window.removeEventListener("mousemove", handleMouseMove);
    }, { once: true });
  };

  // Design system colors
  const isArrival = variant === "arrival";
  
  return (
    <div className="w-full px-4">
      {/* Track container */}
      <div
        ref={containerRef}
        className={cn(
          "relative h-14 rounded-2xl overflow-hidden",
          "bg-muted/60 dark:bg-muted/40",
          "border border-border/50",
          "shadow-sm",
          disabled && "opacity-40 cursor-not-allowed"
        )}
      >
        {/* Progress fill - subtle gradient */}
        <div
          className={cn(
            "absolute inset-y-0 left-0 rounded-2xl",
            isArrival 
              ? "bg-gradient-to-r from-emerald-500/20 to-emerald-500/40 dark:from-emerald-600/20 dark:to-emerald-600/40" 
              : "bg-gradient-to-r from-amber-500/20 to-amber-500/40 dark:from-amber-600/20 dark:to-amber-600/40"
          )}
          style={{ 
            width: `${progress * 100}%`,
            transition: isDragging ? 'none' : 'width 0.4s cubic-bezier(0.32, 0.72, 0, 1)'
          }}
        />

        {/* Label - centered with smooth fade */}
        <div
          className={cn(
            "absolute inset-0 flex items-center justify-center pl-14",
            "pointer-events-none select-none"
          )}
          style={{
            opacity: Math.max(0, 1 - progress * 2.5),
            transition: isDragging ? 'none' : 'opacity 0.3s ease-out'
          }}
        >
          <div className="text-center">
            <p className="font-medium text-sm text-foreground/90">{label}</p>
            {sublabel && (
              <p className="text-xs text-muted-foreground mt-0.5">{sublabel}</p>
            )}
          </div>
        </div>

        {/* Chevron hints - subtle animated arrows */}
        <div 
          className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-0.5 pointer-events-none"
          style={{
            opacity: Math.max(0, 0.4 - progress * 1.5),
            transition: isDragging ? 'none' : 'opacity 0.3s ease-out'
          }}
        >
          <ChevronRight className="h-4 w-4 text-muted-foreground/50 animate-pulse" style={{ animationDelay: '0ms' }} />
          <ChevronRight className="h-4 w-4 text-muted-foreground/40 animate-pulse" style={{ animationDelay: '150ms' }} />
          <ChevronRight className="h-4 w-4 text-muted-foreground/30 animate-pulse" style={{ animationDelay: '300ms' }} />
        </div>

        {/* Thumb - clean minimal design */}
        <div
          className={cn(
            "absolute top-1 bottom-1 left-1 w-12 rounded-xl",
            "flex items-center justify-center",
            isArrival
              ? "bg-emerald-500 dark:bg-emerald-600"
              : "bg-amber-500 dark:bg-amber-600",
            "text-white",
            "shadow-md",
            "cursor-grab active:cursor-grabbing",
            "touch-manipulation select-none",
            isDragging && "shadow-lg scale-[1.02]"
          )}
          style={{
            transform: `translateX(${progress * ((containerRef.current?.offsetWidth || 200) - 56 - 8)}px)${isDragging ? ' scale(1.02)' : ''}`,
            transition: isDragging ? 'box-shadow 0.15s ease-out' : 'transform 0.4s cubic-bezier(0.32, 0.72, 0, 1), box-shadow 0.15s ease-out'
          }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onMouseDown={handleThumbMouseDown}
        >
          {isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <ChevronRight className="h-5 w-5" />
          )}
        </div>
      </div>
    </div>
  );
}
