import { useState, useEffect } from "react";

/**
 * OfflineBanner — Affiche un bandeau fixe quand l'appareil perd la connexion Internet.
 *
 * FIA-06 / I-020: Uses navigator.onLine + event listeners for real-time detection.
 */
function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const handleOffline = () => setIsOffline(true);
    const handleOnline = () => setIsOffline(false);

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div
      role="alert"
      className="fixed top-0 left-0 right-0 z-[9999] bg-amber-500 dark:bg-amber-600 text-amber-950 dark:text-amber-50 text-center py-2 px-4 text-sm font-medium shadow-md"
    >
      Pas de connexion Internet
    </div>
  );
}

export { OfflineBanner };
