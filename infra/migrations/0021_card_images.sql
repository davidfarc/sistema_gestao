-- Bucket para as imagens coladas na descrição do card (peças de marketing etc.).
--
-- Público de propósito: a URL fica embutida no HTML da descrição e precisa
-- funcionar sempre, sem expirar. O caminho é um UUID aleatório — não é
-- adivinhável —, mas quem tiver o link enxerga a imagem sem estar logado.
--
-- O UPLOAD é sempre server-side com a service_role (que ignora RLS); por isso
-- só a leitura pública precisa de policy.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'card-images',
  'card-images',
  true,
  10485760, -- 10 MB
  array['image/png','image/jpeg','image/jpg','image/gif','image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "card_images_public_read" on storage.objects;
create policy "card_images_public_read" on storage.objects
  for select using (bucket_id = 'card-images');
