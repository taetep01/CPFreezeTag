import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");

const rootPkgPath = path.join(rootDir, "package.json");
const clientPkgPath = path.join(rootDir, "client", "package.json");
const serverPkgPath = path.join(rootDir, "server", "package.json");
const versionTsPath = path.join(rootDir, "client", "src", "version.ts");

function bumpPatch(ver) {
  const parts = ver.split(".").map(Number);
  if (parts.length === 3 && !parts.some(isNaN)) {
    parts[2] += 1;
    return parts.join(".");
  }
  return ver;
}

try {
  const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf-8"));
  const newVer = bumpPatch(rootPkg.version || "1.0.0");
  rootPkg.version = newVer;
  fs.writeFileSync(rootPkgPath, JSON.stringify(rootPkg, null, 2) + "\n");

  if (fs.existsSync(clientPkgPath)) {
    const clientPkg = JSON.parse(fs.readFileSync(clientPkgPath, "utf-8"));
    clientPkg.version = newVer;
    fs.writeFileSync(clientPkgPath, JSON.stringify(clientPkg, null, 2) + "\n");
  }

  if (fs.existsSync(serverPkgPath)) {
    const serverPkg = JSON.parse(fs.readFileSync(serverPkgPath, "utf-8"));
    serverPkg.version = newVer;
    fs.writeFileSync(serverPkgPath, JSON.stringify(serverPkg, null, 2) + "\n");
  }

  const versionTsContent = `// Auto-generated version file\nexport const GAME_VERSION = "v${newVer}";\n`;
  fs.writeFileSync(versionTsPath, versionTsContent);

  console.log(`✅ Version bumped to v${newVer}`);
} catch (err) {
  console.error("❌ Version bump error:", err);
  process.exit(1);
}
