const assert = require("node:assert/strict");
const { webcrypto } = require("node:crypto");
global.crypto = webcrypto;
const Core = require("../src/js/core.js");
global.TotpCore = Core;
const Migration = require("../src/js/google-migration.js");

async function main() {
    const vectors = [
        ["GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", "SHA1", 59, "94287082"],
        ["GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", "SHA1", 1111111109, "07081804"],
        ["GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA", "SHA256", 59, "46119246"],
        ["GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA", "SHA512", 59, "90693936"],
    ];
    for (const [secret, algorithm, seconds, expected] of vectors) assert.equal(await Core.generateTOTP(secret, { algorithm, digits: 8, period: 30, timestamp: seconds * 1000 }), expected);
    assert.equal((await Core.generateTOTP("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", { timestamp: 0 })).length, 6);
    assert.throws(() => Core.parseOtpAuth("otpauth://hotp/a?secret=JBSWY3DPEHPK3PXP&counter=1"), /HOTP/);
    assert.throws(() => Core.parseOtpAuth("otpauth://totp/a?secret=JBSWY3DPEHPK3PXP&digits=7"), /6 或 8/);
    assert.throws(() => Core.parseOtpAuth("otpauth://totp/a?secret=JBSWY3DPEHPK3PXP&algorithm=MD5"), /不支持/);
    const account = Core.parseOtpAuth("otpauth://totp/Example%3Aalice%40test?secret=JBSWY3DPEHPK3PXP&issuer=Example");
    assert.equal(account.issuer, "Example"); assert.equal(account.account, "alice@test");
    assert.equal(Core.parseOtpAuth(Core.toOtpAuth(account)).secret, account.secret);
    assert.equal(Core.formatCode("12345678"), "1234 5678");
    const pages = Migration.exportPages([account]); assert.equal(pages.length, 1);
    const decoded = Migration.decodeUri(pages[0]); assert.equal(decoded.accounts[0].secret, account.secret); assert.equal(decoded.batchSize, 1);
    const collector = new Migration.BatchCollector(); const collected = collector.add(pages[0]); assert.equal(collected.complete, true); assert.equal(collected.accounts.length, 1);
    const bulk = Core.parseBulkText("Example:alice|JBSW Y3DP EHPK 3PXP\nbad input"); assert.equal(bulk[0].ok, true); assert.equal(bulk[1].ok, false);
    console.log("All core and migration tests passed (" + (vectors.length + 10) + " checks)");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
