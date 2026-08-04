-- Quem pode abrir demandas num pipeline: agora dá para nomear pessoas.
--
-- A 0028 trouxe a chave em dois estados (só membros / toda a equipe). Faltava o
-- caso do meio, que é o mais comum na prática: "a coordenação pedagógica e o
-- financeiro podem pedir para a TI; o resto não".
--
-- `intake` ganha o valor 'users', e a lista vive em `intake_user_ids`. Guardo
-- como array na própria linha do board, e não em tabela de junção, porque é
-- sempre lido junto com o board e nunca consultado ao contrário ("em quais
-- pipelines fulano pode abrir demanda?" não é uma pergunta do produto).

alter table board add column if not exists intake_user_ids uuid[] not null default '{}';

alter table board drop constraint if exists board_intake_check;
alter table board add constraint board_intake_check
  check (intake in ('members', 'org', 'users'));

comment on column board.intake is
  'members = so quem tem acesso ao pipeline abre o formulario (padrao); '
  'org = qualquer pessoa interna; '
  'users = apenas as pessoas listadas em intake_user_ids.';

comment on column board.intake_user_ids is
  'Usado apenas quando intake = users. Quem esta na lista abre o formulario '
  'e enxerga somente as proprias solicitacoes.';
