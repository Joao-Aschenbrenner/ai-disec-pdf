# Security Report — DocSplit AI v1.0.0

## Ações Realizadas

### Git Filter-Repo
- Removido `TESTE_INSTRUCOES.md` de TODO o histórico do git
- Arquivo continha chave NVIDIA (`nvapi-kMY1f...`) em commit c40960d
- `git filter-repo --path TESTE_INSTRUCOES.md --invert-paths --force`
- 1 commit removido, histórico reescrito

### Pós-limpeza
- `git log --all -- TESTE_INSTRUCOES.md` → vazio
- Adicionado `TESTE_INSTRUCOES.md` ao `.gitignore`

### Scanner de Segredos
- `grep` nos arquivos `.ts`, `.tsx`, `.cjs`, `.md`, `.json`, `.ps1`:
  - Nenhuma chave real encontrada (apenas `nvapi-...` de exemplo em `tests/README.md`)
- `CORRECOES.md` verificado — sem chaves, apenas documentação de correções passadas

### npm Audit
- Pacotes vulneráveis corrigidos com `npm audit fix` (pdfjs-dist, tar)
- Electron 34 mantido (upgrade para 42 quebra compatibilidade)

## Status
- ✅ Histórico do repo limpo
- ✅ Nenhuma chave hardcoded
- ✅ `.env` gitignored
- ✅ `settings.json` armazenado em `~/.docsplit-ai/` (fora do repo)
- ⚠️ Electron 34 tem vulnerabilidades conhecidas (upgrade para 42 requer testes)
