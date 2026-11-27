-- ============================================================================
-- 0064_student_guardian_four.sql — Até 4 responsáveis por aluno
--
-- Ordem (igual ao relatório do ActiveSoft): filiação 1, filiação 2 e, só quando
-- forem outras pessoas, o responsável financeiro e o pedagógico.
-- Idempotente. Aplicar DEPOIS da 0063.
-- ============================================================================

alter table student_guardian drop constraint if exists student_guardian_slot_check;
alter table student_guardian add constraint student_guardian_slot_check check (slot between 1 and 4);
