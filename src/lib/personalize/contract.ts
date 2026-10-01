// Hợp đồng v2 giữa backend personalize (crew B) và editor trên PDP (crew C): pearl_store gọi pearl_compare
// (PEARL_COMPARE_URL, mặc định http://localhost:5177) — template theo theme, cutout pearl theo khách, render final.
// File này chỉ có type + hằng số thuần, import được từ client component. Ý nghĩa lớp / transform: docs/OUTPUT.md
// của pearl_compare (§1 thứ tự render base → canvasBg → pet (cắt theo clip) → overlay).
//
// Route (mọi lỗi: { error: { code, message } } + HTTP 4xx/5xx; lỗi engine kèm `fallback`, xem EngineErrorBody):
//   GET  /api/personalize/templates/:theme            → TemplateView (template cố định; urls.empty = slide "khung trống")
//   GET  /api/personalize/templates?product_id=N      → TemplateView của theme sản phẩm (tag style:<theme>)
//                                                       404 no_template · 503 engine_unavailable
//   POST /api/personalize/uploads                     → như cũ { upload_id, url, preflight }
//   POST /api/personalize/designs                     → 201 DesignViewV2; style bỏ trống = theme của sản phẩm
//   GET  /api/personalize/designs/:id                 → DesignViewV2
//   POST /api/personalize/designs/:id/generate        → 202 JobViewV2 (cutout + cảnh theo khách ở pearl_compare)
//   GET  /api/personalize/jobs/:id                    → JobViewV2; poll mỗi 1.5 s tới khi status != queued/running.
//                                                       progress là progress THẬT của pearl_compare (0–1, không giảm)
//   POST /api/personalize/designs/:id/render          { transform: PetTransform } → DesignViewV2 (khách bấm OK:
//                                                       render final phẳng mới, lưu final + transform). 409 not_ready ·
//                                                       502/504 engine_* (kèm fallback)
//   POST /api/personalize/designs/:id/confirm         { confirmed: true } → DesignViewV2 (như cũ; file in từ final)
//   POST /api/personalize/designs/:id/designer        { pet_name?, notes?, email? } → DesignViewV2 (nhánh "Upload
//                                                       original photo for designers": giữ ảnh gốc, chuyển sang
//                                                       designer, status in_review; vào giỏ được ngay)
//   GET  /api/personalize/pc/outputs/templates/<file> → ảnh lớp template của pearl_compare (proxy cùng origin, để
//                                                       canvas không bị taint). Mọi url trong TemplateView đã trỏ về đây.
import type { DesignView, JobView } from '../types';

/** Theme của pearl_compare đang bán. Sản phẩm map qua tag `style:<theme>` (the-starry-king → royal-starry, …). */
export const PC_THEMES = ['royal-starry', 'sunflower-queen', 'cafe-duke'] as const;
export type PcTheme = (typeof PC_THEMES)[number];

/** Điểm [x, y] ở toạ độ pixel của template (size.w × size.h). */
export type Pt = [number, number];

/**
 * Vị trí pet trên template, toạ độ pixel template (OUTPUT.md §1):
 *   x, y    tâm pet; server kẹp vào hình chữ nhật trong của quad
 *   scale   px template / px cutout, [0.01, 20]
 *   rotate  độ, chiều kim đồng hồ, (−180, 180]
 * Vẽ: translate(x, y) → rotate(rotate°) → scale(scale) → drawImage(cutout, −w/2, −h/2), trong vùng cắt `clip`.
 */
export type PetTransform = { x: number; y: number; scale: number; rotate: number };

