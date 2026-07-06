-- Anexo = um link de QUALQUER origem, com um título. Relaxa o "kind" (antes só
-- aceitava drive_link/emenda) e passa a default 'link'.
alter table attachment drop constraint if exists attachment_kind_check;
alter table attachment alter column kind set default 'link';
