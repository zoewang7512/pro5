import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  designerInitial,
  instagramProfileUrl,
  isDesignerId,
  normalizeDesignerBio,
  normalizeInstagramHandle,
  normalizeSpecialties,
  portfolioLimitMessage,
  resolveDesignerAssetUrl,
  resolvePortfolioImageUrl,
  validateDesignerBio,
  validateDesignerName,
  validateDesignerSpecialties,
  validateInstagramHandle,
} from "@/lib/designers";

describe("resolveDesignerAssetUrl", () => {
  // 固定一組假的 Supabase URL，不依賴 .env.local（比照 tests/admin/account.test.ts）。
  const base = "https://project-ref.supabase.co";
  const avatarUrl = `${base}/storage/v1/object/public/designer-assets/avatar/d1/abc.webp`;
  const portfolioUrl = `${base}/storage/v1/object/public/designer-assets/portfolio/d1/abc.jpg`;

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", base);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("designer-assets bucket 底下的頭像與作品集網址通過白名單", () => {
    expect(resolveDesignerAssetUrl(avatarUrl)).toBe(avatarUrl);
    expect(resolveDesignerAssetUrl(portfolioUrl)).toBe(portfolioUrl);
  });

  it("null 與空白字串回傳 null", () => {
    expect(resolveDesignerAssetUrl(null)).toBeNull();
    expect(resolveDesignerAssetUrl("   ")).toBeNull();
  });

  it("外部網域回傳 null（即使路徑長得像合法路徑）", () => {
    expect(
      resolveDesignerAssetUrl("https://evil.example.com/storage/v1/object/public/designer-assets/avatar/d1/a.png"),
    ).toBeNull();
  });

  it("bucket 名稱前綴相似（非精確匹配）回傳 null", () => {
    expect(resolveDesignerAssetUrl(`${base}/storage/v1/object/public/designer-assets-evil/avatar/d1/a.png`)).toBeNull();
  });

  it("同網域但走其他 bucket 回傳 null", () => {
    expect(resolveDesignerAssetUrl(`${base}/storage/v1/object/public/admin-assets/avatar/a.png`)).toBeNull();
    expect(resolveDesignerAssetUrl(`${base}/storage/v1/object/public/store-assets/logo/a.png`)).toBeNull();
  });

  it("用 .. 或 %2e%2e 跳出 bucket 前綴會被 URL 解析正規化後擋下", () => {
    expect(
      resolveDesignerAssetUrl(`${base}/storage/v1/object/public/designer-assets/../admin-assets/avatar/a.png`),
    ).toBeNull();
    expect(
      resolveDesignerAssetUrl(`${base}/storage/v1/object/public/designer-assets/%2e%2e/admin-assets/avatar/a.png`),
    ).toBeNull();
  });

  it("帶帳密的網址（origin 不含帳密）回傳 null", () => {
    expect(
      resolveDesignerAssetUrl(`https://user:pw@project-ref.supabase.co/storage/v1/object/public/designer-assets/a.png`),
    ).toBeNull();
    expect(
      resolveDesignerAssetUrl(
        `https://project-ref.supabase.co@evil.example.com/storage/v1/object/public/designer-assets/a.png`,
      ),
    ).toBeNull();
  });

  it("編碼過的斜線（%2F、%5C，不分大小寫）回傳 null", () => {
    for (const encoded of ["%2F", "%2f", "%5C", "%5c"]) {
      expect(
        resolveDesignerAssetUrl(`${base}/storage/v1/object/public/designer-assets/..${encoded}admin-assets/a.png`),
      ).toBeNull();
    }
  });

  it("http: 協定與非預設埠回傳 null", () => {
    expect(
      resolveDesignerAssetUrl("http://project-ref.supabase.co/storage/v1/object/public/designer-assets/a.png"),
    ).toBeNull();
    expect(resolveDesignerAssetUrl(`${base}:8443/storage/v1/object/public/designer-assets/a.png`)).toBeNull();
  });

  it("回傳前後空白已去除的正規化網址（大寫網域會被正規化成小寫）", () => {
    expect(resolveDesignerAssetUrl(`  ${avatarUrl}  `)).toBe(avatarUrl);
    expect(
      resolveDesignerAssetUrl(
        "https://PROJECT-REF.supabase.co/storage/v1/object/public/designer-assets/avatar/d1/abc.webp",
      ),
    ).toBe(avatarUrl);
  });

  it("非法網址字串與 javascript: 偽協定回傳 null，不拋錯", () => {
    expect(resolveDesignerAssetUrl("not a url")).toBeNull();
    expect(resolveDesignerAssetUrl("javascript:alert(1)")).toBeNull();
  });

  it("NEXT_PUBLIC_SUPABASE_URL 未設定時一律回傳 null（避免退化成字面 undefined/… 前綴誤判通過）", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(resolveDesignerAssetUrl(avatarUrl)).toBeNull();
  });
});

