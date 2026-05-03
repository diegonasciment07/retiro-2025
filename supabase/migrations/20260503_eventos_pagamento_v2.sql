-- Rastreamento de quem confirmou o pagamento e quando
ALTER TABLE inscricoes_eventos
  ADD COLUMN IF NOT EXISTS pago_por text,
  ADD COLUMN IF NOT EXISTS pago_em timestamptz;
