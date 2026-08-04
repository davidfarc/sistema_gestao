-- 1) Impacto do RICE ganha descrição em cada nível (os números sozinhos não são
--    intuitivos), no mesmo formato da Complexidade: "<score> — <descrição>".
--    O cálculo lê o número antes do travessão (scoreFromLabel no core).
--
--    ⚠️ O manual enviado trazia as tabelas de Tempo, Complexidade e Orçamento,
--    mas NÃO a de Impacto. Usei a escala clássica do RICE mapeada nos valores
--    que já existiam (0,25 a 2). Ajuste os textos se o manual definir outros.
--
-- 2) Agrupa as propriedades do RICE lado a lado na Lista, com o "Orçamento
--    estimado (R$)" junto — ele alimenta o score de orçamento do esforço, então
--    preencher tudo na mesma região é mais eficiente.

do $$
declare
  b record;
  fid uuid;
  opts jsonb;
  o jsonb;
  novo jsonb;
  nome text;
  pos int;
  desc_map jsonb := jsonb_build_object(
    '0,25', 'Mínimo',
    '0.25', 'Mínimo',
    '0,5',  'Baixo',
    '0.5',  'Baixo',
    '1',    'Médio',
    '1,5',  'Alto',
    '1.5',  'Alto',
    '2',    'Muito alto',
    '3',    'Massivo'
  );
begin
  for b in select id from board where creation_form = 'custom:demandas'
  loop
    -- ── 1) Rótulos do Impacto ────────────────────────────────────────────────
    select id, config -> 'options' into fid, opts
      from field_definition
      where board_id = b.id and name = 'RICE - Impacto'
      limit 1;

    if fid is not null and opts is not null then
      novo := '[]'::jsonb;
      for o in select * from jsonb_array_elements(opts)
      loop
        nome := o ->> 'label';
        -- Só acrescenta se ainda não tiver descrição (idempotente).
        if position('—' in nome) = 0 and desc_map ? btrim(nome) then
          o := jsonb_set(o, '{label}', to_jsonb(btrim(nome) || ' — ' || (desc_map ->> btrim(nome))));
        end if;
        novo := novo || jsonb_build_array(o);
      end loop;
      update field_definition
        set config = jsonb_set(config, '{options}', novo)
        where id = fid;
      raise notice 'Impacto: rótulos atualizados.';
    end if;

    -- ── 2) RICE agrupado (orçamento primeiro: alimenta o esforço) ────────────
    select coalesce(max(position), 0) into pos from field_definition where board_id = b.id;
    for nome in
      select unnest(array[
        'Orçamento estimado (R$)',
        'RICE - Alcance',
        'RICE - Impacto',
        'RICE - Confiança (%)',
        'RICE - Tempo (meses)',
        'RICE - Complexidade'
      ])
    loop
      pos := pos + 1;
      update field_definition set position = pos
        where board_id = b.id and name = nome;
    end loop;
  end loop;
end$$;
