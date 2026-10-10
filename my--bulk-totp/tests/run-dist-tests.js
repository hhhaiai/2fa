const assert = require("node:assert/strict");
const { webcrypto } = require("node:crypto");

global.crypto = webcrypto;
const Core = require("../dist/js/core.js");
global.TotpCore = Core;
const Migration = require("../dist/js/google-migration.js");

(async () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    assert.equal(await Core.generateTOTP(secret, {
        algorithm: "SHA1",
        digits: 8,
        period: 30,
        timestamp: 59000
    }), "94287082");
    const account = Core.parseOtpAuth("otpauth://totp/Example%3Aalice?secret=JBSWY3DPEHPK3PXP&issuer=Example");
    const page = Migration.exportPages([account])[0];
    assert.equal(Migration.decodeUri(page).accounts[0].secret, account.secret);
    console.log("Distribution contracts passed.");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
