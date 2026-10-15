-- Pessoas confirmadas pelo atendente para buscar a criança no fim do retiro.
-- Lista vazia significa que a retirada ainda não foi confirmada no check-in.
-- O responsável da inscrição é apenas uma sugestão na interface, sem backfill.
alter table public.inscricoes_kids
  add column if not exists responsaveis_retirada text[] not null default '{}';

comment on column public.inscricoes_kids.responsaveis_retirada is
  'Nomes das pessoas autorizadas a buscar a criança, confirmados no balcão.';
