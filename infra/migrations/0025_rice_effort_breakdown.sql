-- Destrincha o Esforço do RICE nas três variáveis do manual de boas práticas:
--   Effort = Tempo + Complexidade + Orçamento   (SOMA — confirmado pelo exemplo
--   do próprio manual: 2 + 4 + 2 = 8. A doc antiga dizia "multiplicação", errado.)
--
-- A) Tempo (pedido → entrega), em MESES: até 1 mês = 1, até 2 = 2, até 3 = 3…
--    Demandas muito rápidas ganham score decimal (ex.: 0,5 para duas semanas).
--    Por ser aberto, é um número — não uma lista fechada.
-- B) Complexidade: 1 a 4, com a descrição de cada nível.
-- C) Orçamento: derivado do "Orçamento estimado (R$)" que já existe — até 10k=1,
--    10k–50k=2, acima de 50k=3. Não vira campo: evita digitar o mesmo dado duas
--    vezes e ficar inconsistente com o valor informado.
--
-- O campo "RICE - Esforço" sai de cena (decisão: substituir de vez). Os valores
-- antigos vão junto — o número anterior não é convertível nas três partes.

do $$
declare
  b record;
  org_id uuid;
  pos int;
  old_id uuid;
begin
  for b in select id, organization_id from board where creation_form = 'custom:demandas'
  loop
    org_id := b.organization_id;
    select coalesce(max(position), 0) into pos from field_definition where board_id = b.id;

    -- A) Tempo em meses
    if not exists (select 1 from field_definition where board_id = b.id and name = 'RICE - Tempo (meses)') then
      pos := pos + 1;
      insert into field_definition
        (organization_id, board_id, name, type, config, show_on_card_face,
         is_filterable, position, show_on_create, is_required)
      values (org_id, b.id, 'RICE - Tempo (meses)', 'number', '{}'::jsonb, false, true, pos, false, false);
    end if;

    -- B) Complexidade (1–4, com a descrição de cada nível)
    if not exists (select 1 from field_definition where board_id = b.id and name = 'RICE - Complexidade') then
      pos := pos + 1;
      insert into field_definition
        (organization_id, board_id, name, type, config, show_on_card_face,
         is_filterable, position, show_on_create, is_required)
      values (
        org_id, b.id, 'RICE - Complexidade', 'select',
        jsonb_build_object('options', jsonb_build_array(
          jsonb_build_object('id', gen_random_uuid()::text, 'color', '#047857',
            'label', '1 — Compra direta: 1 responsável, sem validação técnica, 1 fornecedor'),
          jsonb_build_object('id', gen_random_uuid()::text, 'color', '#1d4ed8',
            'label', '2 — 2–3 pessoas/áreas OU cotação simples OU validação leve'),
          jsonb_build_object('id', gen_random_uuid()::text, 'color', '#b45309',
            'label', '3 — Múltiplas áreas + critérios técnicos + negociação + comparação'),
          jsonb_build_object('id', gen_random_uuid()::text, 'color', '#ba1a1a',
            'label', '4 — Contrato/renovação, aprovadores críticos, dependência externa, escopo móvel')
        )),
        false, true, pos, false, false
      );
    end if;

    -- Remove o Esforço antigo (os valores caem em cascata).
    select id into old_id from field_definition
      where board_id = b.id and name = 'RICE - Esforço' limit 1;
    if old_id is not null then
      delete from field_value where field_definition_id = old_id;
      delete from field_definition where id = old_id;
      raise notice 'Pipeline %: campo "RICE - Esforço" removido.', b.id;
    end if;
  end loop;
end$$;
