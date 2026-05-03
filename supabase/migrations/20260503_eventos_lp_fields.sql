-- Campos adicionais para ficha publica dos eventos avulsos

ALTER TABLE inscricoes_eventos
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS ja_foi_retiro boolean;
