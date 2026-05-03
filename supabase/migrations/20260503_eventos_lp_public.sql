-- Policies publicas para LP de eventos avulsos
-- A LP precisa conseguir ler os dados do evento e registrar a inscricao sem login.

CREATE UNIQUE INDEX IF NOT EXISTS idx_inscricoes_eventos_evento_telefone
  ON inscricoes_eventos (evento_id, telefone)
  WHERE telefone IS NOT NULL AND btrim(telefone) <> '';

DROP POLICY IF EXISTS "public_read_eventos" ON eventos;
CREATE POLICY "public_read_eventos" ON eventos
  FOR SELECT TO anon
  USING (true);

DROP POLICY IF EXISTS "public_insert_inscricoes_eventos" ON inscricoes_eventos;
CREATE POLICY "public_insert_inscricoes_eventos" ON inscricoes_eventos
  FOR INSERT TO anon
  WITH CHECK (true);
