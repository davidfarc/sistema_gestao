"use server";

import { requireActor } from "@/lib/actor";
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "card-images";
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED = ["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"];

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/**
 * Sobe uma imagem colada na descrição e devolve a URL pública.
 * O caminho é um UUID aleatório (não adivinhável). Validação de tipo e tamanho
 * é feita AQUI, no servidor — o cliente nunca é fonte de verdade.
 */
export async function uploadCardImage(
  formData: FormData,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  await requireActor("card:update");

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "Arquivo inválido." };
  if (!ALLOWED.includes(file.type)) {
    return { ok: false, error: "Formato não suportado (use PNG, JPG, GIF ou WEBP)." };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "Imagem muito grande (máximo 10 MB)." };
  }

  const path = `${crypto.randomUUID()}.${EXT[file.type] ?? "png"}`;
  const db = createAdminClient();
  const { error } = await db.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) return { ok: false, error: error.message };

  const { data } = db.storage.from(BUCKET).getPublicUrl(path);
  return { ok: true, url: data.publicUrl };
}
