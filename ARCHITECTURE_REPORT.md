# Architecture Report — DocSplit AI v1.0.0

## Reorganização de Pastas

```
Antes:                          Depois:
Separador de PDF/               DocSplit AI/
├── server.ts                   ├── server/server.ts
├── bin/                        ├── server/bin/
├── index.html                  ├── index.html  (Vite entry — mantido!)
├── CORRECOES.md                ├── [removido]
├── server-min.cjs/.js/.cjs     ├── [removido]
├── test-extraction.ps1         ├── [removido]
├── metadata.json               ├── [removido]
├── DocSplit AI.lnk             ├── [removido]
├── electron/server-launcher.cjs├── [removido]
├── tsconfig.tests.json         ├── [removido]
├── assets/.aistudio/           ├── [removido]
├── separador-de-notas/         ├── [removido]
└── assets/ (vazia)             └── assets/icon.svg + icon.png
```

Total: **13 arquivos/pastas removidos**, **4 criados** (icon, legal files)

## Remoção do Menu Nativo Electron

- `electron/main.cjs`: `Menu.setApplicationMenu(null)` + `autoHideMenuBar: true`
- Elimina File, Edit, View, Window, Help
- Documentation movida para dentro do app React (modal)

## Branding

- `assets/icon.svg`: design profissional 256×256 com gradiente indigo→azul
- `assets/icon.png`: convertido via sharp (256×256)
- `package.json`: `build.win.icon: "assets/icon.png"`
- `package.json`: `author: "João Aschenbrenner"`, `version: "1.0.0"`

## Estrutura Final

```
DocSplit AI/
├── src/              React + Vite + Tailwind
├── server/           Express + providers IA
├── electron/         Electron main process
├── tests/            367 testes (Vitest)
├── assets/           Ícones
├── legal/            Termos, privacidade, LGPD
├── dist/             Build output
└── release/          Instalador NSIS
```
