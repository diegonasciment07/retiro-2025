-- ==========================================================
-- RETIRO KIDS (Acampa Kids + Brothers Camp)
-- ==========================================================
-- Cria as tabelas de equipes, inscrições e pagamentos do retiro
-- infantil/adolescente, junto com as funções de atribuição
-- automática e balanceada de equipes.
--
-- Modelo de preço (validado no client, não fica em coluna):
--   ACAMPA_KIDS   (05-09 anos) participante = R$ 250,00
--   BROTHERS_CAMP (10-14 anos) participante = R$ 300,00
--   TRABALHO (qualquer um dos dois eventos)  = R$ 100,00
-- ==========================================================

-- ── Equipes (times da gincana) ────────────────────────────
create table if not exists equipes_kids (
  id                      uuid primary key default gen_random_uuid(),
  tipo_evento             text not null check (tipo_evento in ('ACAMPA_KIDS','BROTHERS_CAMP')),
  nome_time               text not null,
  professores_responsaveis text,
  cor                     text,
  ativo                   boolean not null default true,
  criado_por              text,
  criado_em               timestamptz not null default now(),
  atualizado_em           timestamptz not null default now()
);

create index if not exists idx_equipes_kids_tipo on equipes_kids (tipo_evento);

-- ── Inscrições (crianças/adolescentes) ────────────────────
create table if not exists inscricoes_kids (
  id                        uuid primary key default gen_random_uuid(),
  nome_crianca              text not null,
  sexo                      text not null check (sexo in ('MASCULINO','FEMININO')),
  idade                     integer not null,
  tipo_evento               text not null check (tipo_evento in ('ACAMPA_KIDS','BROTHERS_CAMP')),
  funcao                    text not null default 'PARTICIPANTE' check (funcao in ('PARTICIPANTE','TRABALHO')),
  responsavel_nome          text not null,
  responsavel_whatsapp      text not null,
  responsavel_parentesco    text,
  email                     text,
  cidade                    text,
  observacoes_saude         text,
  autorizacao_imagem        boolean default false,
  equipe_id                 uuid references equipes_kids(id) on delete set null,
  status_pagamento          text not null default 'PENDENTE' check (status_pagamento in ('PENDENTE','PAGO PARCIALMENTE','PAGO')),
  valor_pago                text default '0,00',
  forma_pagamento           text,
  atendente                 text,
  data_confirmacao_pagamento timestamptz,
  observacoes               text,
  status                    text not null default 'ATIVO' check (status in ('ATIVO','CANCELADO')),
  criado_em                 timestamptz not null default now(),
  data_ultima_atualizacao   timestamptz not null default now()
);

create index if not exists idx_inscricoes_kids_tipo on inscricoes_kids (tipo_evento);
create index if not exists idx_inscricoes_kids_equipe on inscricoes_kids (equipe_id);
create index if not exists idx_inscricoes_kids_status on inscricoes_kids (status);

-- ── Histórico de pagamentos (mesmo modelo do retiro principal) ──
create table if not exists pagamentos_kids (
  id               bigint generated always as identity primary key,
  inscricao_id     uuid not null references inscricoes_kids(id) on delete cascade,
  nome_participante text,
  valor_pago       numeric(10,2) not null,
  forma_pagamento  text not null,
  atendente        text,
  observacoes      text,
  data_pagamento   timestamptz not null default now(),
  criado_em        timestamptz not null default now()
);

create index if not exists idx_pagamentos_kids_inscricao on pagamentos_kids (inscricao_id);

-- ── RLS ────────────────────────────────────────────────────
alter table equipes_kids     enable row level security;
alter table inscricoes_kids  enable row level security;
alter table pagamentos_kids  enable row level security;

-- Atendentes/ADM logados (sistema-balcão) têm acesso total às 3 tabelas.
drop policy if exists "auth_all_equipes_kids" on equipes_kids;
create policy "auth_all_equipes_kids" on equipes_kids
  for all to authenticated using (true) with check (true);

