import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { minutesToXhYY } from "@/lib/time/paris";

/**
 * Trigger haptic feedback on mobile devices.
 * Uses navigator.vibrate (Web Vibration API) as a lightweight fallback
 * since @capacitor/haptics is not installed.
 */
function triggerHapticFeedback() {
  try {
    if (navigator.vibrate) {
      navigator.vibrate(200);
    }
  } catch {
    // Silently ignore — vibration may not be available on desktop browsers
  }
}

interface BadgeConfirmationToastProps {
  type: "clock_in" | "clock_out";
  effectiveTime: string;
  onClose: () => void;
  duration?: number;
  lateMinutes?: number | null;
}

export function BadgeConfirmationToast({
  type,
  effectiveTime,
  onClose,
  duration = 2000,
  lateMinutes,
}: BadgeConfirmationToastProps) {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    // PER-EMP-021: Haptic feedback on successful badge event
    triggerHapticFeedback();

    const timer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(onClose, 300); // Wait for fade out
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const isArrival = type === "clock_in";
  const showLate = isArrival && lateMinutes && lateMinutes > 0;

  return (
    <div
      className={cn(
        "fixed inset-0 z-[55] flex items-center justify-center bg-black/50",
        "transition-opacity duration-300",
        isVisible ? "opacity-100" : "opacity-0"
      )}
    >
      <div
        className={cn(
          "bg-card rounded-2xl p-8 shadow-xl mx-6 text-center",
          "transform transition-all duration-300",
          isVisible ? "scale-100" : "scale-95"
        )}
      >
        <div
          className={cn(
            "w-20 h-20 rounded-full mx-auto mb-4 flex items-center justify-center",
            isArrival ? "bg-green-100 dark:bg-green-900/30" : "bg-orange-100 dark:bg-orange-900/30"
          )}
        >
          <Check
            className={cn(
              "h-10 w-10",
              isArrival
                ? "text-green-600 dark:text-green-400"
                : "text-orange-600 dark:text-orange-400"
            )}
          />
        </div>

        <h3 className="text-xl font-semibold mb-2">
          {isArrival ? "Arrivée enregistrée" : "Départ enregistré"}
        </h3>

        <p className="text-3xl font-bold text-primary mb-2">{effectiveTime}</p>

        {showLate && (
          <p className="text-sm font-medium text-destructive mb-2">
            Retard : {minutesToXhYY(lateMinutes)}
          </p>
        )}

        <p className="text-sm text-muted-foreground">Heure prise en compte</p>
      </div>
    </div>
  );
}
