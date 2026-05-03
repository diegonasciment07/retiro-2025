-- Tabela de eventos avulsos
CREATE TABLE IF NOT EXISTS eventos (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nome        text NOT NULL,
  data        date,
  descricao   text,
  capacidade  integer DEFAULT 0,          -- 0 = ilimitado
  gratuito    boolean DEFAULT true,
  valor       numeric(10,2) DEFAULT 0,
  ativo       boolean DEFAULT false,
  criado_por  text,
  criado_em   timestamptz DEFAULT now(),
  atualizado_em timestamptz DEFAULT now()
);

-- Garante apenas um evento ativo por vez
CREATE UNIQUE INDEX IF NOT EXISTS idx_eventos_unico_ativo
  ON eventos (ativo)
  WHERE ativo = true;

-- Tabela de inscrições dos eventos avulsos
CREATE TABLE IF NOT EXISTS inscricoes_eventos (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  evento_id   uuid REFERENCES eventos(id) ON DELETE CASCADE,
  nome        text NOT NULL,
  telefone    text,
  rede        text,
  observacao  text,
  atendente   text,
  criado_em   timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE inscricoes_eventos ENABLE ROW LEVEL SECURITY;

-- Usuários autenticados podem ler e escrever
CREATE POLICY "auth_all_eventos" ON eventos
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "auth_all_inscricoes_eventos" ON inscricoes_eventos
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
