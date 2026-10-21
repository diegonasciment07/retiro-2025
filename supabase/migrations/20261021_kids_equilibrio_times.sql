-- Não redistribui ninguém ao instalar. O rebalanceamento exige prévia e aplicação.
begin;

create or replace function public.kids_atribuir_uma(p_inscricao_id uuid)
returns public.inscricoes_kids
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.inscricoes_kids;
  v_equipe_id uuid;
begin
  select * into v_row from inscricoes_kids where id = p_inscricao_id;
  if not found then raise exception 'Inscrição não encontrada'; end if;
  perform pg_advisory_xact_lock(hashtext(v_row.tipo_evento));
  -- Releitura sob o lock: chamadas simultâneas não usam uma escalação antiga.
  select * into v_row from inscricoes_kids where id = p_inscricao_id for update;
  if v_row.status <> 'ATIVO' or v_row.funcao <> 'PARTICIPANTE'
     or v_row.equipe_id is not null
     or coalesce(nullif(replace(v_row.valor_pago, ',', '.'), ''), '0')::numeric < 100 then
    return v_row;
  end if;

  select e.id into v_equipe_id
  from equipes_kids e
  cross join lateral (
    select count(*) as total,
      count(*) filter (where i.sexo = v_row.sexo) as mesmo_sexo,
      count(*) filter (where i.sexo = v_row.sexo and i.idade = v_row.idade) as mesma_idade_sexo,
      coalesce(sum(i.idade) filter (where i.sexo = v_row.sexo), 0) as soma_idade_sexo,
      coalesce(sum(i.idade), 0) as soma_idade
    from inscricoes_kids i
    where i.equipe_id = e.id and i.status = 'ATIVO' and i.funcao = 'PARTICIPANTE'
  ) c
  where e.tipo_evento = v_row.tipo_evento and e.ativo
  order by c.total, c.mesmo_sexo, c.mesma_idade_sexo,
    c.soma_idade_sexo, c.soma_idade, e.criado_em, e.id
  limit 1;
  if v_equipe_id is not null then
    update inscricoes_kids set equipe_id = v_equipe_id, data_ultima_atualizacao = now()
    where id = p_inscricao_id returning * into v_row;
  end if;
  return v_row;
end;
$$;
revoke all on function public.kids_atribuir_uma(uuid) from public, anon;
grant execute on function public.kids_atribuir_uma(uuid) to authenticated;

-- A assinatura cobre equipes e TODOS os participantes ativos do evento, inclusive
-- os ainda não elegíveis: pagamento, cancelamento ou edição invalidam a prévia.
create or replace function public.kids_preparar_equilibrio(p_tipo_evento text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_equipes jsonb;
  v_participantes jsonb;
begin
  if coalesce(lower(auth.jwt()->>'email'), '') not in ('adm@alvo.com', 'matheus@alvocuritiba.com.br') then
    raise exception 'Sem permissão para equilibrar equipes';
  end if;
  if p_tipo_evento not in ('ACAMPA_KIDS', 'BROTHERS_CAMP') or p_tipo_evento is null then
    raise exception 'Evento inválido';
  end if;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) into v_equipes
  from (select id, tipo_evento, nome_time, professores_responsaveis, ativo
    from equipes_kids where tipo_evento = p_tipo_evento and ativo) t;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) into v_participantes
  from (select id, tipo_evento, nome_crianca, sexo, idade, equipe_id, valor_pago, funcao, status
    from inscricoes_kids where tipo_evento = p_tipo_evento and funcao = 'PARTICIPANTE' and status = 'ATIVO') t;
  return jsonb_build_object('equipes', v_equipes, 'participantes', v_participantes,
    'assinatura', md5(v_equipes::text || v_participantes::text));
end;
$$;
revoke all on function public.kids_preparar_equilibrio(text) from public, anon;
grant execute on function public.kids_preparar_equilibrio(text) to authenticated;

