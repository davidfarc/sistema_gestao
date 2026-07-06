-- Card pode nascer só com o nome (título); a equipe preenche a taxonomia depois
-- (matéria/série/bimestre) e o código é gerado quando ela estiver completa.
-- Torna a taxonomia e o código OPCIONAIS.

alter table card
  alter column materia_id    drop not null,
  alter column serie_id      drop not null,
  alter column segmento_id   drop not null,
  alter column bimestre      drop not null,
  alter column ano_letivo_id drop not null,
  alter column code          drop not null;