describe("resolvePortfolioImageUrl（TASK-071 動工前安全審查：image_url 只驗結尾，顯示層要更嚴）", () => {
  const base = "https://project-ref.supabase.co";
  const A = "3f2b8c1e-9d4a-4e6f-8a7b-1c2d3e4f5a6b";
  const B = "11111111-2222-4333-8444-555555555555";
  const U = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
  const own = `${base}/storage/v1/object/public/designer-assets/portfolio/${A}/${U}.webp`;

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", base);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("這位設計師自己的作品集網址（jpg／png／webp）通過，回傳正規化後的 href", () => {
    expect(resolvePortfolioImageUrl(own, A)).toBe(own);
    expect(resolvePortfolioImageUrl(own.replace(".webp", ".jpg"), A)).toBe(own.replace(".webp", ".jpg"));
    expect(resolvePortfolioImageUrl(own.replace(".webp", ".png"), A)).toBe(own.replace(".webp", ".png"));
  });

  it("帶 query 或 hash 的網址一律拒絕（資料庫 constraint 只驗結尾，攻擊者可用 ?portfolio/A/… 湊出結尾）", () => {
    const avatarOfB = `${base}/storage/v1/object/public/designer-assets/avatar/${B}/${U}.webp`;
    expect(resolvePortfolioImageUrl(`${avatarOfB}?portfolio/${A}/${U}.webp`, A)).toBeNull();
    expect(resolvePortfolioImageUrl(`${avatarOfB}#portfolio/${A}/${U}.webp`, A)).toBeNull();
    expect(resolvePortfolioImageUrl(`${own}?x=1`, A)).toBeNull();
    expect(resolvePortfolioImageUrl(`${own}#x`, A)).toBeNull();
  });

  it("別位設計師的作品、頭像、多一層資料夾、其他副檔名、大寫副檔名一律拒絕", () => {
    const at = (tail: string) => `${base}/storage/v1/object/public/designer-assets/${tail}`;
    expect(resolvePortfolioImageUrl(at(`portfolio/${B}/${U}.webp`), A)).toBeNull();
    expect(resolvePortfolioImageUrl(at(`avatar/${A}/${U}.webp`), A)).toBeNull();
    expect(resolvePortfolioImageUrl(at(`portfolio/${A}/x/${U}.webp`), A)).toBeNull();
    expect(resolvePortfolioImageUrl(at(`portfolio/${A}/${U}.gif`), A)).toBeNull();
    expect(resolvePortfolioImageUrl(at(`portfolio/${A}/${U}.WEBP`), A)).toBeNull();
    expect(resolvePortfolioImageUrl(at(`portfolio/${A}/${U}`), A)).toBeNull();
  });

  it("外部網域、編碼斜線、路徑穿越、null、空字串一律拒絕", () => {
    expect(resolvePortfolioImageUrl(own.replace(base, "https://evil.example.com"), A)).toBeNull();
    expect(resolvePortfolioImageUrl(own.replace(`/portfolio/${A}/`, `/portfolio%2F${A}/`), A)).toBeNull();
    expect(resolvePortfolioImageUrl(own.replace("/designer-assets/portfolio/", "/designer-assets/../x/"), A)).toBeNull();
    expect(resolvePortfolioImageUrl(null, A)).toBeNull();
    expect(resolvePortfolioImageUrl("", A)).toBeNull();
  });

  it("designerId 不是小寫 uuid（大寫、含正規式字元）一律回傳 null，不組進正規式", () => {
    expect(resolvePortfolioImageUrl(own, A.toUpperCase())).toBeNull();
    expect(resolvePortfolioImageUrl(own, ".*")).toBeNull();
    expect(resolvePortfolioImageUrl(own, "")).toBeNull();
  });
});

