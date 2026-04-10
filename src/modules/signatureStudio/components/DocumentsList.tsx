import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, Plus, Trash2, Eye } from "lucide-react";
import type { SavedDocument } from "../utils/types";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

interface DocumentsListProps {
  documents: SavedDocument[];
  onNewDocument: () => void;
  onOpenDocument: (id: string) => void;
  onDeleteDocument: (id: string) => void;
}

export function DocumentsList({
  documents,
  onNewDocument,
  onOpenDocument,
  onDeleteDocument,
}: DocumentsListProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Documents signés</h2>
          <p className="text-sm text-muted-foreground">
            Liste des PDFs avec paraphes et signatures
          </p>
        </div>
        <Button onClick={onNewDocument}>
          <Plus className="h-4 w-4 mr-2" />
          Nouveau document
        </Button>
      </div>

      {documents.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <FileText className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="font-medium mb-2">Aucun document</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Commencez par importer un PDF et placer vos signatures
            </p>
            <Button onClick={onNewDocument}>
              <Plus className="h-4 w-4 mr-2" />
              Lancer Studio Signature
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {documents.map((doc) => (
            <Card key={doc.id} className="group">
              <CardHeader className="pb-2">
                <CardTitle className="text-base truncate flex items-center gap-2">
                  <FileText className="h-4 w-4 shrink-0" />
                  {doc.fileName}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-sm text-muted-foreground space-y-1">
                  <p>
                    {doc.numPages} page(s) • {doc.fieldsCount} champ(s)
                  </p>
                  <p>
                    Modifié le{" "}
                    {format(new Date(doc.updatedAt), "dd MMM yyyy à HH:mm", {
                      locale: fr,
                    })}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => onOpenDocument(doc.id)}
                  >
                    <Eye className="h-4 w-4 mr-2" />
                    Ouvrir
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive"
                    onClick={() => onDeleteDocument(doc.id)}
                    aria-label="Supprimer le document"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
