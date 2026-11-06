const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
const v = pkg.version;
const tag = "v" + v;

console.log(`[release] Creating GitHub release ${tag}...`);

// P0.52-R1 (A3): o electron-builder grava em build/electron (package.json
// directories.output) — o caminho antigo release/ quebrava o gh release create.
const cmd = `gh release create ${tag} --repo Joao-Aschenbrenner/ai-disec-pdf --title ${tag} --notes "Release automatica v${v}" "build/electron/AI-Disec-PDF-Setup-${v}.exe" "build/electron/AI-Disec-PDF-Setup-${v}.exe.blockmap" "build/electron/latest.yml"`;

console.log(`[release] Running: gh release create ${tag} ...`);
execSync(cmd, { stdio: "inherit", cwd: path.join(__dirname, "..") });
console.log(`[release] Done! ${tag} published.`);
