-- Campos de pagamento para fechamento de caixa dos eventos avulsos
ALTER TABLE inscricoes_eventos
  ADD COLUMN IF NOT EXISTS pago boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS valor_pago numeric(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS forma_pagamento text; -- PIX | DINHEIRO | CARTAO
