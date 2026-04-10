export interface PreprocessResult {
  file: File;
  warnings: string[];
  qualityScore: number; // 0.0 - 1.0
  metadata: {
    processed: boolean;
    perspectiveCorrected?: boolean;
    originalSize?: number;
    processedSize?: number;
  };
}
