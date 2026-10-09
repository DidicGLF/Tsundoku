// Construit l'archive à copier sur le conteneur : dist/, package.json (dépendances de production) et deploy/.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "release");
const stage = join(out, "tsundoku-sync");

execFileSync("pnpm", ["run", "build"], { cwd: root, stdio: "inherit" });
rmSync(out, { recursive: true, force: true });
mkdirSync(join(stage, "deploy"), { recursive: true });
cpSync(join(root, "dist"), join(stage, "dist"), { recursive: true });
cpSync(join(root, "deploy", "install.sh"), join(stage, "deploy", "install.sh"));
cpSync(join(root, "deploy", "tsundoku-sync.service"), join(stage, "deploy", "tsundoku-sync.service"));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
writeFileSync(join(stage, "package.json"), JSON.stringify({ name: pkg.name, version: pkg.version, type: "module", dependencies: pkg.dependencies }, null, 2) + "\n");
execFileSync("tar", ["-czf", join(out, "tsundoku-sync.tgz"), "-C", out, "tsundoku-sync"]);
console.log(`Archive prête : ${join(out, "tsundoku-sync.tgz")}`);
