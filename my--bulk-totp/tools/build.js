const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "src");
const dist = path.join(root, "dist");
const vendor = path.join(root, "vendor");

const copies = [
    [path.join(source, "index.html"), path.join(dist, "index.html")],
    [path.join(source, "assets", "styles.css"), path.join(dist, "assets", "styles.css")],
    ...["core.js", "google-migration.js", "qr.js", "vault.js", "app.js"].map((name) => [
        path.join(source, "js", name),
        path.join(dist, "js", name)
    ]),
    [path.join(vendor, "qrcode-generator.js"), path.join(dist, "vendor", "qrcode-generator.js")],
    [path.join(vendor, "jsQR.js"), path.join(dist, "vendor", "jsQR.js")]
];

for (const [input] of copies) {
    if (!fs.existsSync(input)) throw new Error("缺少构建输入：" + path.relative(root, input));
}

fs.rmSync(dist, { recursive: true, force: true });
for (const [input, output] of copies) {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.copyFileSync(input, output);
}

const licenses = `THIRD-PARTY LICENSES\n\nqrcode-generator 1.4.4\nCopyright (c) 2009 Kazuhiko Arase\nLicense: MIT\nhttps://github.com/kazuhikoarase/qrcode-generator\n\njsQR 1.4.0\nCopyright (c) 2018 Cozmo Inc.\nLicense: Apache-2.0\nhttps://github.com/cozmo/jsQR\n`;
fs.writeFileSync(path.join(dist, "THIRD_PARTY_LICENSES.txt"), licenses, "utf8");

function filesIn(directory) {
    return fs.readdirSync(directory, { withFileTypes: true })
        .flatMap((entry) => entry.isDirectory()
            ? filesIn(path.join(directory, entry.name))
            : [path.join(directory, entry.name)]);
}

const manifest = filesIn(dist)
    .filter((file) => path.basename(file) !== "MANIFEST.sha256")
    .map((file) => {
        const hash = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
        return hash + "  " + path.relative(dist, file).split(path.sep).join("/");
    })
    .sort((a, b) => a.localeCompare(b))
    .join("\n") + "\n";

fs.writeFileSync(path.join(dist, "MANIFEST.sha256"), manifest, "utf8");
console.log("Built dist/ with " + copies.length + " runtime files.");