describe("portfolioLimitMessage", () => {
  it("預設用 12 張上限；可傳入其他上限", () => {
    expect(portfolioLimitMessage()).toBe("已達 12 張上限，請先刪除舊作品");
    expect(portfolioLimitMessage(3)).toBe("已達 3 張上限，請先刪除舊作品");
  });
});

describe("designerInitial", () => {
  it("取名字第一個字", () => {
    expect(designerInitial("林小美")).toBe("林");
    expect(designerInitial("  Amy")).toBe("A");
  });
  it("空字串回傳 ?", () => {
    expect(designerInitial("   ")).toBe("?");
  });
  it("不會把代理對（surrogate pair）從中間切開", () => {
    expect(designerInitial("𠮷野")).toBe("𠮷");
  });
});

describe("validateDesignerName", () => {
  const MESSAGE = "請輸入 1～30 字的名稱";
  it("1 字與 30 字（邊界）通過", () => {
    expect(validateDesignerName("林")).toBeNull();
    expect(validateDesignerName("a".repeat(30))).toBeNull();
  });
  it("空字串、純空白、超過 30 字回傳錯誤", () => {
    expect(validateDesignerName("")).toBe(MESSAGE);
    expect(validateDesignerName("   ")).toBe(MESSAGE);
    expect(validateDesignerName("a".repeat(31))).toBe(MESSAGE);
  });
  it("前後空白不計入長度", () => {
    expect(validateDesignerName(`  ${"a".repeat(30)}  `)).toBeNull();
  });
  it("含控制字元回傳錯誤", () => {
    expect(validateDesignerName("林\u0000小美")).toBe(MESSAGE);
    expect(validateDesignerName("林\n小美")).toBe(MESSAGE);
  });
  it("含不可見的方向覆寫／零寬字元回傳錯誤", () => {
    expect(validateDesignerName("林‮小美")).toBe(MESSAGE);
    expect(validateDesignerName("林​小美")).toBe(MESSAGE);
  });
  it("只有全形空白視為空白", () => {
    expect(validateDesignerName("　　")).toBe(MESSAGE);
  });
});

describe("validateDesignerBio", () => {
  it("空字串與 200 字（邊界）通過", () => {
    expect(validateDesignerBio("")).toBeNull();
    expect(validateDesignerBio("a".repeat(200))).toBeNull();
  });
  it("超過 200 字回傳錯誤", () => {
    expect(validateDesignerBio("a".repeat(201))).toBe("200 字以內");
  });
});

describe("validateDesignerSpecialties", () => {
  it("0 個與 5 個（邊界）通過", () => {
    expect(validateDesignerSpecialties([])).toBeNull();
    expect(validateDesignerSpecialties(["a", "b", "c", "d", "e"])).toBeNull();
  });
  it("超過 5 個回傳錯誤", () => {
    expect(validateDesignerSpecialties(["a", "b", "c", "d", "e", "f"])).toBe("最多 5 個標籤");
  });
  it("單一標籤 12 字通過、13 字回傳錯誤", () => {
    expect(validateDesignerSpecialties(["a".repeat(12)])).toBeNull();
    expect(validateDesignerSpecialties(["a".repeat(13)])).toBe("每個標籤 12 字以內");
  });
  it("空白標籤回傳錯誤", () => {
    expect(validateDesignerSpecialties(["   "])).toBe("每個標籤 12 字以內");
  });
  it("標籤含控制字元或不可見字元回傳錯誤", () => {
    expect(validateDesignerSpecialties(["a\u0001b"])).toBe("標籤含有不允許的字元");
    expect(validateDesignerSpecialties(["a‮b"])).toBe("標籤含有不允許的字元");
  });
  it("重複標籤回傳錯誤（比對前先 trim）", () => {
    expect(validateDesignerSpecialties(["漸層染", "漸層染"])).toBe("標籤不能重複");
    expect(validateDesignerSpecialties(["漸層染", " 漸層染 "])).toBe("標籤不能重複");
  });
});

describe("normalizeSpecialties", () => {
  it("去前後空白並移除空白標籤", () => {
    expect(normalizeSpecialties([" 漸層染 ", "", "  ", "護髮"])).toEqual(["漸層染", "護髮"]);
  });
});

