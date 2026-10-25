-- ==========================================================
-- RETIRO ADULTOS: reinicia a numeração (id) das inscrições e pagamentos
-- ==========================================================
-- Os dados da edição anterior foram removidos em 25/10/2026 (backup em
-- backups/retiro_adultos_*.json). Esta migration só reinicia os contadores
-- para que a próxima inscrição seja a número 1.
-- Não toca em inscricoes_kids, pagamentos_kids, equipes_kids, eventos nem
-- inscricoes_eventos. Rode SOMENTE com as duas tabelas vazias.

do $$
begin
  if (select count(*) from public.inscricoes) <> 0
     or (select count(*) from public."pagamentos_históricos") <> 0 then
    raise exception 'Tabelas não estão vazias: nada foi alterado.';
  end if;
end $$;

select setval(pg_get_serial_sequence('public.inscricoes', 'id'), 1, false);
select setval(pg_get_serial_sequence('public."pagamentos_históricos"', 'id'), 1, false);
