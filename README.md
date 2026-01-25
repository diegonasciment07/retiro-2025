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

## 📧 Contato

Para dúvidas: oalvocuritiba@gmail.com

## 📄 Licença

Projeto desenvolvido para ALVO Church - Todos os direitos reservados
