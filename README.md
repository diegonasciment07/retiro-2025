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

## 📧 Contato

Para dúvidas: oalvocuritiba@gmail.com

## 📄 Licença

Projeto desenvolvido para ALVO Church - Todos os direitos reservados
