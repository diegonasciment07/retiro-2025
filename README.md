# 🏕️ Sistema de Balcão - O Retiro 2026

Sistema completo para gestão de inscrições e pagamentos do Retiro 2026 - ALVO Church

## 📁 Estrutura do Projeto
```
retiro-2025/
├── sistema-inscricoes/    # Interface pública para inscrições
├── sistema-balcao/        # Sistema administrativo
├── database/              # Scripts do banco de dados
├── docs/                  # Documentação
├── .gitignore            # Arquivos a ignorar
└── README.md             # Este arquivo
```

## 🛠️ Tecnologias

- **Frontend**: HTML5, CSS3, JavaScript (Vanilla)
- **Backend**: Supabase (PostgreSQL)
- **Autenticação**: Supabase Auth
- **E-mail**: Resend API
- **Hospedagem**: GitHub Pages
- **Versionamento**: Git/GitHub

## 🚀 Como Usar

### 1. Clone o repositório
```bash
git clone https://github.com/seu-usuario/retiro-2025.git
cd retiro-2025
```

### 2. Configure o Supabase
- Execute o script `database/setup.sql` no Supabase SQL Editor
- Crie usuários no Authentication

### 3. Abra os sistemas
- **Inscrições**: Abra `sistema-inscricoes/index.html` no navegador
- **Balcão**: Abra `sistema-balcao/index.html` no navegador

## Retirada das crianças no check-in Kids

Antes de publicar esta versão do balcão, execute no SQL Editor do Supabase
o arquivo `supabase/migrations/20261015_kids_responsaveis_retirada.sql`.
Ele cria a lista `responsaveis_retirada` nas inscrições Kids, mantendo as
permissões de acesso já existentes para os atendentes autenticados.

Ao clicar em **Marcar Pulseira** para um participante com pagamento completo,
o atendente confirma pelo menos um nome de quem poderá buscar a criança.
O responsável da inscrição aparece como sugestão e pode ser substituído;
outros nomes podem ser adicionados. **Confirmar e entregar pulseira** salva
os nomes e a entrega juntos. Cancelar não altera o check-in.

Os autorizados aparecem no cartão e nos detalhes, onde podem ser editados
após a entrega. Para pulseiras entregues antes desta mudança, use
**Confirmar nomes**. Desmarcar uma pulseira preserva os nomes para uma nova
confirmação. A exportação da base completa também inclui essa lista.

## Equilíbrio dos times Kids e Brothers Camp

Antes de publicar esta atualização, execute no SQL Editor do projeto Supabase
o arquivo `supabase/migrations/20261021_kids_equilibrio_times.sql`.
Ele atualiza a atribuição incremental e instala as funções de prévia e aplicação.
A instalação não redistribui participantes automaticamente.

Novas atribuições consideram, nesta ordem: tamanho do time, quantidade do mesmo
gênero, quantidade do mesmo gênero e idade, e somas de idades. Só atribuem
participantes ativos sem equipe com pagamento de pelo menos R$ 100.

Em **Gerenciar Equipes → Prévia de Equilibrar Times**, o administrador vê os
números antes/depois, as idades por gênero e cada mudança proposta para o evento
selecionado. A proposta inclui participantes ativos já escalados e novos
participantes com entrada mínima de R$ 100. Quem já está escalado é preservado
na base do jogo mesmo se seu pagamento tiver sido corrigido para menos de R$ 100.
Equipe de trabalho, cancelados e outros eventos ficam fora da proposta.

O planejador mantém diferença máxima de uma pessoa no total de cada time e
também nas quantidades de meninos e meninas entre os times. Distribui idades
por gênero e melhora essa distribuição com trocas que preservam as cotas;
não promete medir força física nem encontrar o ótimo matemático global.
Uma distribuição existente que já atende às cotas só é trocada por uma proposta
melhor nos critérios de idade, com preferência por preservar os times em empates.

Exceção solicitada pela organização: **Arthur Oliveira Nascimento permanece em
João Azuis no Brothers Camp**. O planejador o inclui nas cotas e idades, reserva
sua vaga antes da distribuição e o exclui das trocas de otimização. A interface
não mostra marcações dessa regra e permite a troca manual normalmente.
Se houver cadastros duplicados ou o time
não existir/estiver inativo, a proposta é interrompida para conferência.

**Aplicar esta distribuição** grava todas as trocas em uma transação. Se equipes,
cadastros ou pagamentos mudaram desde a prévia, é preciso gerar outra. O banco
valida os participantes, os destinos e as cotas novamente. Somente os mesmos
administradores autorizados a gerenciar equipes podem usar essas funções.

Validação local: `npm ci` e `npm test`. Os testes de SQL usam PostgreSQL embarcado
via PGlite, sem acesso nem alterações ao banco de produção.

## 📧 Contato

Para dúvidas: oalvocuritiba@gmail.com

## 📄 Licença

Projeto desenvolvido para ALVO Church - Todos os direitos reservados
