// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  IMAGE_MAX_BYTES,
  PORTFOLIO_OUTPUT_MAX_DIMENSION,
  extensionForImageMime,
  planReencodeSize,
  reencodeImage,
} from "@/lib/admin/image-reencode";

describe("extensionForImageMime", () => {
  it("白名單內的 mime 對應副檔名", () => {
    expect(extensionForImageMime("image/jpeg")).toBe("jpg");
    expect(extensionForImageMime("image/png")).toBe("png");
    expect(extensionForImageMime("image/webp")).toBe("webp");
  });
  it("白名單外或 Object.prototype 繼承屬性名稱回傳 null", () => {
    expect(extensionForImageMime("image/gif")).toBeNull();
    expect(extensionForImageMime("constructor")).toBeNull();
    expect(extensionForImageMime("")).toBeNull();
  });
});

describe("planReencodeSize", () => {
  it("長邊超過 1024 時等比例縮小", () => {
    expect(planReencodeSize(4000, 2000)).toEqual({ width: 1024, height: 512 });
    expect(planReencodeSize(2000, 4000)).toEqual({ width: 512, height: 1024 });
  });
  it("長邊 1024 以內不放大也不縮小", () => {
    expect(planReencodeSize(300, 200)).toEqual({ width: 300, height: 200 });
    expect(planReencodeSize(1024, 1024)).toEqual({ width: 1024, height: 1024 });
  });
  it("任一邊超過 8000 或總像素超過 40MP 回傳 null（邊界：8000 通過）", () => {
    expect(planReencodeSize(8000, 4000)).not.toBeNull();
    expect(planReencodeSize(8001, 100)).toBeNull();
    expect(planReencodeSize(100, 8001)).toBeNull();
    expect(planReencodeSize(7000, 6000)).toBeNull(); // 42MP
  });
  it("非法尺寸回傳 null", () => {
    expect(planReencodeSize(0, 100)).toBeNull();
    expect(planReencodeSize(Number.NaN, 100)).toBeNull();
  });
  it("極端長寬比縮小後最短邊至少 1", () => {
    expect(planReencodeSize(8000, 1)).toEqual({ width: 1024, height: 1 });
  });
  it("可指定 maxDimension（作品集 1600）；未指定仍是 1024（頭像行為不變）", () => {
    expect(planReencodeSize(4000, 2000, 1600)).toEqual({ width: 1600, height: 800 });
    expect(planReencodeSize(1500, 1000, 1600)).toEqual({ width: 1500, height: 1000 });
    expect(planReencodeSize(4000, 2000)).toEqual({ width: 1024, height: 512 });
    expect(PORTFOLIO_OUTPUT_MAX_DIMENSION).toBe(1600);
  });
  it("maxDimension 不放寬原圖解析度上限", () => {
    expect(planReencodeSize(8001, 100, 1600)).toBeNull();
    expect(planReencodeSize(7000, 6000, 1600)).toBeNull();
  });
});

// jsdom 沒有 canvas／createImageBitmap：用假物件驗證流程（webp 優先、不支援改 jpeg、失敗中止、資源釋放）。
function setup(options: {
  bitmap?: { width: number; height: number } | "throw";
  blobs: Array<{ type: string; size: number } | null>;
}) {
  const close = vi.fn();
  const createImageBitmapMock = vi.fn(async () => {
    if (options.bitmap === "throw") throw new Error("decode failed");
    return { ...(options.bitmap ?? { width: 800, height: 600 }), close };
  });
  vi.stubGlobal("createImageBitmap", createImageBitmapMock);

  const requestedTypes: string[] = [];
  const context = { drawImage: vi.fn(), fillRect: vi.fn(), fillStyle: "" };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    toBlob: (callback: (blob: Blob | null) => void, type: string) => {
      requestedTypes.push(type);
      const next = options.blobs.shift() ?? null;
      callback(next ? ({ type: next.type, size: next.size } as Blob) : null);
    },
  };
  vi.spyOn(document, "createElement").mockReturnValue(canvas as unknown as HTMLElement);
  return { close, context, canvas, requestedTypes, createImageBitmapMock };
}

const file = new File(["x"], "a.png", { type: "image/png" });