create or replace function public.kids_aplicar_equilibrio(
  p_tipo_evento text, p_assinatura text, p_distribuicao jsonb
)
returns integer language plpgsql security definer set search_path = public
as $$
declare
  v_snapshot jsonb;
  v_elegiveis integer;
  v_changed integer;
begin
  -- Mesma trava usada pela atribuição incremental. Os locks das tabelas impedem
  -- pagamentos, trocas manuais e cadastros de mudar a base durante esta transação.
  if coalesce(lower(auth.jwt()->>'email'), '') not in ('adm@alvo.com', 'matheus@alvocuritiba.com.br') then
    raise exception 'Sem permissão para equilibrar equipes';
  end if;
  perform pg_advisory_xact_lock(hashtext(p_tipo_evento));
  lock table equipes_kids, inscricoes_kids in share row exclusive mode;
  v_snapshot := kids_preparar_equilibrio(p_tipo_evento);
  if p_assinatura is null or p_assinatura <> v_snapshot->>'assinatura' then
    raise exception 'Os dados mudaram. Gere uma nova prévia antes de aplicar.';
  end if;
  if jsonb_typeof(p_distribuicao) is distinct from 'array' then raise exception 'Distribuição inválida'; end if;
  if jsonb_array_length(v_snapshot->'equipes') < 2 then raise exception 'São necessários pelo menos dois times ativos'; end if;
  select count(*) into v_elegiveis from inscricoes_kids
  where tipo_evento = p_tipo_evento and status = 'ATIVO' and funcao = 'PARTICIPANTE'
    and (equipe_id is not null or coalesce(nullif(replace(valor_pago, ',', '.'), ''), '0')::numeric >= 100);
  if jsonb_array_length(p_distribuicao) <> v_elegiveis or
    (select count(distinct id) from jsonb_to_recordset(p_distribuicao) as d(id uuid, equipe_id uuid)) <> v_elegiveis then
    raise exception 'A distribuição deve incluir cada participante elegível exatamente uma vez';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_distribuicao) as d(id uuid, equipe_id uuid)
    left join inscricoes_kids i on i.id = d.id
    left join equipes_kids e on e.id = d.equipe_id
    where i.id is null or e.id is null or not e.ativo or e.tipo_evento <> p_tipo_evento
      or i.tipo_evento <> p_tipo_evento or i.status <> 'ATIVO' or i.funcao <> 'PARTICIPANTE'
      or (i.equipe_id is null and coalesce(nullif(replace(i.valor_pago, ',', '.'), ''), '0')::numeric < 100)
  ) then raise exception 'Participante ou time inválido para este evento'; end if;
  -- Verifica o equilíbrio no servidor, incluindo times que receberiam zero pessoas.
  if exists (
    with counts as (
      select e.id, count(d.id) as total,
        count(i.id) filter (where i.sexo = 'MASCULINO') as meninos,
        count(i.id) filter (where i.sexo = 'FEMININO') as meninas
      from equipes_kids e
      left join jsonb_to_recordset(p_distribuicao) as d(id uuid, equipe_id uuid) on d.equipe_id = e.id
      left join inscricoes_kids i on i.id = d.id
      where e.tipo_evento = p_tipo_evento and e.ativo group by e.id
    ) select 1 from counts having max(total)-min(total) > 1 or max(meninos)-min(meninos) > 1 or max(meninas)-min(meninas) > 1
  ) then raise exception 'A distribuição não está equilibrada em quantidade e gênero'; end if;
  update inscricoes_kids i set equipe_id = d.equipe_id, data_ultima_atualizacao = now()
  from jsonb_to_recordset(p_distribuicao) as d(id uuid, equipe_id uuid)
  where i.id = d.id and i.equipe_id is distinct from d.equipe_id;
  get diagnostics v_changed = row_count;
  return v_changed;
end;
$$;
revoke all on function public.kids_aplicar_equilibrio(text, text, jsonb) from public, anon;
grant execute on function public.kids_aplicar_equilibrio(text, text, jsonb) to authenticated;
commit;
