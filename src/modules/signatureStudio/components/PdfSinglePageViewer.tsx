import { useEffect, useRef } from 'react';

interface PdfSinglePageViewerProps {
  canvas: HTMLCanvasElement | null;
  zoom: number;
  children?: React.ReactNode;
}

export function PdfSinglePageViewer({
  canvas,
  zoom,
  children,
}: PdfSinglePageViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (canvas && imgRef.current) {
      imgRef.current.src = canvas.toDataURL();
    }
  }, [canvas]);

  if (!canvas) {
    return (
      <div className="flex items-center justify-center h-full bg-muted/20 rounded-lg border-2 border-dashed border-muted-foreground/30">
        <p className="text-muted-foreground">Aucun PDF chargé</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative flex items-center justify-center overflow-auto bg-muted/10 rounded-lg"
      style={{ minHeight: 400 }}
    >
      <div
        className="relative shadow-lg"
        style={{
          width: canvas.width * zoom,
          height: canvas.height * zoom,
        }}
      >
        <img
          ref={imgRef}
          alt="PDF page"
          className="w-full h-full"
          style={{ display: 'block' }}
        />
        {/* Overlay layer for fields */}
        <div
          className="absolute inset-0"
          style={{ pointerEvents: 'none' }}
        >
          <div style={{ pointerEvents: 'auto', width: '100%', height: '100%', position: 'relative' }}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
