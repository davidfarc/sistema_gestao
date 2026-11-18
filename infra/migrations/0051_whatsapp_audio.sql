-- ============================================================================
-- 0051_whatsapp_audio.sql — Áudio no atendimento pelo WhatsApp (SPEC-FASE2 §C)
--
-- O Worker transcreve o áudio e guarda o TEXTO na mensagem já registrada, para
-- o agente ler a conversa inteira. O arquivo de áudio não é guardado.
-- Só vale para mensagem de áudio de pessoa cadastrada. Só chave de servidor.
-- Só cria a função. Idempotente.
-- ============================================================================

create or replace function public.whatsapp_set_transcript(p_provider_id text, p_body text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  update whatsapp_message
     set body = left(coalesce(p_body, ''), 4000)
   where provider_id = p_provider_id and direction = 'in' and kind = 'audio' and user_id is not null;
  get diagnostics n = row_count;
  return n > 0;
end$$;

revoke all on function public.whatsapp_set_transcript(text, text) from public, anon, authenticated;
grant execute on function public.whatsapp_set_transcript(text, text) to service_role;
