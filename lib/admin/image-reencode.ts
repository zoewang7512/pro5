// 後台上傳圖片前，在瀏覽器用 canvas 重新編碼（TASK-069，security-reviewer／architect 審查）：
//   - 去除 EXIF（GPS、拍攝時間）：圖片會公開顯示在顧客預約頁，不能把原檔直接上傳。
//   - 縮小尺寸：頭像最大顯示約 120px，長邊 1024px（預設）綽綽有餘，也避免 PNG 退回時超過 5MB；作品集傳 maxDimension 用 1600。
//   - 擋掉多格式混合檔案（只上傳 canvas 重新編碼後的 blob）。
// 失敗一律中止，任何分支都不得退回上傳原始 File。只有後台用，且會用到 DOM，所以不放 lib/designers.ts
// （前台 anon 也會匯入那個檔案）。TASK-071 作品集上傳會重用。

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
// 原圖解析度上限：5MB 的 PNG 可以是數萬乘數萬像素，解碼會吃掉數 GB 記憶體。
export const IMAGE_MAX_SOURCE_DIMENSION = 8000;
export const IMAGE_MAX_SOURCE_PIXELS = 40_000_000;
export const IMAGE_OUTPUT_MAX_DIMENSION = 1024;
// 作品集會在前台全螢幕放大檢視（高解析手機約需 1100 實體像素寬），1024 會偏糊；頭像維持預設 1024。
export const PORTFOLIO_OUTPUT_MAX_DIMENSION = 1600;
const OUTPUT_QUALITY = 0.85;

// 與 designer-assets bucket 的 allowed_mime_types／Storage policy 的副檔名白名單一致。
const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// 用 Object.hasOwn 而非 `in`：避免 mime 恰好等於 Object.prototype 繼承屬性名稱時誤判命中
// （比照 lib/admin/account.ts validateAdminAvatarFile）。
export function extensionForImageMime(mime: string): string | null {
  return Object.hasOwn(IMAGE_EXTENSIONS, mime) ? IMAGE_EXTENSIONS[mime] : null;
}

// 回傳輸出尺寸（長邊縮到 maxDimension，預設 1024，不放大小圖）；原圖超過上限回傳 null。
export function planReencodeSize(
  width: number,
  height: number,
  maxDimension: number = IMAGE_OUTPUT_MAX_DIMENSION,
): { width: number; height: number } | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null;
  if (width > IMAGE_MAX_SOURCE_DIMENSION || height > IMAGE_MAX_SOURCE_DIMENSION) return null;
  if (width * height > IMAGE_MAX_SOURCE_PIXELS) return null;

  const longest = Math.max(width, height);
  if (longest <= maxDimension) return { width, height };
  const scale = maxDimension / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export type ReencodeResult =
  | { ok: true; blob: Blob; extension: string }
  | { ok: false; message: string };

const MESSAGE_TOO_LARGE = "圖片解析度過大，請換一張較小的圖片";
const MESSAGE_UNREADABLE = "無法讀取這張圖片，請換一張再試";
const MESSAGE_ENCODE_FAILED = "圖片處理失敗，請換一張圖片再試";

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), type, OUTPUT_QUALITY);
    } catch {
      resolve(null);
    }
  });
}

// 先試 webp；瀏覽器不支援時（例如部分 Safari）toBlob 會悄悄改輸出 PNG 或回傳 null，這時改輸出 JPEG
// （先填白底，否則透明區會變黑）。副檔名與 contentType 一律依實際 blob.type 決定，不寫死。
export async function reencodeImage(
  file: File,
  options: { maxDimension?: number } = {},
): Promise<ReencodeResult> {
  let bitmap: ImageBitmap;
  try {
    // from-image：依 EXIF 方向轉正，直拍的手機照不會橫躺。
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return { ok: false, message: MESSAGE_UNREADABLE };
  }

  const canvas = document.createElement("canvas");
  try {
    const size = planReencodeSize(bitmap.width, bitmap.height, options.maxDimension);
    if (!size) return { ok: false, message: MESSAGE_TOO_LARGE };

    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) return { ok: false, message: MESSAGE_ENCODE_FAILED };

    context.drawImage(bitmap, 0, 0, size.width, size.height);
    let blob = await canvasToBlob(canvas, "image/webp");

    if (!blob || blob.type !== "image/webp") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, size.width, size.height);
      context.drawImage(bitmap, 0, 0, size.width, size.height);
      blob = await canvasToBlob(canvas, "image/jpeg");
    }

    if (!blob) return { ok: false, message: MESSAGE_ENCODE_FAILED };
    const extension = extensionForImageMime(blob.type);
    if (!extension) return { ok: false, message: MESSAGE_ENCODE_FAILED };
    if (blob.size > IMAGE_MAX_BYTES) return { ok: false, message: "檔案大小需小於 5MB" };

    return { ok: true, blob, extension };
  } finally {
    // 連續更換幾次頭像會累積 canvas 記憶體（iOS Safari 有總量上限），用完立刻釋放。
    canvas.width = 0;
    canvas.height = 0;
    bitmap.close();
  }
}
