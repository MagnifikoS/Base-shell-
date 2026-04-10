/**
 * Hook: upload a file (photo/PDF) to BL-APP storage bucket
 * and insert the metadata in bl_app_files.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { uploadBlAppFile } from "../services/blAppService";

export function useUploadBlAppFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      establishmentId,
      blAppDocumentId,
      file,
    }: {
      establishmentId: string;
      blAppDocumentId: string;
      file: File;
    }) => uploadBlAppFile(establishmentId, blAppDocumentId, file),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["bl-app-files", variables.blAppDocumentId],
      });
    },
  });
}
