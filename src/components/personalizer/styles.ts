// Style chọn được trên PDP. Sản phẩm theme (tag `style:<theme>`) chỉ in đúng theme đó → picker chỉ còn style của theme,
// chọn sẵn; theme không có trong settings → giữ cả danh sách (server vẫn khoá theo theme, xem lib/personalize/validate.ts).
import type { Settings } from '@/lib/types';

type Style = Settings['ai']['styles'][number];

export function stylesFor(styles: Style[], theme: string | null | undefined): Style[] {
  const own = theme ? styles.filter((s) => s.id === theme) : [];
  return own.length ? own : styles;
}
