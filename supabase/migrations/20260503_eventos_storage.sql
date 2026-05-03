-- Bucket público para imagens de eventos
INSERT INTO storage.buckets (id, name, public)
VALUES ('event-images', 'event-images', true)
ON CONFLICT (id) DO NOTHING;

-- Leitura pública
CREATE POLICY "Public read event images" ON storage.objects
  FOR SELECT USING (bucket_id = 'event-images');

-- Upload apenas para autenticados
CREATE POLICY "Auth upload event images" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'event-images');

-- Deleção apenas para autenticados
CREATE POLICY "Auth delete event images" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'event-images');
