const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
const v = pkg.version;
const tag = "v" + v;

console.log(`[release] Creating GitHub release ${tag}...`);

const cmd = `gh release create ${tag} --repo Joao-Aschenbrenner/ai-disec-pdf --title ${tag} --notes "Release automatica v${v}" "release/AI-Disec-PDF-Setup-${v}.exe" "release/AI-Disec-PDF-Setup-${v}.exe.blockmap" "release/latest.yml"`;

console.log(`[release] Running: gh release create ${tag} ...`);
execSync(cmd, { stdio: "inherit", cwd: path.join(__dirname, "..") });
console.log(`[release] Done! ${tag} published.`);
