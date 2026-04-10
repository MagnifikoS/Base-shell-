import { useState, useRef, useCallback, useEffect } from "react";
import { Camera, X, Check, RotateCcw, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CameraArrivalCaptureProps {
  /** Pre-acquired MediaStream (iOS-safe: obtained in user gesture handler) */
  stream: MediaStream;
  onCapture: () => void;
  onCancel: () => void;
  onRetry?: () => void;
  isLoading?: boolean;
}

/**
 * Camera capture component for arrival selfie.
 * iOS-safe: stream is passed as prop (acquired in user gesture handler),
 * NOT requested via getUserMedia in useEffect.
 */
export function CameraArrivalCapture({
  stream,
  onCapture,
  onCancel,
  onRetry,
  isLoading = false,
}: CameraArrivalCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [isCaptured, setIsCaptured] = useState(false);
  const [isVideoReady, setIsVideoReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // iOS-SAFE: Attach stream and call play() IMMEDIATELY after srcObject
  // Do NOT wait for events before calling play() - iOS requires immediate play()
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;

    let isMounted = true;

    // Reset state for new stream
    setIsVideoReady(false);
    setCameraError(null);

    // 1. Attach stream
    video.srcObject = stream;

    // 2. Call play() IMMEDIATELY (iOS requirement - must be in same sync flow)
    const playPromise = video.play();

    if (playPromise !== undefined) {
      playPromise.catch((err) => {
        if (import.meta.env.DEV) console.error("Video play error:", err.name, err.message);
        // Only set error if it's not an abort (which happens on unmount)
        if (isMounted && err.name !== "AbortError") {
          setCameraError(`Impossible d'activer la caméra (${err.name})`);
        }
      });
    }

    // 3. Mark ready when we have actual video dimensions
    const handleVideoReady = () => {
      if (!isMounted) return;
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setIsVideoReady(true);
        setCameraError(null);
      }
    };

    // Listen for video dimension availability
    video.addEventListener("loadedmetadata", handleVideoReady);
    video.addEventListener("canplay", handleVideoReady);
    video.addEventListener("playing", handleVideoReady);

    // Check if already ready (race condition)
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      handleVideoReady();
    }

    // Timeout: if no dimensions after 5s, show error
    const timeout = setTimeout(() => {
      if (isMounted && video.videoWidth === 0) {
        setCameraError("La caméra met trop de temps à répondre");
      }
    }, 5000);

    return () => {
      isMounted = false;
      video.removeEventListener("loadedmetadata", handleVideoReady);
      video.removeEventListener("canplay", handleVideoReady);
      video.removeEventListener("playing", handleVideoReady);
      clearTimeout(timeout);
    };
  }, [stream]);

  // Capture photo
  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    if (!ctx) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Mirror the image for selfie
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0);

    setIsCaptured(true);
  }, []);

  // Retake photo
  const retakePhoto = useCallback(() => {
    setIsCaptured(false);
    // Stream is still active, just show video again
    if (videoRef.current) {
      videoRef.current.play().catch(console.error);
    }
  }, []);

  // Confirm and proceed (photo NOT stored, just validated visually)
  const confirmPhoto = useCallback(() => {
    // Clear canvas data immediately - no storage
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext("2d");
      ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
    onCapture();
  }, [onCapture]);

  // Handle cancel
  const handleCancel = useCallback(() => {
    onCancel();
  }, [onCancel]);

  return (
    <div className="fixed inset-x-0 top-0 h-[100dvh] z-[55] bg-black flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-black/80">
        <Button
          variant="ghost"
          size="icon"
          onClick={handleCancel}
          className="text-white hover:bg-white/20"
          aria-label="Fermer la caméra"
        >
          <X className="h-6 w-6" />
        </Button>
        <h2 className="text-white font-medium">Selfie d'arrivée</h2>
        <div className="w-10" /> {/* Spacer */}
      </div>

      {/* Camera view - VIDEO ALWAYS MOUNTED for iOS compatibility */}
      <div className="flex-1 relative">
        {/* Video preview - ALWAYS in DOM, hidden only when captured */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={cn(
            "absolute inset-0 w-full h-full object-cover",
            "transform scale-x-[-1]", // Mirror for selfie
            isCaptured && "hidden"
          )}
        />

        {/* Canvas for captured image */}
        <canvas
          ref={canvasRef}
          className={cn("absolute inset-0 w-full h-full object-cover", !isCaptured && "hidden")}
        />

        {/* Error overlay (ON TOP of video) */}
        {cameraError && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/90">
            <div className="text-center text-white p-6">
              <AlertCircle className="h-16 w-16 mx-auto mb-4 text-destructive" />
              <p className="mb-4">{cameraError}</p>
              {onRetry && (
                <Button
                  variant="outline"
                  onClick={onRetry}
                  className="bg-transparent border-white text-white hover:bg-white/20"
                  aria-label="Réessayer l'accès caméra"
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Réessayer
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Loading overlay (ON TOP of video, disappears when ready) */}
        {!cameraError && !isVideoReady && !isCaptured && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/80">
            <div className="text-center text-white">
              <Camera className="h-16 w-16 mx-auto mb-4 animate-pulse" />
              <p>Chargement de la caméra...</p>
            </div>
          </div>
        )}

        {/* Face guide overlay (only when video ready and not captured) */}
        {!isCaptured && isVideoReady && !cameraError && (
          <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
            <div className="w-48 h-64 border-2 border-white/50 rounded-full" />
          </div>
        )}
      </div>

      {/* Controls - safe area cumulative padding for iOS */}
      <div className="px-6 pt-6 pb-[calc(24px+env(safe-area-inset-bottom))] bg-black/80">
        {!isCaptured ? (
          <div className="flex justify-center">
            <button
              onClick={capturePhoto}
              disabled={!isVideoReady || isLoading}
              aria-label="Prendre la photo"
              className={cn(
                "w-20 h-20 rounded-full border-4 border-white",
                "bg-white/20 active:bg-white/40 transition-colors",
                "flex items-center justify-center",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              <div className="w-16 h-16 rounded-full bg-white" />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-8">
            <Button
              variant="outline"
              size="lg"
              onClick={retakePhoto}
              disabled={isLoading}
              className="bg-transparent border-white text-white hover:bg-white/20"
              aria-label="Reprendre la photo"
            >
              <RotateCcw className="h-5 w-5 mr-2" />
              Reprendre
            </Button>
            <Button
              size="lg"
              onClick={confirmPhoto}
              disabled={isLoading}
              className="bg-green-600 hover:bg-green-700 text-white"
              aria-label="Valider la photo"
            >
              <Check className="h-5 w-5 mr-2" />
              Valider
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
