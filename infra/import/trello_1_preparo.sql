-- ============================================================================
-- Importação dos quadros do Trello — PASSO 1: preparo (SPEC-FASE2 §E.15)
--
-- Cria a tabela de passagem que recebe o CSV gerado a partir dos quadros
-- exportados (Table Editor → Insert → Import data from CSV). Todas as colunas
-- são texto; a conversão acontece no passo 2. Só o SQL Editor lê estas
-- tabelas (RLS ligado, sem regra de leitura).
--
-- Não contém dado nenhum. Pode rodar mais de uma vez.
-- ============================================================================

create table if not exists import_trello_cards (
  quadro text, trello_id text, titulo text, lista text, lista_ordem text, lista_arquivada text,
  arquivado text, descricao text, etiquetas text, membros text, anexos text, checklists text,
  criado_em text, atualizado_em text, arquivado_em text, ordem text
);
-- O que já foi importado (permite rodar o passo 2 de novo sem duplicar).
create table if not exists import_trello_feito (
  trello_id text primary key, card_id uuid not null, importado_em timestamptz not null default now()
);

alter table import_trello_cards enable row level security;
alter table import_trello_feito enable row level security;
revoke all on import_trello_cards, import_trello_feito from anon, authenticated;
