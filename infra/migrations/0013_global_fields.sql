-- ============================================================================
-- 0013_global_fields.sql — Propriedades globais (compartilhadas entre pipelines)
--
-- Uma propriedade (field_definition) com board_id NULO é GLOBAL: aparece em
-- todos os pipelines da organização. As demais seguem independentes por
-- pipeline (board_id preenchido). Idempotente.
-- ============================================================================

alter table field_definition alter column board_id drop not null;

-- RLS: além dos campos do board visível, liberar os GLOBAIS (board_id nulo) da org.
drop policy if exists field_definition_read on field_definition;
create policy field_definition_read on field_definition for select to authenticated
  using (
    (field_definition.board_id is null
       and field_definition.organization_id = public.current_org())
    or public.can_see_board(field_definition.board_id)
  );
