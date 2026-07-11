-- ============================================================================
-- 0015_creation_forms.sql — Formulários de criação por pipeline + tipo long_text
--
-- Cada board escolhe um MODO de formulário de criação:
--   'simple'          → só título (comportamento atual)
--   'generic'         → form dirigido por dados (campos com show_on_create)
--   'custom:<chave>'  → componente feito à mão (registro no front, ex. demandas)
-- Campos ganham show_on_create (pedir na criação) e is_required (obrigatório).
-- Novo tipo de propriedade 'long_text' (textarea).
-- Idempotente.
-- ============================================================================

-- ── Modo de formulário por pipeline ──────────────────────────────────────────
alter table board add column if not exists creation_form text not null default 'simple';

-- ── Flags por propriedade ────────────────────────────────────────────────────
alter table field_definition add column if not exists show_on_create boolean not null default false;
alter table field_definition add column if not exists is_required   boolean not null default false;

-- ── Novo tipo long_text no CHECK de field_definition.type ─────────────────────
do $$
declare cname text;
begin
  -- Remove qualquer check constraint sobre a coluna type (nome pode variar).
  for cname in
    select conname from pg_constraint
    where conrelid = 'field_definition'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%type%in%'
  loop
    execute 'alter table field_definition drop constraint ' || quote_ident(cname);
  end loop;
  alter table field_definition add constraint field_definition_type_check
    check (type in ('text','long_text','number','date','select','multi_select',
                    'checkbox','member','link','status'));
end$$;
