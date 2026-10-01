# Ghi chú cho UI-2 từ phê bình UI-1 (2026-10-01)

Tìm thấy khi đi hành trình khách ở `docs/critique/ui1-shell.md`; thuộc vùng UI-2 nên UI-1 không sửa. Ảnh ở `.impeccable/critique/ui1-shell/`.

| Mức | Chỗ | Tái hiện | Ảnh | Vì sao | Đề xuất |
|---|---|---|---|---|---|
| P1 | `/search` xếp hạng | `/search?q=dog` ở 375 | a-375-oos-search-dog | 11 kết quả, 7 sản phẩm "Demo" đứng trên 3 sản phẩm theme thật | Đẩy sản phẩm không demo lên trước (hoặc ẩn demo khi đã có sản phẩm thật) |
| P2 | `SearchBox` header | Đo ô search ở 375 | a-375-search-suggest | Cao 42 px, dưới chuẩn 44 px của DESIGN.md | `min-h-11` |
