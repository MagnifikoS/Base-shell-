/**
 * Branded splash screen shown during initial app loading.
 * Replaces the generic white spinner for better perceived performance.
 *
 * PERF: No external dependencies, minimal CSS, renders instantly.
 */
export function SplashScreen() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4">
      {/* App branding */}
      <div className="flex flex-col items-center gap-2 animate-in fade-in duration-300">
        <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center">
          <span className="text-primary-foreground font-bold text-xl">R</span>
        </div>
        <span className="text-lg font-semibold text-foreground tracking-tight">
          Restaurant OS
        </span>
      </div>

      {/* Subtle loading indicator */}
      <div className="flex gap-1.5 mt-2">
        <div
          className="w-2 h-2 rounded-full bg-primary/60 animate-bounce"
          style={{ animationDelay: "0ms" }}
        />
        <div
          className="w-2 h-2 rounded-full bg-primary/60 animate-bounce"
          style={{ animationDelay: "150ms" }}
        />
        <div
          className="w-2 h-2 rounded-full bg-primary/60 animate-bounce"
          style={{ animationDelay: "300ms" }}
        />
      </div>
    </div>
  );
}
