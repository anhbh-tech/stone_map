@AGENTS.md

# Pearl Atelier — hướng dẫn cho agent

Đọc `docs/ARCHITECTURE.md` trước tiên: sơ đồ, vùng file của từng module, hợp đồng API, quy ước, và bảng 12 lỗi mogcustom cần sửa.

- Chỉ sửa file trong vùng module của bạn (bảng mục 2). File của lead (`db/schema.sql`, `src/lib/{db,types,settings,catalog,pricing,money,ids,password,seo,reviews}.ts`, `db/migrations/lead_*`, `src/app/layout.tsx`, `globals.css`) chỉ đổi khi thật cần, và ghi rõ lý do trong commit.
- Mọi việc có UI: dùng skill `ui-ux-pro-max` (`.claude/skills/ui-ux-pro-max/SKILL.md`) — tra `scripts/search.py` cho đúng vấn đề và đi hết Pre-Delivery Checklist của skill trước khi báo xong.
- Chạy: `npm run seed` (một lần) → `npm run dev` → http://localhost:3000. Admin: `/admin`, tài khoản `admin` / `admin123`.
- Trước khi báo xong: `npm run typecheck && npm run lint && npm test` sạch, và e2e của phần mình qua (`npm run test:e2e`).
- Không thêm dependency nặng hay script bên thứ ba nếu không cần; ghi lý do nếu thêm.
