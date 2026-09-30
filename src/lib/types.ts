// Hợp đồng dữ liệu giữa các module. Đổi file này = đổi hợp đồng → báo lead trước.

// ── Settings: nguồn sự thật duy nhất (#3). Mọi câu chữ về ship / khung / số liệu đọc từ đây, không hard-code.
export type Settings = {
  shop: { name: string; support_email: string; currency: 'USD' };
  shipping: {
    regions: string[];                 // ['US'] — banner & trang policy đều sinh từ đây
    free_over_cents: number | null;    // null = không free ship
    standard: { price_cents: number; min_days: number; max_days: number };
    express: { price_cents: number; min_days: number; max_days: number };
    production_days: number;           // cộng vào ngày giao dự kiến
  };
  claims: { customers_count: number | null; rating: number | null; reviews_count: number | null }; // null = không hiển thị
  privacy: { retention_days: number; processors: string[]; policy_path: string };
  ai: {
    provider: 'mock' | 'gemini' | 'openai';
    model: string;
    mock_ms: number;                   // thời gian giả lập của provider mock
    styles: { id: string; name: string }[];
  };
  preflight: { min_side_px: number; min_sharpness: number; min_pet_confidence: number };
};

// ── Personalization
export type Preflight = {
  ok: boolean;                          // false → không cho chạy AI, gợi ý designer mode
  width: number; height: number;
  sharpness: number;                    // variance of Laplacian trên ảnh 512px
  pet: { found: boolean; species: string | null; confidence: number; box: [number, number, number, number] | null }; // box 0–1 [x0,y0,x1,y1]
  issues: PreflightIssue[];
};
export type PreflightIssue =
  | { code: 'too_small'; message: string }
  | { code: 'blurry'; message: string }
  | { code: 'no_pet'; message: string }
  | { code: 'multiple_pets'; message: string }
  | { code: 'face_hidden'; message: string };

export type DesignStatus = 'draft' | 'generating' | 'ready' | 'failed' | 'confirmed' | 'in_review' | 'approved' | 'rejected';
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
export type JobStage = 'queued' | 'analyzing' | 'generating' | 'checking' | 'rendering';

/** GET /api/personalize/jobs/:id — trình duyệt poll mỗi 1.5s. */
export type JobView = {
  id: string;
  design_id: string;
  status: JobStatus;
  stage: JobStage | null;
  queue_position: number | null;        // số job đứng trước
  elapsed_ms: number;
  eta_ms: number;                        // ước lượng từ p75 thời gian thật của 50 job gần nhất (#2) — không phải số cố định
  progress: number;                      // 0–1 = elapsed/(elapsed+eta), không bao giờ đứng ở 0.99
  error: string | null;
  design: DesignView | null;             // có khi succeeded
};

export type DesignView = {
  id: string;
  mode: 'ai' | 'designer';
  status: DesignStatus;
  style: string | null;
  pet_name: string | null;
  notes: string | null;
  upload_url: string | null;             // ảnh gốc khách gửi (để so cạnh ảnh AI, #1)
  preview_url: string | null;
  mockup_url: string | null;
  print_url: string | null;              // chỉ admin/xưởng thấy
  confirmed: boolean;
};

// ── Cart: property bắt đầu bằng "_" là ẩn với khách (#5), giống quy ước Shopify.
export type LineProperties = Record<string, string> & {
  _design_id?: string;
  _preview_url?: string;
  _print_url?: string;
  'Pet name'?: string;
  Style?: string;
};
export const visibleProps = (p: Record<string, string>) =>
  Object.fromEntries(Object.entries(p).filter(([k]) => !k.startsWith('_')));