drop policy if exists "auth_all_inscricoes_kids" on inscricoes_kids;
create policy "auth_all_inscricoes_kids" on inscricoes_kids
  for all to authenticated using (true) with check (true);

drop policy if exists "auth_all_pagamentos_kids" on pagamentos_kids;
create policy "auth_all_pagamentos_kids" on pagamentos_kids
  for all to authenticated using (true) with check (true);

-- Leitura pública só do nome/cor dos times ativos (pra mostrar no formulário
-- de inscrição qual equipe a criança pegou). Nenhum dado de criança é exposto
-- por RLS direta — o formulário público só fala com o banco através das
-- funções abaixo (security definer), nunca com INSERT/SELECT direto nas
-- tabelas de inscrição/pagamento.
drop policy if exists "public_read_equipes_kids" on equipes_kids;
create policy "public_read_equipes_kids" on equipes_kids
  for select to anon
  using (ativo = true);

-- ==========================================================
-- Atribuição balanceada de equipe
-- ==========================================================
-- Escolhe, entre as equipes ativas do mesmo tipo_evento, a que tem
-- (nessa ordem de prioridade): menos participantes no total, depois
-- menos participantes do mesmo sexo da criança, depois a mais antiga
-- (desempate estável). Só entram no cálculo/sorteio quem é
-- PARTICIPANTE — quem é TRABALHO (equipe de apoio) não compete e não
-- ocupa vaga em time.
create or replace function kids_atribuir_uma(p_inscricao_id uuid)
returns inscricoes_kids
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row       inscricoes_kids;
  v_equipe_id uuid;
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

  select e.id into v_equipe_id
  from equipes_kids e
  left join lateral (
    select
      count(*) as total,
      count(*) filter (where i.sexo = v_row.sexo) as mesmo_sexo
    from inscricoes_kids i
    where i.equipe_id = e.id and i.status = 'ATIVO'
  ) contagem on true
  where e.tipo_evento = v_row.tipo_evento and e.ativo = true
  order by coalesce(contagem.total, 0) asc,
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

grant execute on function kids_atribuir_uma(uuid) to authenticated;

-- ==========================================================
-- Inscrição pública (chamada pelo formulário anônimo)
-- ==========================================================
-- Faz o INSERT e, se for PARTICIPANTE, já chama kids_atribuir_uma pra
-- sair com a equipe definida. O anon nunca insere direto na tabela —
-- só executa esta função (security definer).
create or replace function kids_registrar_e_atribuir(
  p_nome_crianca           text,
  p_sexo                   text,
  p_idade                  integer,
  p_tipo_evento            text,
  p_funcao                 text,
  p_responsavel_nome       text,
  p_responsavel_whatsapp   text,
  p_responsavel_parentesco text,
  p_email                  text,
  p_cidade                 text,
  p_observacoes_saude      text,
  p_autorizacao_imagem     boolean
)
returns inscricoes_kids
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row inscricoes_kids;
begin
  insert into inscricoes_kids (
    nome_crianca, sexo, idade, tipo_evento, funcao,
    responsavel_nome, responsavel_whatsapp, responsavel_parentesco,
    email, cidade, observacoes_saude, autorizacao_imagem,
    status_pagamento, status
  ) values (
    p_nome_crianca, p_sexo, p_idade, p_tipo_evento, coalesce(p_funcao, 'PARTICIPANTE'),
    p_responsavel_nome, p_responsavel_whatsapp, p_responsavel_parentesco,
    p_email, p_cidade, p_observacoes_saude, coalesce(p_autorizacao_imagem, false),
    'PENDENTE', 'ATIVO'
  )
  returning * into v_row;

  return kids_atribuir_uma(v_row.id);
end;
$$;

grant execute on function kids_registrar_e_atribuir(
  text, text, integer, text, text, text, text, text, text, text, text, boolean
) to anon, authenticated;
