/**
 * Detects a file's type from its bytes (never from the client's name or Content-Type) and checks it
 * against the allow-list for evidence.
 */
export interface DetectedType {
  mediaType: string;
  extension: string;
}

const startsWith = (b: Uint8Array, sig: number[], offset = 0) => sig.every((v, i) => b[offset + i] === v);
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));

const isUtf8Text = (b: Uint8Array) => {
  const sample = b.subarray(0, 64 * 1024);
  if (sample.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(
      sample.length === b.length ? sample : sample.subarray(0, lastBoundary(sample)),
    );
    return true;
  } catch {
    return false;
  }
};
/** Avoid cutting a multi-byte character when sampling. */
const lastBoundary = (b: Uint8Array) => {
  let i = b.length;
  while (i > 0 && ((b[i - 1] ?? 0) & 0xc0) === 0x80) i--;
  return i > 0 && ((b[i - 1] ?? 0) & 0x80) !== 0 ? i - 1 : b.length;
};

const zipEntryNames = (b: Uint8Array) => {
  // Good enough for OOXML detection: entry names appear in local file headers near the start.
  return ascii(b, 0, Math.min(b.length, 4096));
};

export const detectFileType = (bytes: Uint8Array, originalName: string): DetectedType | null => {
  const name = originalName.toLowerCase();
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]))
    return { mediaType: "application/pdf", extension: "pdf" };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return { mediaType: "image/png", extension: "png" };
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { mediaType: "image/jpeg", extension: "jpg" };
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP")
    return { mediaType: "image/webp", extension: "webp" };
  if (
    ascii(bytes, 4, 8) === "ftyp" &&
    ["heic", "heix", "mif1", "heim", "heis"].includes(ascii(bytes, 8, 12))
  ) {
    return { mediaType: "image/heic", extension: "heic" };
  }
  if (startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])) {
    return { mediaType: "image/tiff", extension: "tiff" };
  }
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    const entries = zipEntryNames(bytes);
    if (entries.includes("[Content_Types].xml") || entries.includes("word/") || entries.includes("xl/")) {
      if (name.endsWith(".docx") || entries.includes("word/")) {
        return {
          mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          extension: "docx",
        };
      }
      if (name.endsWith(".xlsx") || entries.includes("xl/")) {
        return {
          mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          extension: "xlsx",
        };
      }
    }
    return null; // other ZIP archives are not accepted
  }
  if (isUtf8Text(bytes)) {
    if (name.endsWith(".csv")) return { mediaType: "text/csv", extension: "csv" };
    return { mediaType: "text/plain", extension: "txt" };
  }
  return null;
};

export const ACCEPTED_DESCRIPTION =
  "PDF, PNG, JPEG, WebP, HEIC, TIFF, Word (.docx), Excel (.xlsx), CSV or plain text";
