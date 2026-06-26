# AI Disec PDF — Guia de Versionamento

> Este documento existe para que **qualquer IA ou desenvolvedor** consiga versionar e publicar uma release sem quebrar nada. Siga **exatamente** os passos abaixo, na ordem.

---

## Versionamento — Passo a Passo

### 1. Bump da versão

Edite **apenas** o campo `"version"` em `package.json`:

```json
"version": "1.4.10"   ←  troque para a nova versão (ex: "1.4.11")
```

Regra de versionamento (semver):

| Tipo | Quando | Exemplo |
|------|--------|---------|
| **PATCH** | bug fix, correção de texto, ajuste leve | 1.4.10 → 1.4.11 |
| **MINOR** | nova funcionalidade, novo provider IA | 1.4.10 → 1.5.0 |
| **MAJOR** | breaking change, reescrita de arquitetura | 1.4.10 → 2.0.0 |

### 2. Commit

```bash
git add package.json
git commit -m "v1.4.11: descrição curta da mudança"
git push
```

> **NUNCA** faça commit de `dist/` ou `release/` — estão no `.gitignore`.

### 3. Build (frontend + server)

```bash
npm run build
```

Isso roda 3 coisas em sequência:
1. `vite build` → gera `dist/` (frontend)
2. `esbuild server/bin/dev-server.ts` → gera `dist/server.cjs`
3. `esbuild server/bin/server-module.ts` → gera `dist/server-module.cjs`

### 4. Build do instalador Electron

```bash
npm run electron:build
```

Isso roda `npm run build` + `electron-builder`. O resultado fica em `release/`:

| Arquivo | O que é |
|---------|---------|
| `AI-Disec-PDF-Setup-1.4.11.exe` | Instalador Windows (NSIS) |
| `AI-Disec-PDF-Setup-1.4.11.exe.blockmap` | Mapa de blocos para update diferencial |
| `latest.yml` | Manifesto que o auto-updater lê |

> **NÃO abra** o instalador gerado. Apenas suba para o GitHub.

### 5. Tag

```bash
git tag v1.4.11
git push origin v1.4.11
```

> A tag **deve** ter o prefixo `v` e **deve** bater com o `version` do `package.json`.

### 6. Publicar a Release no GitHub

Opção A — comando `gh`:

```bash
gh release create v1.4.11 \
  --title "v1.4.11 - AI Disec PDF" \
  --notes "Descrição das mudanças" \
  "release/AI-Disec-PDF-Setup-1.4.11.exe" \
  "release/AI-Disec-PDF-Setup-1.4.11.exe.blockmap" \
  "release/latest.yml"
```

Opção B — script automático (faz tudo, mas sem notas customizadas):

```bash
npm run release
```

> O script `scripts/release.cjs` roda build + electron-builder + `gh release create` com os 3 assets.

### 7. Verificar

```bash
gh release view v1.4.11 --json assets --jq ".assets[].name"
```

Deve retornar:

```
AI-Disec-PDF-Setup-1.4.11.exe
AI-Disec-PDF-Setup-1.4.11.exe.blockmap
latest.yml
```

Se faltar qualquer um dos 3, o **auto-updater vai quebrar** para quem já tem o app instalado.

---

## Auto-Updater — Como funciona

O app instalado verifica atualizações automaticamente ao abrir. O fluxo:

1. App lê `latest.yml` da release mais recente no GitHub
2. Compara a versão do `latest.yml` com a versão instalada
3. Se é mais nova, baixa o `.exe` e o `.blockmap`
4. Ao fechar/reabrir, instala a atualização

O auto-updater está em `electron/main.cjs` e usa:

```js
provider: "github"
owner: "Joao-Aschenbrenner"
repo: "ai-disec-pdf"
```

**Não precisa de `GH_TOKEN`** — o repositório é público.

---

## Checklist rápido (copia e cola)

```
[ ] Bump version em package.json
[ ] git commit + push
[ ] npm run electron:build (build completo)
[ ] git tag vX.Y.Z + git push origin vX.Y.Z
[ ] gh release create com 3 assets (.exe, .blockmap, latest.yml)
[ ] gh release view para confirmar 3 assets
```

---

## Erros comuns

| Erro | Causa | Solução |
|------|-------|---------|
| 404 no auto-update | `latest.yml` ou `.blockmap` faltando na release | Subir os 3 assets obrigatórios |
| "authentication token" | `provider: "generic"` no autoUpdater | Usar `provider: "github"` |
| Versão não muda no app | Esqueceu de fazer bump no `package.json` | Sempre bump **antes** do build |
| Build falha | `node_modules` desatualizado | `npm install` antes de build |
| Commit de dist/ | `dist/` está no `.gitignore` | Nunca commitar dist/ ou release/ |

---

## Scripts disponíveis

| Comando | O que faz |
|---------|-----------|
| `npm run dev` | Roda servidor web de desenvolvimento |
| `npm run electron:dev` | Roda app Electron em modo dev |
| `npm run build` | Build frontend + server (sem Electron) |
| `npm run electron:build` | Build completo + instalador Windows |
| `npm run release` | Build + instalador + publica release no GitHub |
| `npm run test` | Roda testes Vitest |
