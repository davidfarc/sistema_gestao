"use client";

import Image from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import clsx from "clsx";
import { Bold, ImagePlus, Italic, List, ListChecks } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { uploadCardImage } from "@/lib/board/upload";

/**
 * Editor da descrição: propositalmente mínimo (negrito, itálico, lista) — não
 * é para virar editor de blog. O ganho principal é colar/arrastar imagem, que
 * sobe para o Storage e aparece inline, como no Notion.
 *
 * O HTML é gerado e relido pelo schema do Tiptap, que descarta o que não estiver
 * previsto — colar do Word/web não traz lixo nem script.
 */
export function RichDescriptionEditor({
  value,
  onSave,
  placeholder = "Adicione uma descrição… (cole imagens aqui)",
}: {
  value: string;
  onSave: (html: string) => void;
  placeholder?: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Guarda o último HTML salvo para não gravar à toa no blur.
  const savedRef = useRef(value);

  const upload = useCallback(
    async (file: File, editor: Editor) => {
      setUploading(true);
      setError(null);
      const fd = new FormData();
      fd.append("file", file);
      const res = await uploadCardImage(fd);
      setUploading(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      editor.chain().focus().setImage({ src: res.url }).run();
      onSave(editor.getHTML());
      savedRef.current = editor.getHTML();
    },
    [onSave],
  );

  const editor = useEditor({
    // Sem isto o Next reclama de hidratação (render no servidor vs cliente).
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false, // sem títulos — evita cara de editor de post
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
      }),
      Image.configure({ inline: false, allowBase64: false }),
      // Checklist DENTRO do texto — acompanhamento leve da demanda. É diferente
      // do checklist-propriedade do card, que mede progresso da tarefa.
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content: value || "",
    editorProps: {
      attributes: {
        // O layout do checklist vive em globals.css (.ecco-editor) — a estrutura
        // aninhada do TaskItem não é alcançável por variantes do Tailwind.
        class:
          "ecco-editor prose-sm min-h-24 max-w-none rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-700 outline-none focus:border-neutral-400 " +
          "[&_img]:my-2 [&_img]:max-w-full [&_img]:rounded-lg [&_p]:min-h-5 " +
          "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5",
        "data-placeholder": placeholder,
      },
      handlePaste: (view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        const img = files.find((f) => f.type.startsWith("image/"));
        if (img && editor) {
          event.preventDefault();
          void upload(img, editor);
          return true;
        }
        return false;
      },
      handleDrop: (view, event) => {
        const files = Array.from((event as DragEvent).dataTransfer?.files ?? []);
        const img = files.find((f) => f.type.startsWith("image/"));
        if (img && editor) {
          event.preventDefault();
          void upload(img, editor);
          return true;
        }
        return false;
      },
    },
    onBlur: ({ editor }) => {
      const html = editor.getHTML();
      if (html !== savedRef.current) {
        savedRef.current = html;
        onSave(html);
      }
    },
  });

  if (!editor) {
    return <div className="min-h-24 rounded-lg border border-neutral-200 bg-neutral-50" />;
  }

  const btn = (active: boolean) =>
    clsx(
      "rounded p-1 transition-colors",
      active ? "bg-neutral-200 text-neutral-800" : "text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700",
    );

  return (
    <div>
      <div className="mb-1 flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={btn(editor.isActive("bold"))}
          title="Negrito (Ctrl+B)"
          aria-label="Negrito"
        >
          <Bold className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={btn(editor.isActive("italic"))}
          title="Itálico (Ctrl+I)"
          aria-label="Itálico"
        >
          <Italic className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={btn(editor.isActive("bulletList"))}
          title="Lista"
          aria-label="Lista"
        >
          <List className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleTaskList().run()}
          className={btn(editor.isActive("taskList"))}
          title="Checklist"
          aria-label="Checklist"
        >
          <ListChecks className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className={btn(false)}
          title="Inserir imagem"
          aria-label="Inserir imagem"
        >
          <ImagePlus className="h-3.5 w-3.5" />
        </button>
        {uploading && <span className="ml-1 text-[11px] text-neutral-400">enviando imagem…</span>}
        {error && <span className="ml-1 text-[11px] text-red-600">{error}</span>}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f, editor);
          e.target.value = "";
        }}
      />

      <EditorContent editor={editor} />
    </div>
  );
}