/** Một template (cố định của theme, hoặc cảnh theo khách `kind: 'scene'`). URL đều cùng origin (proxy /api/personalize/pc). */
export type TemplateView = {
  theme: string;
  rev: string;
  kind: 'theme' | 'scene';
  size: { w: number; h: number };
  quad: [Pt, Pt, Pt, Pt];                   // 4 góc canvas trong khung: tl, tr, br, bl
  clip: Pt[];                               // quad nới 2 px: đa giác cắt lớp canvasBg + pet
  canvas_bg: { w: number; h: number } | null; // cỡ ảnh canvasBg (cho canvasBgTransform); null = không có nền
  urls: {
    base: string;                           // lớp 1, đục
    canvas_bg: string | null;               // lớp 2 (nếu có): phủ kín bbox(clip), giữ tỉ lệ, căn giữa, rotate 0
    overlay: string;                        // lớp 4, trên pet (viền khung, tay, bóng)
    mask: string | null;
    empty: string | null;                   // base + overlay: slide "khung trống"; null với cảnh theo khách
  };
};

/** Pet pearl đã tách nền của khách (PNG RGBA). */
export type CutoutView = {
  url: string;                              // /media/cutouts/… (lưu ở pearl_store, không phụ thuộc pearl_compare)
  w: number; h: number;                     // cỡ ảnh cutout (px)
  default_transform: PetTransform;          // vị trí pearl_compare chọn (nút "reset")
  bottom_cut: boolean;                      // con vật cắt ngang ngực ở mép dưới → nên giữ sát đáy canvas
};

/** Phần v2 của một design AI đã có kết quả. null khi chưa gen xong lần nào, hoặc design designer. */
export type PcDesign = {
  theme: string;
  template: TemplateView;                   // template của final này (cảnh theo khách nếu đạt, không thì cố định)
  cutout: CutoutView;
  transform: PetTransform;                  // vị trí hiện tại (đã chuẩn hoá bởi server); = transform của final_url
  final_url: string;                        // final phẳng hiện tại (= DesignView.preview_url)
  pass: boolean | null;                     // kiểm tra của pearl_compare: cutout đạt VÀ cảnh có đúng con pet thật
  why: string[];                            // lý do không đạt (tiếng Việt, cho admin; không hiện cho khách)
  scene: boolean;                           // true = final vẽ trên cảnh có con pet thật của khách
  rendered_at: string;
};

/** Nhánh dự phòng khi AI lỗi / quá hạn: UI hiện thông báo + nút "Upload original photo for designers". */
export type Fallback = 'designer_upload';

export type DesignViewV2 = DesignView & {
  product_id: number;
  theme: string | null;                     // theme pearl_compare của design (= style)
  pc: PcDesign | null;
};

/** Bước của job theo pearl_compare. */
export type JobStepStage = 'analyze' | 'scene' | 'cutout' | 'fix' | 'final';
export type JobStepView = { stage: JobStepStage; status: 'running' | 'done' | 'error' };

export type JobViewV2 = Omit<JobView, 'design'> & {
  message: string;                          // câu hiện cho khách theo bước hiện tại ("Turning your pet into pearls…")
  steps: JobStepView[];                     // bước pearl_compare đã chạy, theo thứ tự
  fallback: Fallback | null;                // có khi status failed
  design: DesignViewV2 | null;              // có khi succeeded
};

export type RenderBody = { transform: PetTransform };
export type DesignerBody = { pet_name?: string | null; notes?: string | null; email?: string | null };

/** Body lỗi của mọi route khi pearl_compare lỗi / không chạy / quá hạn. */
export type EngineErrorBody = {
  error: { code: 'engine_unavailable' | 'engine_timeout' | 'engine_error' | 'no_template'; message: string };
  fallback: Fallback;
};

/** Câu cho khách theo bước (dùng chung server + UI). */
export const STEP_MESSAGES: Record<JobStepStage | 'queued', string> = {
  queued: 'Waiting for a free pearl artist…',
  analyze: 'Studying your photo…',
  scene: 'Setting up the portrait scene…',
  cutout: 'Turning your pet into pearls…',
  fix: 'Polishing the pearls…',
  final: 'Placing your portrait in the frame…',
};
export const FAILED_MESSAGE =
  "We couldn't create your preview this time. Try again, or upload your original photo and our designers will make it by hand.";
