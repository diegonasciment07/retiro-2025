-- ==========================================================
-- RETIRO KIDS: simplifica a ficha de saúde em um único campo
-- ==========================================================
-- A migration anterior (20260917_kids.sql) já foi aplicada em produção,
-- então esta é uma migration NOVA (não edita a antiga) que consolida
-- Restrição Alimentar / Alergias / Uso de Medicamentos / Necessidade
-- Especial num único campo de texto livre "observacoes_saude" — a
-- ficha estava muito extensa com 4 campos separados.
--
-- Quem já tinha respondido algo nesses 4 campos não perde a informação:
-- ela é combinada numa única observação antes das colunas serem
-- removidas.
-- ==========================================================

alter table inscricoes_kids add column if not exists observacoes_saude text;

update inscricoes_kids
set observacoes_saude = nullif(concat_ws(' | ',
    case when restricao_alimentar is not null and btrim(restricao_alimentar) <> '' then 'Restrição alimentar: ' || restricao_alimentar end,
    case when alergias is not null and btrim(alergias) <> '' then 'Alergias: ' || alergias end,
    case when uso_medicamentos is not null and btrim(uso_medicamentos) <> '' then 'Medicamentos: ' || uso_medicamentos end,
    case when necessidade_especial is not null and btrim(necessidade_especial) <> '' then 'Necessidade especial: ' || necessidade_especial end
), '')
where observacoes_saude is null;

alter table inscricoes_kids drop column if exists restricao_alimentar;
alter table inscricoes_kids drop column if exists alergias;
alter table inscricoes_kids drop column if exists uso_medicamentos;
alter table inscricoes_kids drop column if exists necessidade_especial;

-- Precisa recriar a função com a assinatura antiga removida primeiro —
-- "create or replace" não permite mudar a lista de parâmetros.
drop function if exists kids_registrar_e_atribuir(
  text, date, integer, text, text, text, text, text,
  text, text, text, boolean, boolean,
  text, text, text, text, text, text, text
);

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

  perform kids_atribuir_uma(v_id);

  return query
    select i.id, i.nome_crianca, i.tipo_evento, i.funcao
    from inscricoes_kids i
    where i.id = v_id;
end;
$$;

grant execute on function kids_registrar_e_atribuir(
  text, date, integer, text, text, text, text, text,
  text, text, text, boolean, boolean,
  text, text, text, text
) to anon, authenticated;
