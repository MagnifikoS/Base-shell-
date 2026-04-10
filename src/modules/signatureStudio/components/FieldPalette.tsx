import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PenLine, Stamp, Image, Plus, Trash2 } from "lucide-react";
import type { StampAsset, Field } from "../utils/types";

interface FieldPaletteProps {
  assets: StampAsset[];
  fields: Field[];
  currentPageIndex: number;
  selectedFieldId: string | null;
  onCreateParaphe: () => void;
  onCreateSignature: () => void;
  onUploadStamp: () => void;
  onAddField: (kind: Field["kind"]) => void;
  onSelectField: (id: string | null) => void;
  onDeleteAsset: (id: string) => void;
}

export function FieldPalette({
  assets,
  fields,
  currentPageIndex,
  selectedFieldId,
  onCreateParaphe,
  onCreateSignature,
  onUploadStamp,
  onAddField,
  onSelectField,
  onDeleteAsset,
}: FieldPaletteProps) {
  const paraphes = assets.filter((a) => a.type === "paraphe");
  const signatures = assets.filter((a) => a.type === "signature");
  const stamps = assets.filter((a) => a.type === "stamp");
  const pageFields = fields.filter((f) => f.pageIndex === currentPageIndex);

  const canAddParaphe = paraphes.length > 0;
  const canAddSignature = signatures.length > 0;
  const canAddStamp = stamps.length > 0;

  return (
    <div className="flex flex-col h-full">
      {/* Assets Section */}
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
            <PenLine className="h-4 w-4" />
            Paraphes
          </h3>
          <div className="flex flex-wrap gap-2">
            {paraphes.map((asset) => (
              <div key={asset.id} className="relative group border rounded p-1 bg-background">
                <img src={asset.pngDataUrl} alt="Paraphe" className="h-8 w-auto" />
                <button
                  onClick={() => onDeleteAsset(asset.id)}
                  className="absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 bg-destructive text-destructive-foreground rounded-full p-0.5 transition-opacity"
                  aria-label="Supprimer le paraphe"
                >
                  <Trash2 className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={onCreateParaphe} className="h-10">
              <Plus className="h-3 w-3 mr-1" />
              Créer
            </Button>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
            <PenLine className="h-4 w-4" />
            Signatures
          </h3>
          <div className="flex flex-wrap gap-2">
            {signatures.map((asset) => (
              <div key={asset.id} className="relative group border rounded p-1 bg-background">
                <img src={asset.pngDataUrl} alt="Signature" className="h-10 w-auto" />
                <button
                  onClick={() => onDeleteAsset(asset.id)}
                  className="absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 bg-destructive text-destructive-foreground rounded-full p-0.5 transition-opacity"
                  aria-label="Supprimer la signature"
                >
                  <Trash2 className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={onCreateSignature} className="h-12">
              <Plus className="h-3 w-3 mr-1" />
              Créer
            </Button>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
            <Stamp className="h-4 w-4" />
            Tampons
          </h3>
          <div className="flex flex-wrap gap-2">
            {stamps.map((asset) => (
              <div key={asset.id} className="relative group border rounded p-1 bg-background">
                <img src={asset.pngDataUrl} alt="Tampon" className="h-12 w-12 object-contain" />
                <button
                  onClick={() => onDeleteAsset(asset.id)}
                  className="absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 bg-destructive text-destructive-foreground rounded-full p-0.5 transition-opacity"
                  aria-label="Supprimer le tampon"
                >
                  <Trash2 className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={onUploadStamp}
              className="h-14 w-14"
              aria-label="Importer un tampon"
            >
              <Image className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <Separator className="my-4" />

      {/* Add to page section */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Ajouter sur cette page</h3>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onAddField("paraphe")}
            disabled={!canAddParaphe}
          >
            <Plus className="h-3 w-3 mr-1" />
            Paraphe
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onAddField("signature")}
            disabled={!canAddSignature}
          >
            <Plus className="h-3 w-3 mr-1" />
            Signature
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onAddField("stamp")}
            disabled={!canAddStamp}
          >
            <Plus className="h-3 w-3 mr-1" />
            Tampon
          </Button>
        </div>
      </div>

      <Separator className="my-4" />

      {/* Fields on current page */}
      <div className="flex-1 min-h-0">
        <h3 className="text-sm font-medium mb-2">
          Zones page {currentPageIndex + 1}
          <Badge variant="secondary" className="ml-2">
            {pageFields.length}
          </Badge>
        </h3>
        <ScrollArea className="h-[200px]">
          <div className="space-y-1 pr-3">
            {pageFields.length === 0 ? (
              <p className="text-xs text-muted-foreground">Aucune zone sur cette page</p>
            ) : (
              pageFields.map((field) => (
                <button
                  key={field.id}
                  onClick={() => onSelectField(field.id)}
                  className={`w-full text-left px-2 py-1.5 rounded text-sm flex items-center gap-2 transition-colors ${
                    selectedFieldId === field.id ? "bg-primary/10 text-primary" : "hover:bg-muted"
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      field.kind === "paraphe"
                        ? "bg-green-500 dark:bg-green-600"
                        : field.kind === "signature"
                          ? "bg-violet-500 dark:bg-violet-600"
                          : "bg-orange-500 dark:bg-orange-600"
                    }`}
                  />
                  <span className="truncate">{field.label || field.kind}</span>
                </button>
              ))
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
