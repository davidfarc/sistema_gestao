-- ============================================================================
-- Importação do sistema antigo "Produção Pedagógica" — PASSO 1: preparo
-- (SPEC-FASE2 §E.12)
--
-- Cria quatro tabelas de passagem, vazias, para receber os CSVs exportados do
-- Supabase antigo (Table Editor → Insert → Import data from CSV). Todas as
-- colunas são texto: a conversão acontece no passo 2. Ninguém além do SQL
-- Editor lê estas tabelas (RLS ligado, sem nenhuma regra de leitura).
--
-- Não contém dado nenhum. Pode rodar mais de uma vez.
-- ============================================================================

create table if not exists import_pp_membros (
  email text, nome text, ativo text, criado_em text
);
create table if not exists import_pp_materiais (
  id text, membro_email text, nome text, segmento text, tipo text, inicio text, prazo text,
  fim text, status text, link_autor text, atribuido text, historico text, entrega_em text,
  criado_em text, atualizado_em text
);
create table if not exists import_pp_pareceres (
  material_id text, situacao text, emendas text, comentarios text, atualizado_em text
);
create table if not exists import_pp_diario (
  membro_email text, dia text, texto text, atualizado_em text
);
-- O que já foi importado (permite rodar o passo 2 de novo sem duplicar).
create table if not exists import_pp_feito (
  material_id text primary key, card_id uuid not null, importado_em timestamptz not null default now()
);

alter table import_pp_membros   enable row level security;
alter table import_pp_materiais enable row level security;
alter table import_pp_pareceres enable row level security;
alter table import_pp_diario    enable row level security;
alter table import_pp_feito     enable row level security;
revoke all on import_pp_membros, import_pp_materiais, import_pp_pareceres, import_pp_diario, import_pp_feito
  from anon, authenticated;
