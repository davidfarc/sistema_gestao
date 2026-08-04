-- Cargo (função no organograma) do usuário — SEPARADO do papel de permissão.
-- Usado pelo fluxo de aprovação de demandas: define quem pode aprovar cada faixa
-- (Gestor Financeiro / Diretor Administrativo / Diretor Geral etc.).
alter table app_user add column if not exists cargo text;
