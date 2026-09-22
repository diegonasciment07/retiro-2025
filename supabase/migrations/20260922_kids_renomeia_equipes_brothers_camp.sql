-- ==========================================================
-- RETIRO KIDS: renomeia as equipes do Brothers Camp (5 → 4 times)
-- ==========================================================
-- Mudança de estrutura pedida pelo Diego: os 5 times de animal+cor viram
-- 4 times de nome de professor+cor, e o time amarelo deixa de existir.
--
-- Match por cor (ILIKE), não pelo nome completo — mais seguro contra
-- qualquer diferença de acentuação/caixa no nome atual gravado no banco.
-- Só mexe em equipes do BROTHERS_CAMP.

update equipes_kids
set nome_time = 'Mateus Vermelhos',
    professores_responsaveis = 'Gean e Carla',
    cor = '🔴',
    atualizado_em = now()
where tipo_evento = 'BROTHERS_CAMP' and nome_time ilike '%vermelh%';

update equipes_kids
set nome_time = 'Marcos Verdes',
    professores_responsaveis = 'Guilherme e Paula',
    cor = '🟢',
    atualizado_em = now()
where tipo_evento = 'BROTHERS_CAMP' and nome_time ilike '%verd%';

update equipes_kids
set nome_time = 'Lucas Laranjas',
    professores_responsaveis = 'Wagner e Luana',
    cor = '🟠',
    atualizado_em = now()
where tipo_evento = 'BROTHERS_CAMP' and nome_time ilike '%laranj%';

update equipes_kids
set nome_time = 'João Azuis',
    professores_responsaveis = 'Celso e Paty',
    cor = '🔵',
    atualizado_em = now()
where tipo_evento = 'BROTHERS_CAMP' and nome_time ilike '%azu%';

-- Exclui a equipe amarela — quem estava nela fica sem equipe automaticamente
-- (equipe_id tem "on delete set null"), sem apagar a inscrição de ninguém.
delete from equipes_kids
where tipo_evento = 'BROTHERS_CAMP' and nome_time ilike '%amarel%';

-- Redistribui quem ficou sem equipe (os ex-Gorilas Amarelos, e qualquer
-- outro pendente elegível) entre as 4 equipes que restaram, usando o
-- mesmo sorteio balanceado de sempre (tamanho → idade → sexo → mais antigo).
do $$
declare
  r record;
begin
  for r in
    select id
    from inscricoes_kids
    where tipo_evento = 'BROTHERS_CAMP'
      and funcao = 'PARTICIPANTE'
      and status = 'ATIVO'
      and equipe_id is null
      and coalesce(replace(valor_pago, ',', '.')::numeric, 0) >= 100
    order by criado_em asc
  loop
    perform kids_atribuir_uma(r.id);
  end loop;
end $$;
