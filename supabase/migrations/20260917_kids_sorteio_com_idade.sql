-- ==========================================================
-- RETIRO KIDS: sorteio de equipe passa a considerar idade
-- ==========================================================
-- Critérios de escolha do time, em ordem de prioridade:
--   1) Time com menos participantes no total (equilíbrio de tamanho)
--   2) Time cuja idade média RESULTANTE (depois de somar essa criança)
--      fique mais próxima da idade média geral do evento (equilíbrio de
--      idade) — a idade média geral é calculada sobre todo mundo
--      inscrito como PARTICIPANTE ativo no mesmo evento, não só quem já
--      tem equipe, pra ter um alvo estável em vez de ficar variando
--      conforme o sorteio avança
--   3) Time com menos gente do mesmo sexo (equilíbrio de sexo)
--   4) Time mais antigo (desempate estável)
--
-- Antes só existiam os critérios 1, 3 (chamado de 2º) e 4; a idade nunca
-- era considerada.

create or replace function kids_atribuir_uma(p_inscricao_id uuid)
returns inscricoes_kids
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row         inscricoes_kids;
  v_equipe_id   uuid;
  v_idade_media numeric;
begin
  select * into v_row from inscricoes_kids where id = p_inscricao_id;
  if not found then
    raise exception 'Inscrição não encontrada: %', p_inscricao_id;
  end if;

  if v_row.funcao <> 'PARTICIPANTE' or v_row.equipe_id is not null then
    return v_row;
  end if;

  -- Serializa por tipo_evento: evita duas inscrições simultâneas lendo a
  -- mesma contagem de equipes e desbalanceando os times.
  perform pg_advisory_xact_lock(hashtext(v_row.tipo_evento));

  select avg(idade) into v_idade_media
  from inscricoes_kids
  where tipo_evento = v_row.tipo_evento
    and funcao = 'PARTICIPANTE'
    and status = 'ATIVO';

  v_idade_media := coalesce(v_idade_media, v_row.idade);

  select e.id into v_equipe_id
  from equipes_kids e
  left join lateral (
    select
      count(*) as total,
      count(*) filter (where i.sexo = v_row.sexo) as mesmo_sexo,
      avg(i.idade) as idade_media_time
    from inscricoes_kids i
    where i.equipe_id = e.id and i.status = 'ATIVO'
  ) contagem on true
  where e.tipo_evento = v_row.tipo_evento and e.ativo = true
  order by
    coalesce(contagem.total, 0) asc,
    abs(
      (coalesce(contagem.idade_media_time, 0) * coalesce(contagem.total, 0) + v_row.idade)
      / (coalesce(contagem.total, 0) + 1)
      - v_idade_media
    ) asc,
    coalesce(contagem.mesmo_sexo, 0) asc,
    e.criado_em asc
  limit 1;

  if v_equipe_id is not null then
    update inscricoes_kids
      set equipe_id = v_equipe_id, data_ultima_atualizacao = now()
      where id = p_inscricao_id
      returning * into v_row;
  end if;

  return v_row;
end;
$$;

-- ==========================================================
-- Redistribuição: quem já estava sorteado é reembaralhado do zero com as
-- regras novas (equipes ficam vazias e são repreenchidas na mesma ordem
-- de inscrição de antes, agora considerando idade).
-- ==========================================================
do $$
declare
  r record;
begin
  update inscricoes_kids
  set equipe_id = null,
      data_ultima_atualizacao = now()
  where funcao = 'PARTICIPANTE'
    and equipe_id is not null;

  for r in
    select id
    from inscricoes_kids
    where funcao = 'PARTICIPANTE'
      and status = 'ATIVO'
      and coalesce(replace(valor_pago, ',', '.')::numeric, 0) >= 100
    order by criado_em asc
  loop
    perform kids_atribuir_uma(r.id);
  end loop;
end $$;
