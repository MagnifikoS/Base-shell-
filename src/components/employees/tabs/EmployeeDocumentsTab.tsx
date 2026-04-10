import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Upload, Download, Trash2, FileText, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useEmployeeDocuments } from "../hooks/useEmployeeDocuments";
import { useEmployeeDocumentMutations } from "../hooks/useEmployeeDocumentMutations";
import {
  DOCUMENT_TYPES,
  formatFileSize,
  getDocumentTypeLabel,
  type DocumentType,
} from "../types/employee.documents.types";
import { validateFileUpload } from "@/lib/schemas/upload";

interface EmployeeDocumentsTabProps {
  userId: string;
  establishmentId: string | null;
  isOwnProfile: boolean;
}

export function EmployeeDocumentsTab({
  userId,
  establishmentId,
  isOwnProfile,
}: EmployeeDocumentsTabProps) {
  const [selectedType, setSelectedType] = useState<DocumentType>("piece_identite_fr");
  const [deleteDocId, setDeleteDocId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    data: documents,
    isLoading,
    isError,
    error,
  } = useEmployeeDocuments({ userId, establishmentId });
  const { uploadMutation, downloadMutation, deleteMutation } = useEmployeeDocumentMutations({
    userId,
    establishmentId,
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file before upload
      const validation = validateFileUpload(file);
      if (!validation.valid) {
        toast.error(validation.error);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        return;
      }
      uploadMutation.mutate({ file, documentType: selectedType });
      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleDownload = (docId: string) => {
    downloadMutation.mutate(docId);
  };

  const handleDeleteConfirm = () => {
    if (deleteDocId) {
      deleteMutation.mutate(deleteDocId);
      setDeleteDocId(null);
    }
  };

  // Error state
  if (isError) {
    const errorMessage = (error as Error)?.message || "Erreur inconnue";
    const isForbidden = errorMessage.includes("403") || errorMessage.includes("Forbidden");

    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <AlertCircle className="h-10 w-10 text-destructive mb-4" />
        <p className="text-sm text-muted-foreground">
          {isForbidden ? "Accès interdit" : `Erreur: ${errorMessage}`}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Upload section (admin only) */}
      {!isOwnProfile && (
        <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
          <h3 className="text-sm font-medium">Ajouter un document</h3>
          <div className="flex gap-3 items-end">
            <div className="flex-1 space-y-2">
              <Label>Type de document</Label>
              <Select
                value={selectedType}
                onValueChange={(v) => setSelectedType(v as DocumentType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOCUMENT_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleFileSelect}
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
              />
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadMutation.isPending}
              >
                {uploadMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                Choisir un fichier
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Documents list */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-muted-foreground">Documents</h3>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : documents && documents.length > 0 ? (
          <div className="space-y-2">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center justify-between p-3 border rounded-lg bg-card"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium text-sm">{getDocumentTypeLabel(doc.document_type)}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {doc.file_name} • {formatFileSize(doc.file_size)} •{" "}
                      {new Date(doc.created_at).toLocaleDateString("fr-FR")}
                    </p>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDownload(doc.id)}
                    disabled={downloadMutation.isPending}
                    title="Télécharger"
                    aria-label="Télécharger le document"
                  >
                    {downloadMutation.isPending && downloadMutation.variables === doc.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                  </Button>
                  {!isOwnProfile && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleteDocId(doc.id)}
                      disabled={deleteMutation.isPending}
                      title="Supprimer"
                      aria-label="Supprimer le document"
                      className="text-destructive hover:text-destructive"
                    >
                      {deleteMutation.isPending && deleteMutation.variables === doc.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <FileText className="h-10 w-10 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Aucun document</p>
          </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteDocId} onOpenChange={() => setDeleteDocId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce document ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est irréversible. Le document sera définitivement supprimé.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
