import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { DocumentType, EmployeeDocument } from "../types/employee.documents.types";

interface UseEmployeeDocumentMutationsOptions {
  userId: string | null;
  establishmentId: string | null;
}

interface UploadPayload {
  file: File;
  documentType: DocumentType;
}

export function useEmployeeDocumentMutations({
  userId,
  establishmentId,
}: UseEmployeeDocumentMutationsOptions) {
  const queryClient = useQueryClient();

  const invalidateDocuments = () => {
    if (userId && establishmentId) {
      queryClient.invalidateQueries({ queryKey: ["employee-documents", userId, establishmentId] });
    }
  };

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: async ({ file, documentType }: UploadPayload) => {
      if (!userId || !establishmentId) throw new Error("User ID and Establishment ID required");

      // Convert file to base64
      const arrayBuffer = await file.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < uint8Array.length; i++) {
        binary += String.fromCharCode(uint8Array[i]);
      }
      const fileBase64 = btoa(binary);

      const { data, error } = await supabase.functions.invoke("employee-documents", {
        body: {
          action: "upload",
          user_id: userId,
          establishment_id: establishmentId,
          file_name: file.name,
          file_type: file.type,
          file_size: file.size,
          document_type: documentType,
          file_base64: fileBase64,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      return data.document as EmployeeDocument;
    },
    onSuccess: () => {
      invalidateDocuments();
      toast.success("Document ajouté");
    },
    onError: (error: Error) => {
      toast.error(`Erreur: ${error.message}`);
    },
  });

  // Download mutation (blob-based to avoid ERR_BLOCKED_BY_CLIENT)
  const downloadMutation = useMutation({
    mutationFn: async (documentId: string) => {
      const { data, error } = await supabase.functions.invoke("employee-documents", {
        body: { action: "download", document_id: documentId },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      return { url: data.url as string, fileName: data.file_name as string };
    },
    onSuccess: async ({ url, fileName }) => {
      try {
        // Fetch blob to bypass browser download blockers
        const response = await fetch(url);
        if (!response.ok) throw new Error("Échec du téléchargement");

        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);

        const link = document.createElement("a");
        link.href = blobUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // Cleanup
        URL.revokeObjectURL(blobUrl);
      } catch (_err) {
        toast.error("Erreur lors du téléchargement du fichier");
      }
    },
    onError: (error: Error) => {
      toast.error(`Erreur: ${error.message}`);
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (documentId: string) => {
      const { data, error } = await supabase.functions.invoke("employee-documents", {
        body: { action: "delete", document_id: documentId },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      return true;
    },
    onSuccess: () => {
      invalidateDocuments();
      toast.success("Document supprimé");
    },
    onError: (error: Error) => {
      toast.error(`Erreur: ${error.message}`);
    },
  });

  return {
    uploadMutation,
    downloadMutation,
    deleteMutation,
  };
}