describe("reencodeImage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("webp 編碼成功時輸出 webp，並依 EXIF 方向解碼", async () => {
    const { createImageBitmapMock, requestedTypes } = setup({ blobs: [{ type: "image/webp", size: 1000 }] });
    const result = await reencodeImage(file);

    expect(result).toMatchObject({ ok: true, extension: "webp" });
    expect(requestedTypes).toEqual(["image/webp"]);
    expect(createImageBitmapMock).toHaveBeenCalledWith(file, { imageOrientation: "from-image" });
  });

  it("預設長邊縮到 1024；傳入 maxDimension 1600 時縮到 1600（作品集）", async () => {
    const big = { width: 3200, height: 1600 };
    const first = setup({ bitmap: big, blobs: [{ type: "image/webp", size: 1000 }] });
    await reencodeImage(file);
    expect(first.context.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1024, 512);

    vi.restoreAllMocks();
    const second = setup({ bitmap: big, blobs: [{ type: "image/webp", size: 1000 }] });
    await reencodeImage(file, { maxDimension: 1600 });
    expect(second.context.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 800);
  });

  it("瀏覽器不支援 webp（回傳 png）時改輸出 jpeg，並先填白底", async () => {
    const { requestedTypes, context } = setup({
      blobs: [
        { type: "image/png", size: 1000 },
        { type: "image/jpeg", size: 800 },
      ],
    });
    const result = await reencodeImage(file);

    expect(result).toMatchObject({ ok: true, extension: "jpg" });
    expect(requestedTypes).toEqual(["image/webp", "image/jpeg"]);
    expect(context.fillRect).toHaveBeenCalled();
    expect(context.fillStyle).toBe("#ffffff");
  });

  it("toBlob 回傳 null 時改試 jpeg；jpeg 也失敗就中止（不退回上傳原檔）", async () => {
    setup({ blobs: [null, null] });
    const result = await reencodeImage(file);
    expect(result).toEqual({ ok: false, message: "圖片處理失敗，請換一張圖片再試" });
  });

  it("輸出的 mime 不在白名單內就中止", async () => {
    setup({ blobs: [{ type: "image/png", size: 1000 }, { type: "image/gif", size: 1000 }] });
    const result = await reencodeImage(file);
    expect(result.ok).toBe(false);
  });

  it("連 jpeg 也退回 png 時，副檔名依實際 blob.type 決定（png 在白名單內）", async () => {
    setup({ blobs: [{ type: "image/png", size: 1000 }, { type: "image/png", size: 1000 }] });
    expect(await reencodeImage(file)).toMatchObject({ ok: true, extension: "png" });
  });

  it("編碼後超過 5MB 就中止", async () => {
    setup({ blobs: [{ type: "image/webp", size: IMAGE_MAX_BYTES + 1 }] });
    expect(await reencodeImage(file)).toEqual({ ok: false, message: "檔案大小需小於 5MB" });
  });

  it("原圖解析度過大時不畫 canvas，直接拒絕", async () => {
    const { context, requestedTypes } = setup({ bitmap: { width: 9000, height: 100 }, blobs: [] });
    expect(await reencodeImage(file)).toEqual({ ok: false, message: "圖片解析度過大，請換一張較小的圖片" });
    expect(context.drawImage).not.toHaveBeenCalled();
    expect(requestedTypes).toEqual([]);
  });

  it("無法解碼時回傳可讀的錯誤", async () => {
    setup({ bitmap: "throw", blobs: [] });
    expect(await reencodeImage(file)).toEqual({ ok: false, message: "無法讀取這張圖片，請換一張再試" });
  });

  it("無論成功或失敗都釋放 bitmap 與 canvas", async () => {
    const ok = setup({ blobs: [{ type: "image/webp", size: 10 }] });
    await reencodeImage(file);
    expect(ok.close).toHaveBeenCalledTimes(1);
    expect(ok.canvas.width).toBe(0);
    expect(ok.canvas.height).toBe(0);

    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    const failed = setup({ bitmap: { width: 9000, height: 9000 }, blobs: [] });
    await reencodeImage(file);
    expect(failed.close).toHaveBeenCalledTimes(1);
  });
});
