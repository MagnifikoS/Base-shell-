import { Rnd } from "react-rnd";
import type { Field, StampAsset } from "../utils/types";
import { pctToPixels, pixelsToPct, clampFieldPosition, clampFieldSize } from "../utils/coords";
import { Trash2 } from "lucide-react";

interface OverlayLayerProps {
  fields: Field[];
  assets: StampAsset[];
  pageIndex: number;
  pageWidthPx: number;
  pageHeightPx: number;
  selectedFieldId: string | null;
  onSelectField: (id: string | null) => void;
  onUpdateField: (id: string, updates: Partial<Field>) => void;
  onDeleteField: (id: string) => void;
}

export function OverlayLayer({
  fields,
  assets,
  pageIndex,
  pageWidthPx,
  pageHeightPx,
  selectedFieldId,
  onSelectField,
  onUpdateField,
  onDeleteField,
}: OverlayLayerProps) {
  const pageFields = fields.filter((f) => f.pageIndex === pageIndex);

  const getAssetImage = (assetId: string): string | null => {
    const asset = assets.find((a) => a.id === assetId);
    return asset?.pngDataUrl ?? null;
  };

  const handleDragStop = (fieldId: string, x: number, y: number, wPct: number, hPct: number) => {
    const xPct = pixelsToPct(x, pageWidthPx);
    const yPct = pixelsToPct(y, pageHeightPx);
    const clamped = clampFieldPosition(xPct, yPct, wPct, hPct);
    onUpdateField(fieldId, clamped);
  };

  const handleResizeStop = (
    fieldId: string,
    xPx: number,
    yPx: number,
    widthPx: number,
    heightPx: number
  ) => {
    const xPct = pixelsToPct(xPx, pageWidthPx);
    const yPct = pixelsToPct(yPx, pageHeightPx);
    const wPct = pixelsToPct(widthPx, pageWidthPx);
    const hPct = pixelsToPct(heightPx, pageHeightPx);

    const clampedSize = clampFieldSize(xPct, yPct, wPct, hPct);
    const clampedPos = clampFieldPosition(xPct, yPct, clampedSize.wPct, clampedSize.hPct);

    onUpdateField(fieldId, {
      ...clampedPos,
      ...clampedSize,
    });
  };

  const getBorderColor = (kind: Field["kind"], isSelected: boolean) => {
    if (isSelected) return "#3b82f6"; // blue-500
    switch (kind) {
      case "paraphe":
        return "#22c55e"; // green-500
      case "signature":
        return "#8b5cf6"; // violet-500
      case "stamp":
        return "#f97316"; // orange-500
    }
  };

  return (
    <>
      {pageFields.map((field) => {
        const xPx = pctToPixels(field.xPct, pageWidthPx);
        const yPx = pctToPixels(field.yPct, pageHeightPx);
        const wPx = pctToPixels(field.wPct, pageWidthPx);
        const hPx = pctToPixels(field.hPct, pageHeightPx);
        const isSelected = selectedFieldId === field.id;
        const assetImg = getAssetImage(field.assetId);
        const borderColor = getBorderColor(field.kind, isSelected);

        return (
          <Rnd
            key={field.id}
            position={{ x: xPx, y: yPx }}
            size={{ width: wPx, height: hPx }}
            bounds="parent"
            onDragStop={(e, d) => handleDragStop(field.id, d.x, d.y, field.wPct, field.hPct)}
            onResizeStop={(e, dir, ref, delta, pos) => {
              handleResizeStop(
                field.id,
                pos.x,
                pos.y,
                parseFloat(ref.style.width),
                parseFloat(ref.style.height)
              );
            }}
            onClick={() => onSelectField(field.id)}
            className="group"
            style={{
              border: `2px ${isSelected ? "solid" : "dashed"} ${borderColor}`,
              borderRadius: 4,
              backgroundColor: isSelected ? "rgba(59, 130, 246, 0.1)" : "transparent",
              cursor: "move",
            }}
            enableResizing={{
              top: true,
              right: true,
              bottom: true,
              left: true,
              topRight: true,
              bottomRight: true,
              bottomLeft: true,
              topLeft: true,
            }}
          >
            {/* Asset image */}
            {assetImg ? (
              <img
                src={assetImg}
                alt={field.kind}
                className="w-full h-full object-contain pointer-events-none"
                style={{ opacity: 0.85 }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">
                {field.kind}
              </div>
            )}

            {/* Delete button (visible on hover or when selected) */}
            {isSelected && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteField(field.id);
                }}
                className="absolute -top-3 -right-3 bg-destructive text-destructive-foreground rounded-full p-1 shadow-md hover:bg-destructive/80 transition-colors"
                aria-label="Supprimer le champ"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}

            {/* Label badge */}
            <div
              className="absolute -bottom-5 left-0 text-[10px] px-1 py-0.5 rounded bg-background/90 border shadow-sm truncate max-w-full"
              style={{ borderColor }}
            >
              {field.label || field.kind}
            </div>
          </Rnd>
        );
      })}
    </>
  );
}
