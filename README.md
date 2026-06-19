<div align="center">

# AI Disec PDF

**Separador Inteligente de PDF com IA**

[![GitHub Release](https://img.shields.io/github/v/release/Joao-Aschenbrenner/ai-disec-pdf?style=for-the-badge&label=Download&color=6d28d9)](https://github.com/Joao-Aschenbrenner/ai-disec-pdf/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-6d28d9?style=for-the-badge)](LICENSE)
[![Tests](https://img.shields.io/badge/Tests-386%20passing-22c55e?style=for-the-badge)]()

</div>

Divide PDFs com múltiplos documentos (notas fiscais, DARFs, holerites, extratos, boletos) em arquivos individuais, renomeados automaticamente com base no conteúdo de cada página.

---

## ⬇️ Download

Baixe o instalador mais recente na [página de Releases](https://github.com/Joao-Aschenbrenner/ai-disec-pdf/releases/latest):

```
AI Disec PDF Setup 1.0.0.exe
```

## 🚀 Como usar

1. **Instalar** — execute o instalador baixado
2. **Abrir** — atalho no Desktop ou Menu Iniciar
3. **Configurar chave** — clique em ⚙️ Configurações, escolha um provedor e cole sua chave de API
4. **Processar** — arraste ou selecione um PDF, clique em "Identificar & Organizar Páginas"
5. **Baixar** — clique em "Baixar ZIP Processado"

O app verifica atualizações automaticamente toda vez que inicia.

## 🤖 Provedores de IA

| Provedor    | Modelo                    | Imagens |
|-------------|---------------------------|---------|
| Google      | Gemini 2.0 Flash (grátis) | Sim     |
| NVIDIA      | Llama 3.2 90B Vision      | Sim     |
| OpenAI      | GPT-4o                    | Sim     |
| Anthropic   | Claude 3 Sonnet           | Sim     |
| Mistral     | Mistral Vision            | Sim     |
| OpenRouter  | Gemini Flash via API      | Sim     |
| Groq        | Llama Vision (grátis)     | Sim     |
| Cerebras    | texto apenas              | Não     |

## 📁 Estrutura do projeto

```
├── assets/          # Ícones (SVG, PNG, ICO)
├── electron/        # main.cjs (auto-update, menu removido)
├── legal/           # Termos de uso, privacidade, LGPD
├── server/          # Express + 8 providers IA
├── src/             # React + Tailwind
├── tests/           # 386 testes (Vitest)
└── dist/            # Build de produção
```

---

## 🔧 Desenvolvimento

```bash
git clone https://github.com/Joao-Aschenbrenner/ai-disec-pdf.git
cd ai-disec-pdf
npm install
npm run dev              # servidor web
npm run electron:dev     # Electron + servidor
npm run test             # 386 testes
npm run build            # build produção
npm run electron:build   # gera instalador
```

### Publicar atualização

```bash
# 1. Altere a versão em package.json
# 2. Defina o token
$env:GH_TOKEN = "ghp_seu_token"

# 3. Publique
npm run release

# Usuários existentes recebem a atualização ao abrir o app
```

---

## 📄 Licença

Distribuído sob licença **MIT**. Veja [LICENSE](LICENSE) para mais informações.

Documentos legais adicionais em [`legal/`](legal/):
- [Termos de Uso](legal/TERMS.md)
- [Política de Privacidade](legal/PRIVACY_POLICY.md)
- [Aviso LGPD](legal/LGPD_NOTICE.md)

---

<div align="center">
  <sub>Feito por <a href="https://github.com/Joao-Aschenbrenner">João Aschenbrenner</a></sub>
</div>
