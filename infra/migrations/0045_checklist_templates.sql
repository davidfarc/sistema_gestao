-- ============================================================================
-- 0045_checklist_templates.sql — Modelos de checklist por pipeline (SPEC-FASE2 §E.11)
--
-- Um modelo guarda o nome e os itens de um checklist para reaproveitar em
-- outros cards do MESMO pipeline. Usar um modelo COPIA os itens para o card:
-- editar o modelo depois não muda os cards que já o usaram.
--
-- Leitura: quem enxerga o pipeline. Escrita só pelo servidor (a gestão do
-- pipeline cria, edita e exclui; quem edita o card usa).
--
-- Só cria a tabela e as regras de acesso. Idempotente.
-- ============================================================================

create table if not exists checklist_template (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organization(id),
  board_id        uuid not null references board(id) on delete cascade,
  name            text not null,
  -- Itens na ordem, como lista de textos: ["Revisar ortografia", "Conferir sumário"].
  items           jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists checklist_template_board_idx on checklist_template (board_id, name);

alter table checklist_template enable row level security;
alter table checklist_template force row level security;

drop policy if exists checklist_template_read on checklist_template;
create policy checklist_template_read on checklist_template for select to authenticated
  using (public.can_see_board(board_id));

revoke all on checklist_template from anon;
revoke insert, update, delete on checklist_template from authenticated;
grant select on checklist_template to authenticated;
