const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const allowed = new Set([
    "MANIFEST.sha256",
    "THIRD_PARTY_LICENSES.txt",
    "assets/styles.css",
    "index.html",
    "js/app.js",
    "js/core.js",
    "js/google-migration.js",
    "js/qr.js",
    "js/vault.js",
    "vendor/jsQR.js",
    "vendor/qrcode-generator.js"
]);

function filesIn(directory) {
    return fs.readdirSync(directory, { withFileTypes: true })
        .flatMap((entry) => entry.isDirectory()
            ? filesIn(path.join(directory, entry.name))
            : [path.join(directory, entry.name)]);
}

if (!fs.existsSync(dist)) throw new Error("dist/ 不存在，请先构建");
const files = filesIn(dist).map((file) => path.relative(dist, file).split(path.sep).join("/")).sort();
for (const file of files) if (!allowed.has(file)) throw new Error("交付目录含未知文件：" + file);
for (const file of allowed) if (!files.includes(file)) throw new Error("交付目录缺少文件：" + file);

const html = fs.readFileSync(path.join(dist, "index.html"), "utf8");
if (!html.includes("default-src 'none'") || !html.includes("connect-src 'none'")) throw new Error("严格 CSP 缺失");
if (/\b(?:https?:)?\/\//i.test(html)) throw new Error("HTML 包含远程 URL");
const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((match) => match[1]);
const expectedScripts = [
    "vendor/qrcode-generator.js",
    "vendor/jsQR.js",
    "js/core.js",
    "js/google-migration.js",
    "js/qr.js",
    "js/vault.js",
    "js/app.js"
];
if (JSON.stringify(scripts) !== JSON.stringify(expectedScripts)) throw new Error("脚本顺序或路径错误");
for (const resource of [...scripts, "assets/styles.css"]) {
    if (!fs.existsSync(path.join(dist, resource))) throw new Error("HTML 引用缺失：" + resource);
}

for (const file of files.filter((name) => !name.startsWith("vendor/") && name !== "MANIFEST.sha256" && name !== "THIRD_PARTY_LICENSES.txt")) {
    const content = fs.readFileSync(path.join(dist, file), "utf8");
    if (/\b(?:https?:)?\/\//i.test(content)) throw new Error(file + " 包含远程 URL");
    if (content.includes("/Users/")) throw new Error(file + " 包含构建机路径");
}

const expectedManifest = fs.readFileSync(path.join(dist, "MANIFEST.sha256"), "utf8").trim().split("\n");
for (const line of expectedManifest) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (!match) throw new Error("清单格式错误：" + line);
    const file = path.join(dist, match[2]);
    if (!fs.existsSync(file)) throw new Error("清单引用缺失：" + match[2]);
    const actual = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    if (actual !== match[1]) throw new Error("清单哈希不匹配：" + match[2]);
}

console.log("Distribution verification passed (offline, CSP, files, hashes).");
