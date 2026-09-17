-- ==========================================================
-- RETIRO KIDS: limpeza retroativa — desfaz equipe atribuída sem o
-- pagamento mínimo (R$100,00)
-- ==========================================================
-- Antes da regra de pagamento mínimo (ver
-- 20260917_kids_atribuicao_apos_pagamento.sql), toda inscrição feita pelo
-- formulário público já saía sorteada numa equipe com R$0,00 pago. Este
-- UPDATE desfaz essas atribuições feitas sem o mínimo confirmado, pra
-- ficar consistente com a regra nova — essas crianças voltam pra fila de
-- "sem equipe" e são sorteadas de novo assim que baterem o mínimo (no
-- próximo pagamento, ou manualmente via "Atribuir Pendentes").
--
-- Só mexe em quem é PARTICIPANTE (equipe de trabalho nunca tem equipe) e
-- só desfaz quem está abaixo do mínimo — quem já pagou o suficiente
-- mantém a equipe que já tem. Seguro de rodar mais de uma vez.

update inscricoes_kids
set equipe_id = null,
    data_ultima_atualizacao = now()
where funcao = 'PARTICIPANTE'
  and equipe_id is not null
  and coalesce(replace(valor_pago, ',', '.')::numeric, 0) < 100;
