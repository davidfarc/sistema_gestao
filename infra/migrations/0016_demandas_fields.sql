-- ============================================================================
-- 0016_demandas_fields.sql — Propriedades do pipeline "Demandas com orçamento"
--
-- Cria os campos que faltam (do formulário antigo de nova demanda) e completa o
-- RICE (corrige as opções do Impacto, adiciona Confiança e Esforço). Idempotente:
-- só insere/ajusta o que ainda não existe. Fase 2 do plano.
-- ============================================================================

do $$
declare
  b_id uuid; org_id uuid; pos int; rec record;
begin
  select id, organization_id into b_id, org_id
    from board where name ilike '%demand%' order by created_at limit 1;
  if b_id is null then
    raise notice 'board de demandas nao encontrado; nada a fazer';
    return;
  end if;
  select coalesce(max(position), 0) into pos from field_definition where board_id = b_id;

  -- Campos simples (number / date / checkbox / long_text)
  for rec in
    select * from (values
      ('Orçamento estimado (R$)',    'number'),
      ('Custo anualizado (R$/ano)',  'number'),
      ('Data pretendida',            'date'),
      ('Compra recorrente',          'checkbox'),
      ('Fornecedor único',           'checkbox'),
      ('Fora do orçamento planejado','checkbox'),
      ('Reversibilidade baixa',      'checkbox'),
      ('Fracionamento (30 dias)',    'checkbox'),
      ('É lista de compras?',        'checkbox'),
      ('Justificativa',              'long_text'),
      ('Cotações / evidências',      'long_text'),
      ('RICE - Confiança (%)',       'number'),
      ('RICE - Esforço',             'number')
    ) as t(nm, tp)
  loop
    if not exists (select 1 from field_definition where board_id = b_id and name = rec.nm) then
      pos := pos + 1;
      insert into field_definition
        (organization_id, board_id, name, type, config, show_on_card_face,
         is_filterable, position, show_on_create, is_required)
      values (org_id, b_id, rec.nm, rec.tp, '{}'::jsonb, false, true, pos, false, false);
    end if;
  end loop;

  -- Risco percebido (select com 5 níveis)
  if not exists (select 1 from field_definition where board_id = b_id and name = 'Risco percebido') then
    pos := pos + 1;
    insert into field_definition
      (organization_id, board_id, name, type, config, show_on_card_face,
       is_filterable, position, show_on_create, is_required)
    values (org_id, b_id, 'Risco percebido', 'select',
      '{"options":[{"id":"opt0","label":"Muito baixo","color":"#047857"},{"id":"opt1","label":"Baixo","color":"#0891b2"},{"id":"opt2","label":"Moderado","color":"#b45309"},{"id":"opt3","label":"Alto","color":"#ba1a1a"},{"id":"opt4","label":"Muito alto","color":"#7c3aed"}]}'::jsonb,
      false, true, pos, false, false);
  end if;

  -- Corrige as opções do RICE - Impacto (vírgulas decimais quebradas)
  update field_definition
    set config = '{"options":[{"id":"opt0","label":"0,25","color":"#1d4ed8"},{"id":"opt1","label":"0,5","color":"#047857"},{"id":"opt2","label":"1","color":"#b45309"},{"id":"opt3","label":"1,5","color":"#ba1a1a"},{"id":"opt4","label":"2","color":"#7c3aed"}]}'::jsonb
    where board_id = b_id and name = 'RICE - Impacto';
end$$;