describe("normalizeInstagramHandle／validateInstagramHandle", () => {
  it("空字串與純空白視為未填（null），驗證通過", () => {
    expect(normalizeInstagramHandle("")).toBeNull();
    expect(normalizeInstagramHandle("   ")).toBeNull();
    expect(validateInstagramHandle("")).toBeNull();
    expect(validateInstagramHandle("@")).toBeNull();
  });
  it("去掉開頭的 @ 與前後空白", () => {
    expect(normalizeInstagramHandle("@mei.hair")).toBe("mei.hair");
    expect(normalizeInstagramHandle("  mei_hair ")).toBe("mei_hair");
  });
  it("英數、底線、句點通過，30 字為上限", () => {
    expect(validateInstagramHandle("mei.hair_01")).toBeNull();
    expect(validateInstagramHandle("a".repeat(30))).toBeNull();
    expect(validateInstagramHandle("a".repeat(31))).toBe("只能使用英文、數字、底線和句點");
  });
  it("含空白、中文、其他符號、網址一律回傳錯誤", () => {
    const message = "只能使用英文、數字、底線和句點";
    expect(validateInstagramHandle("mei hair")).toBe(message);
    expect(validateInstagramHandle("小美")).toBe(message);
    expect(validateInstagramHandle("mei-hair")).toBe(message);
    expect(validateInstagramHandle("https://instagram.com/mei")).toBe(message);
    expect(validateInstagramHandle("javascript:alert(1)")).toBe(message);
    expect(validateInstagramHandle("@@mei")).toBe(message);
  });
});

describe("validateDesignerBio 控制／方向字元（TASK-069）", () => {
  it("允許換行（\n、\r\n）", () => {
    expect(validateDesignerBio("第一行\n第二行")).toBeNull();
    expect(validateDesignerBio("第一行\r\n第二行")).toBeNull();
  });
  it.each([
    ["Tab", "a\tb"],
    ["NUL", "a\u0000b"],
    ["右至左覆寫 U+202E", "a‮b"],
    ["零寬空白 U+200B", "a​b"],
    ["方向隔離 U+2066", "a⁦b"],
  ])("含有 %s 回傳錯誤", (_label, bio) => {
    expect(validateDesignerBio(bio)).toBe("簡介含有不允許的字元");
  });
});

describe("normalizeDesignerBio", () => {
  it("換行統一成 \n、去前後空白", () => {
    expect(normalizeDesignerBio("  第一行\r\n第二行\r第三行  ")).toBe("第一行\n第二行\n第三行");
  });
  it("空白視為未填（null）", () => {
    expect(normalizeDesignerBio("")).toBeNull();
    expect(normalizeDesignerBio("  \n  ")).toBeNull();
  });
  it("NFC 正規化", () => {
    expect(normalizeDesignerBio("é")).toBe("é");
  });
});

describe("instagramProfileUrl", () => {
  it("合法帳號組出固定網域的個人頁網址", () => {
    expect(instagramProfileUrl("mei.hair_01")).toBe("https://www.instagram.com/mei.hair_01/");
  });
  it("null 或格式不符不給連結", () => {
    expect(instagramProfileUrl(null)).toBeNull();
    expect(instagramProfileUrl("")).toBeNull();
    expect(instagramProfileUrl("a/b")).toBeNull();
    expect(instagramProfileUrl("javascript:alert(1)")).toBeNull();
    expect(instagramProfileUrl("a".repeat(31))).toBeNull();
  });
});

describe("isDesignerId", () => {
  it("標準 uuid（大小寫皆可）通過", () => {
    expect(isDesignerId("3f2b8c1e-9d4a-4e6f-8a7b-1c2d3e4f5a6b")).toBe(true);
    expect(isDesignerId("3F2B8C1E-9D4A-4E6F-8A7B-1C2D3E4F5A6B")).toBe(true);
  });
  it.each(["", "abc", "new", "3f2b8c1e-9d4a-4e6f-8a7b-1c2d3e4f5a6", "3f2b8c1e-9d4a-4e6f-8a7b-1c2d3e4f5a6bz", "../etc"])(
    "%j 不通過",
    (id) => {
      expect(isDesignerId(id)).toBe(false);
    },
  );
});
