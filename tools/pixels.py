"""Codec ảnh cho server khi ghép final (JPEG và PNG không phải 8-bit thường mà lib/png.js không đọc được).
Dùng: .venv/bin/python tools/pixels.py decode <ảnh>             → stdout: w, h (uint32 LE) + RGBA
      .venv/bin/python tools/pixels.py encode <ra.jpg> <w> <h>  ← stdin: RGBA"""
import sys
import cv2
import numpy as np

cmd = sys.argv[1]
if cmd == "decode":
    img = cv2.imread(sys.argv[2], cv2.IMREAD_COLOR)
    if img is None:
        sys.exit(f"không đọc được {sys.argv[2]}")
    h, w = img.shape[:2]
    sys.stdout.buffer.write(np.array([w, h], "<u4").tobytes() + cv2.cvtColor(img, cv2.COLOR_BGR2RGBA).tobytes())
elif cmd == "encode":
    out, w, h = sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
    rgba = np.frombuffer(sys.stdin.buffer.read(), np.uint8).reshape(h, w, 4)
    sys.exit(0 if cv2.imwrite(out, cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGR), [cv2.IMWRITE_JPEG_QUALITY, 92]) else "ghi ảnh lỗi")
else:
    sys.exit(f"lệnh lạ: {cmd}")
