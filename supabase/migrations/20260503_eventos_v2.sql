-- Adiciona coluna de imagem aos eventos
ALTER TABLE eventos ADD COLUMN IF NOT EXISTS imagem_url text;

-- Remove restrição de evento único ativo (agora permite múltiplos simultâneos)
DROP INDEX IF EXISTS idx_eventos_unico_ativo;
