# UX Report — DocSplit AI v1.0.0

## FilenameOptions (6 checkboxes)

Nova seção "Componentes do Nome do Arquivo" na UI:

| Checkbox | Descrição | Default |
|----------|-----------|---------|
| Número da página | `pag1_, pag2_...` | ✅ |
| Tipo do documento | `NF, FOPAG, extrato...` | ✅ |
| Número da nota | `NF123` — só NF-e | ✅ |
| Nome empresa/pessoa | Nome do emitente | ✅ |
| Nome do funcionário | `João_Silva` — holerite/FOPAG | ✅ |
| Valor | `3500.00` | ✅ |

- `localStorage` persistence (salva ao alterar, carrega no mount)
- Preview ao vivo do filename ao marcar/desmarcar

## Modal de Documentação

- Botão "📖" no header abre modal com:
  - Stack tecnológica
  - Lista dos 8 provedores
  - Instruções de uso
  - Configuração de layout
  - Privacidade
  - Links para documentos legais (`legal/`)
- Fecha ao clicar fora ou no "✕"

## 8 Provedores de IA

| Provider | Label no Dropdown | Modelo | Visão |
|----------|-------------------|--------|-------|
| Google | Google Gemini Flash 2.0 (grátis) 🎉 | gemini-2.0-flash | ✅ |
| NVIDIA | NVIDIA (Llama Vision) | Llama 3.2 90B | ✅ |
| OpenAI | OpenAI (GPT-4o) | gpt-4o | ✅ |
| Anthropic | Anthropic (Claude 3 Sonnet) | claude-3-sonnet | ✅ |
| Mistral | Mistral (Mistral Vision) | open-mistral-vision | ✅ |
| OpenRouter | OpenRouter (Gemini Flash via API) | gemini-2.0-flash-001 | ✅ |
| Groq | Groq (Llama Vision, grátis) | llama-3.2-90b-vision-preview | ✅ |

## Testes de FilenameOptions

- **339 testes** (14 individuais + 325 combinatoriais 64×5)
- Cobre: NF, FOPAG, DARF, extrato, outros
- Cobre: todas as 64 combinações booleanas dos 6 campos
- Cobre: null, vazio, acentos, caracteres especiais
