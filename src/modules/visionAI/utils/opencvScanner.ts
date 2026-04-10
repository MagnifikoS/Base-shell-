import type { PreprocessResult } from "./imagePreprocessor.types";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Document Scanner — Canvas-based image preprocessing
 * ═══════════════════════════════════════════════════════════════════════════
 * Preprocesses photos before sending to Vision AI:
 * - Resize large images (4K→2048px max)
 * - Contrast enhancement (helps with shadows/low light)
 * - Quality detection (blur/darkness)
 * - JPEG compression (reduces upload size + AI token cost)
 *
 * NO external dependencies. Pure Canvas API.
 * PDF files pass through unchanged.
 */

export async function scanDocument(file: File): Promise<PreprocessResult> {
  // PDF files: bypass all processing, return as-is
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    return { file, warnings: [], qualityScore: 1.0, metadata: { processed: false } };
  }

  try {
    return await processImage(file);
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn("[Scanner] Processing failed, using original file:", err);
    }
    return {
      file,
      warnings: ["processing_failed"],
      qualityScore: 0.5,
      metadata: { processed: false },
    };
  }
}

async function processImage(file: File): Promise<PreprocessResult> {
  const img = await loadImage(file);

  // Step 1: Resize to max 2048px (mobile photos are often 4000x3000)
  const MAX = 2048;
  let w = img.width;
  let h = img.height;
  const wasResized = w > MAX || h > MAX;
  if (wasResized) {
    const ratio = Math.min(MAX / w, MAX / h);
    w = Math.round(w * ratio);
    h = Math.round(h * ratio);
  }

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, w, h);

  // Step 2: Get image data for analysis and enhancement
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  // Step 3: Measure quality (average luminance + blur estimate)
  let totalLuminance = 0;
  let edgeSum = 0;
  const pixelCount = w * h;

  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    totalLuminance += lum;
  }
  const avgLuminance = totalLuminance / pixelCount;

  // Simple edge detection for blur: compare adjacent pixels (Laplacian approximation)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x += 3) {
      // Sample every 3rd pixel for speed
      const idx = (y * w + x) * 4;
      const center = data[idx]; // Red channel
      const top = data[((y - 1) * w + x) * 4];
      const bottom = data[((y + 1) * w + x) * 4];
      const left = data[(y * w + (x - 1)) * 4];
      const right = data[(y * w + (x + 1)) * 4];
      const laplacian = Math.abs(4 * center - top - bottom - left - right);
      edgeSum += laplacian;
    }
  }
  const edgeVariance = edgeSum / (pixelCount / 3);

  // Normalize quality score: combines sharpness + brightness
  const sharpnessScore = Math.min(edgeVariance / 30, 1.0);
  const brightnessScore = avgLuminance > 40 && avgLuminance < 220 ? 1.0 : 0.5;
  const qualityScore = Math.round(sharpnessScore * brightnessScore * 100) / 100;

  // Step 4: Enhance contrast (+30% — helps with kitchen shadows)
  const contrast = 1.3;
  const factor = (259 * (contrast * 255 + 255)) / (255 * (259 - contrast * 255));
  for (let i = 0; i < data.length; i += 4) {
    data[i] = clamp(factor * (data[i] - 128) + 128);
    data[i + 1] = clamp(factor * (data[i + 1] - 128) + 128);
    data[i + 2] = clamp(factor * (data[i + 2] - 128) + 128);
    // Alpha unchanged
  }

  ctx.putImageData(imageData, 0, 0);

  // Step 5: Output as compressed JPEG
  const processedFile = await canvasToFile(canvas, file.name, "image/jpeg", 0.88);

  // Step 6: Generate warnings
  const warnings: string[] = [];
  if (sharpnessScore < 0.15) warnings.push("image_very_blurry");
  else if (sharpnessScore < 0.4) warnings.push("image_blurry");
  if (avgLuminance < 40) warnings.push("image_too_dark");
  if (avgLuminance > 220) warnings.push("image_overexposed");

  return {
    file: processedFile,
    warnings,
    qualityScore,
    metadata: {
      processed: true,
      perspectiveCorrected: false,
      originalSize: file.size,
      processedSize: processedFile.size,
    },
  };
}

function clamp(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };
    img.src = url;
  });
}

async function canvasToFile(
  canvas: HTMLCanvasElement,
  name: string,
  type: string,
  quality: number
): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(new File([blob], name.replace(/\.[^.]+$/, ".jpg"), { type }));
        } else {
          reject(new Error("Failed to create blob from canvas"));
        }
      },
      type,
      quality
    );
  });
}
