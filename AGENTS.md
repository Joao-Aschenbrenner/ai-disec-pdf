# AGENTS.md - Regras para agentes

## Regra Obrigatória: Verificar Executável Atualizado

**SEMPRE** ao finalizar qualquer alteração no código WPF:
1. Fazer `dotnet publish src/SeparadorDePdf.Wpf/SeparadorDePdf.Wpf.csproj -c Release -r win-x64 -o publish_wpf`
2. Copiar `tessdata` de `publish_nonSF` para `publish_wpf`
3. Matar processo antigo e iniciar `publish_wpf\SeparadorDePdf.Wpf.exe`
4. Verificar se atalho `SeparadorDePdf.lnk` aponta para `publish_wpf\SeparadorDePdf.Wpf.exe`

## Checklist de Deploy WPF

- [ ] `dotnet build SeparadorDePdf.sln` passa
- [ ] `dotnet test` passa (282 testes)
- [ ] `dotnet publish ... -o publish_wpf` executado
- [ ] `tessdata` copiado para `publish_wpf`
- [ ] Processo antigo morto (`Get-Process SeparadorDePdf.Wpf | Stop-Process -Force`)
- [ ] Novo exe iniciado (`publish_wpf\SeparadorDePdf.Wpf.exe`)
- [ ] Atalho `SeparadorDePdf.lnk` aponta para `publish_wpf\SeparadorDePdf.Wpf.exe`

## Comandos Rápidos PowerShell

```powershell
# Build + test + publish + restart
dotnet build SeparadorDePdf.sln
dotnet test tests/SeparadorDePdf.Tests/SeparadorDePdf.Tests.csproj --no-restore --verbosity quiet
dotnet publish src/SeparadorDePdf.Wpf/SeparadorDePdf.Wpf.csproj -c Release -r win-x64 -o publish_wpf
Get-Process SeparadorDePdf.Wpf -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 1
Copy-Item publish_nonSF\tessdata publish_wpf\tessdata -Recurse -Force
Start-Process publish_wpf\SeparadorDePdf.Wpf.exe
```

## Quality Gate (Fase 3B)

Antes de publish, validar:
1. Todos os 282 testes passam (`dotnet test`)
2. Golden files passam (10 tipos documentais)
3. Performance: classificação <100ms/página, extração <50ms/página, agrupamento 500 páginas <100ms

```powershell
# Quality gate completo
dotnet test tests/SeparadorDePdf.Tests/SeparadorDePdf.Tests.csproj --no-restore --verbosity quiet
# Benchmarks (opcional, ~3 min)
dotnet run --project src/SeparadorDePdf.Benchmarks/SeparadorDePdf.Benchmarks.csproj -c Release
```

## Atualizar Atalho

```powershell
$sh = New-Object -ComObject WScript.Shell
$shortcut = $sh.CreateShortcut("SeparadorDePdf.lnk")
$shortcut.TargetPath = "C:\Users\USUARIO\Documents\Separador de PDF\publish_wpf\SeparadorDePdf.Wpf.exe"
$shortcut.WorkingDirectory = "C:\Users\USUARIO\Documents\Separador de PDF\publish_wpf"
$shortcut.Save()
```
