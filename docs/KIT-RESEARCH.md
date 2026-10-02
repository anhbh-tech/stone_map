# KIT-2 research: ảnh → bản đồ đá

Ngắn gọn các cách làm tương tự, mạnh/yếu, và cái `lib/kit/place.js` dùng. Tự kiểm: `node tools/bench_kit_place.mjs`.

| Nguồn | Ý chính | Mạnh | Yếu (với tranh đá) | Ta dùng |
|---|---|---|---|---|
| Hausner 2001, *Simulating Decorative Mosaics* (SIGGRAPH) — [pdf](https://www.dgp.toronto.edu/papers/ahausner_SIGGRAPH2001.pdf) | CVT với metric Manhattan xoay theo trường hướng (từ cạnh người dùng chọn) → ô vuông xếp khít theo đường cong | Khít, theo cạnh | Ô vuông, cần GPU z-buffer, cạnh do người chọn | Ý trường hướng bám cạnh + Lloyd ràng buộc (3e) |
| Di Blasi & Gallo 2005, *Artificial mosaics* (Visual Computer) — [springer](https://link.springer.com/article/10.1007/s00371-005-0292-4) | Tự dò biên → distance transform → các đường mức cách đều = đường dẫn đặt tile | Tự động, hàng song song biên rất "tay thợ" | Xa biên các đường mức gặp nhau tạo vết nối | Hàng viền = đường mức dt = r (3b), hàng 2 bên cạnh mạnh (3c) |
| Elber & Wolberg 2003, *Rendering Traditional Mosaics* (Visual Computer) — [researchgate](https://www.researchgate.net/publication/220068154_Rendering_Traditional_Mosaics) | Lấy đường cong đặc trưng, rải hàng tile dọc các đường offset | Hàng liền mạch theo nét | Offset tự cắt nhau, cần xử lý va chạm | Rải đá theo polyline với bước cố định (stonesAlong) |
| Jobard & Lefer 1997, *Evenly-Spaced Streamlines* — [springer](https://link.springer.com/chapter/10.1007/978-3-7091-6876-9_5) | Gieo hạt ở ±dsep cạnh đường có sẵn, dừng khi gần đường khác < dtest | Nhanh, 1 tham số mật độ | Pha đá giữa 2 đường kề không khớp → hụt mật độ | Lấp chính (3d), dsep = p·√3/2, dtest = 0.6·dsep |
| Secord 2002, *Weighted Voronoi Stippling* (NPAR) — [pdf](https://www.cs.ubc.ca/labs/imager/tr/2002/secord2002b/secord.2002b.pdf) | Lloyd trên Voronoi có trọng số mật độ → chấm phân bố đều theo tông | Phân bố blue-noise đẹp | Không có hướng; chấm cùng cỡ đổi mật độ — đá ta mật độ cố định | Lloyd (không trọng số), chỉ dịch ≤ 0.12p, không phá khe cứng |
| Son et al. 2011, *Structure grid for directional stippling* (Graphical Models) — [researchgate](https://www.researchgate.net/publication/220632136_Structure_grid_for_directional_stippling) | 2 mẫu sọc (dọc và vuông góc trường hướng) → giao điểm = lưới gần lục giác/vuông bám hướng | Thẳng hàng hơn Lloyd, gần lục giác | Chỗ trường hướng xoáy/điểm kỳ dị lưới vỡ | Chưa dùng — hướng cải tiến mật độ (xem dưới) |
| Doyle et al. 2019, *Automated pebble mosaic stylization* (CVM) — [arxiv](https://arxiv.org/abs/1902.02806) | SLIC dài theo nội dung → làm tròn thành sỏi | Hình dạng tự do | Sỏi nhiều cỡ, không hợp đá tròn cỡ cố định | — |
| Kim & Pellacini 2002 *Jigsaw Image Mosaics*; Battiato et al. survey — [researchgate](https://www.researchgate.net/publication/220720466_Jigsaw_Image_Mosaics) | Ghép mảnh hình bất kỳ / tổng quan mosaic số | Bối cảnh | Không áp trực tiếp | — |
| Diamond-painting / cross-stitch generators (ArtPatt, MakeBead…) — [artpatt](https://artpatt.com/diamond-painting-pattern-generator) | Lưới vuông cố định, mỗi ô 1 màu DMC gần nhất theo CIEDE2000 | Đơn giản, màu khớp tốt hơn RGB (họ báo 94% vs 61%) | Không theo hướng, không biên đẹp | CIEDE2000 tới bảng màu; giới hạn K mã bằng k-means + Hungarian |
| Lindeberg, *Feature detection with automatic scale selection* — [pdf](https://people.kth.se/~tony/papers/cvap198.pdf); Hough circle ([OpenCV](https://docs.opencv.org/3.4.20/d4/d70/tutorial_hough_circle.html)) | Chọn cỡ blob bằng cực trị LoG chuẩn hoá theo thang; Hough cho tâm + bán kính tròn | Chuẩn, có lý thuyết | LoG nhạy bóng/đốm sáng hạt; Hough cần biên tròn rõ | `estimateGrid`: quét thang, cực đại = tâm hạt, bước = điểm tự nhất quán m(P) = P có dải ổn định dài nhất |

## Kết luận cho place.js

- Pipeline giữ nguyên thứ tự brief (nhấn → viền → cạnh → streamline → Lloyd); research xác nhận đây là tổ hợp chuẩn
  (Di Blasi/Elber–Wolberg cho viền + cạnh, Jobard–Lefer cho phần lông, Lloyd kiểu Secord/Hausner để dàn đều).
- Đổi sau research + tự kiểm: hàng lục giác dsep = p·√3/2 (thay 1.2p chỉnh theo file mẫu — mẫu không phải chuẩn) +
  **lấp khe** circle packing tham lam sau streamline → (d) 0% diện tích còn đặt thêm được viên. Lloyd thêm vòng không
  tăng mật độ (viên đã kẹt ở khe cứng 2.95mm) nên chỉ 1 vòng lấp ↔ Lloyd. Đồ thị láng giềng bỏ cạnh dài > 1.5 bước
  (qua lỗ) để lọc màu lẻ không nối 2 viên xa nhau.
- Mật độ đạt ≈ 70% xếp lục giác lý thuyết (π·1.1² / (√3/2·3²) = 48.8% diện tích) — trên ngưỡng xếp ngẫu nhiên
  (RSA ≈ 60% lục giác) nhưng còn xa 100%: pha đá giữa các streamline kề không khớp. Muốn hơn: structure grid (Son 2011)
  — lưới lục giác cục bộ bám trường hướng, rồi Jobard–Lefer chỉ ở vùng lưới vỡ.
- ΔE00 render-vs-ảnh (mờ 1 bước) 10–15: đổi mật độ 60% → 70% lục giác không đổi ΔE / SSIM, nên nghi do kiểu render
  `clean` của KIT-1 (hạt có bóng, khe tối) và K ≤ 12 mã hơn là vị trí đá — chưa đo tách riêng.
