'use client';
// Chỗ cắm editor cho nút "Edit" (chỉnh vị trí / xoay / zoom ảnh AI đã có, KHÔNG gen lại).
// Mặc định mở PreviewEditor hiện có trong một <dialog>. Editor canvas thật (jpQG86) sau này chỉ cần bọc Personalizer bằng
// <DesignEditorProvider editor={NewEditor}> — cùng DesignEditorProps, Personalizer không phải đổi.
import { createContext, useContext, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import type { DesignView } from '@/lib/types';
import type { Transform } from './api';
import { PreviewEditor } from './PreviewEditor';
import { Icon } from '../shell/Icon';

export type DesignEditorProps = {
  open: boolean;
  onClose: () => void;
  design: DesignView;
  transform: Transform;
  onChange: (t: Transform) => void;
  sizeLabel: string;
  scale: number;
};
export type DesignEditor = ComponentType<DesignEditorProps>;

function PreviewEditorDialog({ open, onClose, ...p }: DesignEditorProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref} aria-labelledby="edit-title" onClose={onClose}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(40rem,calc(100vw-2rem))] max-w-none overflow-y-auto rounded-xl bg-background p-0 text-foreground shadow-xl backdrop:bg-primary/50"
    >
      <div className="flex items-center justify-between border-b border-border py-2 pl-5 pr-2">
        <h2 id="edit-title" className="font-sans text-lg font-semibold">Edit your portrait</h2>
        <button type="button" aria-label="Close editor" onClick={onClose} className="inline-flex size-11 items-center justify-center rounded-full transition-colors hover:bg-muted"><Icon name="x" size={22} /></button>
      </div>
      {open && (
        <div className="space-y-4 p-5">
          <PreviewEditor {...p} />
          <button type="button" onClick={onClose} className="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-primary px-6 font-semibold text-on-primary transition-colors hover:bg-secondary">Done</button>
        </div>
      )}
    </dialog>
  );
}

const EditorContext = createContext<DesignEditor>(PreviewEditorDialog);

export function DesignEditorProvider({ editor, children }: { editor: DesignEditor; children: ReactNode }) {
  return <EditorContext.Provider value={editor}>{children}</EditorContext.Provider>;
}

/** Editor đang cắm + trạng thái mở/đóng cho nút Edit. */
export function useDesignEditor() {
  const Editor = useContext(EditorContext);
  const [open, setOpen] = useState(false);
  return { Editor, open, openEditor: () => setOpen(true), closeEditor: () => setOpen(false) };
}
