-- Alçada por PROPRIEDADE: quem pode editar/marcar um campo.
--
-- Caso típico (pipeline editorial): só a coordenação pode marcar o checkbox
-- "Aprovado". Combinado com um workflow_rule `field_filled`, isso vira o fluxo
-- de aprovação: a etapa só avança quando a pessoa certa marca o campo.
--
-- Lista VAZIA = qualquer um que possa editar o card (comportamento atual).
-- Escape hatch: quem administra alçadas pode se incluir na lista a qualquer
-- momento — por isso não há override implícito de Gestor no runtime.
alter table field_definition
  add column if not exists allowed_editors uuid[] not null default '{}';
