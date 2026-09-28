// Bumped up from 900/0.75 — the vision model was missing some pantry items and ingredient
// details on lower-res/heavier-compressed shots. Still well within reasonable upload size.
const MAX_DIMENSION = 1200;
const JPEG_QUALITY = 0.85;

/**
 * Downscales/recompresses a photo before it's uploaded and before it's kept around as a
 * recipe thumbnail — full-resolution phone photos are overkill for both the vision model
 * and localStorage, which has a small size cap.
 */
export async function resizeImage(file: File): Promise<{ blob: Blob; dataUrl: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.drawImage(bitmap, 0, 0, width, height);

  const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Failed to encode image"))),
      "image/jpeg",
      JPEG_QUALITY
    );
  });

  return { blob, dataUrl };
}

/** Reconstructs a Blob from a previously-saved dataUrl (e.g. a cached pantry photo pulled back
 * out of localStorage), so it can be sent to the API without asking the user to retake it. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(",");
  const mimeMatch = header.match(/data:(.*?);base64/);
  const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
