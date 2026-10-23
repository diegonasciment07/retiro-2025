-- ==========================================================
-- RETIRO KIDS: reabre inscrições de PARTICIPANTES do Brothers Camp
-- ==========================================================
-- Desfaz 20261023_kids_brothers_inscricoes_encerradas.sql: recria
-- kids_registrar_e_atribuir sem a trava (mesma versão de
-- 20260917_kids_atribuicao_apos_pagamento.sql).

create or replace function kids_registrar_e_atribuir(
  p_nome_crianca                text,
  p_data_nascimento             date,
  p_idade                       integer,
  p_sexo                        text,
  p_rede                        text,
  p_igreja                      text,
  p_tipo_evento                 text,
  p_funcao                      text,
  p_responsavel_nome            text,
  p_responsavel_whatsapp        text,
  p_responsavel_parentesco      text,
  p_autorizacao_dados           boolean,
  p_autorizacao_imagem          boolean,
  p_observacoes_saude           text,
  p_contato_emergencia_nome     text,
  p_contato_emergencia_telefone text,
  p_observacoes_responsavel     text
)
returns table (id uuid, nome_crianca text, tipo_evento text, funcao text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into inscricoes_kids (
    nome_crianca, data_nascimento, idade, sexo, rede, igreja,
    tipo_evento, funcao,
    responsavel_nome, responsavel_whatsapp, responsavel_parentesco,
    autorizacao_dados, autorizacao_imagem,
    observacoes_saude,
    contato_emergencia_nome, contato_emergencia_telefone, observacoes_responsavel,
    status_pagamento, status
  ) values (
    p_nome_crianca, p_data_nascimento, p_idade, p_sexo, p_rede, p_igreja,
    p_tipo_evento, coalesce(p_funcao, 'PARTICIPANTE'),
    p_responsavel_nome, p_responsavel_whatsapp, p_responsavel_parentesco,
    coalesce(p_autorizacao_dados, false), coalesce(p_autorizacao_imagem, false),
    p_observacoes_saude,
    p_contato_emergencia_nome, p_contato_emergencia_telefone, p_observacoes_responsavel,
    'PENDENTE', 'ATIVO'
  )
  returning inscricoes_kids.id into v_id;

  -- NÃO chama kids_atribuir_uma aqui de propósito — equipe só é sorteada
  -- depois que o pagamento mínimo é confirmado no balcão (kids.js).

  return query
    select i.id, i.nome_crianca, i.tipo_evento, i.funcao
    from inscricoes_kids i
    where i.id = v_id;
end;
$$;
