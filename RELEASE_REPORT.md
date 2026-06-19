# Release Report — DocSplit AI v1.0.0

## Documentação

- `README.md`: reescrito com stack, providers, setup, scripts
- `.env.example`: limpo (apenas PORT + APP_URL)

## Legal

| Arquivo | Conteúdo |
|---------|----------|
| `legal/TERMS.md` | Termos de uso, licença MIT, isenção de garantia |
| `legal/PRIVACY_POLICY.md` | Processamento local, chaves em `~/.docsplit-ai/`, dados só vão ao provider |
| `legal/LGPD_NOTICE.md` | Base legal (art. 10 LGPD), direitos do titular, contato |

⚠️ Todos os documentos trazem header: "Rascunho automático — recomenda-se revisão jurídica antes do uso em produção."

## Performance

| Cenário | Resultado | Limite |
|---------|-----------|--------|
| 400 filenames (default) | 0.9ms | < 100ms |
| 25600 filenames (64 combos × 400) | 30.4ms | < 500ms |
| 400 sanitize | 1.2ms | < 50ms |
| 400 fixJSON | 1.0ms | < 50ms |
| PDF split 10 páginas | 18ms | < 5000ms |
| Server start/stop | 16ms | < 2000ms |

## Build

```bash
npm run build     # ✅ (vite + esbuild)
npm test          # ✅ 367/367
npm run lint      # ✅ tsc --noEmit limpo
```

## Instalador

- `npx electron-builder --win` → `release/DocSplit AI Setup 1.0.0.exe`
- NSIS, oneClick=false, perMachine=false
- Ícone personalizado incluído

## Tag

```bash
git tag v1.0.0 && git push origin v1.0.0  # ✅
```
