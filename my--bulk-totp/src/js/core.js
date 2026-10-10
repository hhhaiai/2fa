/* Offline Authenticator core — no DOM dependencies. */
(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    root.TotpCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const DEFAULTS = Object.freeze({ algorithm: "SHA1", digits: 6, period: 30 });
    const HASH_NAMES = Object.freeze({ SHA1: "SHA-1", SHA256: "SHA-256", SHA512: "SHA-512" });

    function fail(message, code) {
        const error = new Error(message);
        error.code = code || "INVALID_INPUT";
        throw error;
    }

    function normalizeSecret(input) {
        let value = String(input == null ? "" : input).trim().toUpperCase();
        if (!value) fail("密钥为空", "EMPTY_SECRET");
        if (!/^[A-Z2-7\s=-]+$/.test(value)) fail("密钥包含非 Base32 字符", "INVALID_BASE32");
        value = value.replace(/[\s-]/g, "");
        if (!/^[A-Z2-7]+={0,6}$/.test(value) || /=.*[A-Z2-7]/.test(value)) fail("Base32 填充格式无效", "INVALID_PADDING");
        value = value.replace(/=+$/, "");
        if (value.length < 16) fail("密钥太短（至少需要 16 个 Base32 字符）", "SHORT_SECRET");
        if (value.length > 512) fail("密钥过长", "LONG_SECRET");
        base32ToBytes(value);
        return value;
    }

    function base32ToBytes(input) {
        const value = String(input).trim().toUpperCase().replace(/[\s-]/g, "").replace(/=+$/, "");
        if (!value || !/^[A-Z2-7]+$/.test(value)) fail("无效的 Base32 密钥", "INVALID_BASE32");
        let buffer = 0;
        let bits = 0;
        const output = [];
        for (const character of value) {
            buffer = buffer * 32 + BASE32.indexOf(character);
            bits += 5;
            while (bits >= 8) {
                bits -= 8;
                output.push(Math.floor(buffer / Math.pow(2, bits)) & 255);
                buffer &= Math.pow(2, bits) - 1;
            }
        }
        if (bits && buffer !== 0) fail("Base32 尾部位不规范", "NON_CANONICAL_BASE32");
        if (!output.length) fail("密钥无法解码", "EMPTY_SECRET");
        return new Uint8Array(output);
    }

    function bytesToBase32(bytes) {
        let buffer = 0;
        let bits = 0;
        let output = "";
        for (const byte of bytes) {
            buffer = buffer * 256 + byte;
            bits += 8;
            while (bits >= 5) {
                bits -= 5;
                output += BASE32[Math.floor(buffer / Math.pow(2, bits)) & 31];
                buffer &= Math.pow(2, bits) - 1;
            }
        }
        if (bits) output += BASE32[(buffer << (5 - bits)) & 31];
        return output;
    }

    function normalizeAlgorithm(value, missingAllowed) {
        if ((value == null || value === "") && missingAllowed) return DEFAULTS.algorithm;
        const normalized = String(value).toUpperCase().replace(/-/g, "");
        if (!HASH_NAMES[normalized]) fail("不支持的算法：" + value, "UNSUPPORTED_ALGORITHM");
        return normalized;
    }

    function normalizeDigits(value, missingAllowed) {
        if ((value == null || value === "") && missingAllowed) return DEFAULTS.digits;
        const digits = Number(value);
        if (digits !== 6 && digits !== 8) fail("验证码位数只能是 6 或 8", "INVALID_DIGITS");
        return digits;
    }

    function normalizePeriod(value, missingAllowed) {
        if ((value == null || value === "") && missingAllowed) return DEFAULTS.period;
        const period = Number(value);
        if (!Number.isInteger(period) || period < 1 || period > 300) fail("周期必须是 1–300 秒的整数", "INVALID_PERIOD");
        return period;
    }

    function createId() {
        if (globalThis.crypto && crypto.getRandomValues) {
            const bytes = new Uint8Array(12);
            crypto.getRandomValues(bytes);
            return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
        }
        return "account-" + String(Date.now()) + "-" + String(Math.floor(Math.random() * 1e9));
    }

    function createAccount(input) {
        const source = input || {};
        const issuer = String(source.issuer || "").trim();
        const account = String(source.account || source.label || "").trim();
        const algorithm = normalizeAlgorithm(source.algorithm, true);
        const digits = normalizeDigits(source.digits, true);
        const period = normalizePeriod(source.period, true);
        const warnings = Array.isArray(source.warnings) ? source.warnings.slice() : [];
        if (algorithm !== "SHA1" || digits !== 6 || period !== 30) warnings.push("非 SHA1 / 6 位 / 30 秒配置在部分验证器中可能不兼容");
        return {
            id: source.id || createId(),
            issuer,
            account: account || "未命名账号",
            secret: normalizeSecret(source.secret),
            type: "TOTP",
            algorithm,
            digits,
            period,
            source: source.source || "manual",
            warnings: Array.from(new Set(warnings)),
        };
    }

    function getSingleParameter(params, name) {
        const values = [];
        for (const [key, value] of params.entries()) if (key.toLowerCase() === name) values.push(value);
        if (values.length > 1) fail("参数重复：" + name, "DUPLICATE_PARAMETER");
        return values[0];
    }

    function parseOtpAuth(uri) {
        let url;
        try { url = new URL(String(uri).trim()); } catch (_) { fail("无效的 otpauth 链接", "INVALID_URI"); }
        if (url.protocol.toLowerCase() !== "otpauth:") fail("不是 otpauth 链接", "INVALID_URI");
        const type = url.hostname.toLowerCase();
        if (type === "hotp") fail("暂不支持 HOTP 计数器账号", "UNSUPPORTED_HOTP");
        if (type !== "totp") fail("仅支持 TOTP 链接", "UNSUPPORTED_TYPE");
        const secret = getSingleParameter(url.searchParams, "secret");
        if (!secret) fail("链接缺少 secret 参数", "MISSING_SECRET");
        const issuerParameter = getSingleParameter(url.searchParams, "issuer");
        const algorithm = getSingleParameter(url.searchParams, "algorithm");
        const digits = getSingleParameter(url.searchParams, "digits");
        const period = getSingleParameter(url.searchParams, "period");
        const label = decodeURIComponent(url.pathname.replace(/^\//, ""));
        const colon = label.indexOf(":");
        const labelIssuer = colon >= 0 ? label.slice(0, colon).trim() : "";
        const account = (colon >= 0 ? label.slice(colon + 1) : label).trim();
        const warnings = [];
        if (issuerParameter && labelIssuer && issuerParameter !== labelIssuer) warnings.push("链接标签与 issuer 参数不一致，已采用 issuer 参数");
        return createAccount({
            issuer: issuerParameter || labelIssuer,
            account: account || "未命名账号",
            secret,
            algorithm: algorithm == null ? DEFAULTS.algorithm : algorithm,
            digits: digits == null ? DEFAULTS.digits : digits,
            period: period == null ? DEFAULTS.period : period,
            source: "otpauth",
            warnings,
        });
    }

    function parseCsvLine(line) {
        const result = [];
        let field = "";
        let quoted = false;
        for (let i = 0; i < line.length; i += 1) {
            const character = line[i];
            if (character === '"') {
                if (quoted && line[i + 1] === '"') { field += '"'; i += 1; }
                else quoted = !quoted;
            } else if (character === "," && !quoted) { result.push(field.trim()); field = ""; }
            else field += character;
        }
        if (quoted) fail("CSV 引号未闭合", "INVALID_CSV");
        result.push(field.trim());
        return result;
    }

    function parseTextLine(raw, lineNumber) {
        const line = String(raw || "").trim();
        if (!line) return null;
        try {
            if (/^otpauth:\/\//i.test(line)) return { ok: true, account: parseOtpAuth(line), line: lineNumber };
            let label = "";
            let secret = line;
            if (line.includes("\t")) [label, secret] = line.split(/\t(.+)/, 2);
            else if (line.includes("|")) [label, secret] = line.split(/\|(.+)/, 2);
            else if (line.includes(",")) {
                const fields = parseCsvLine(line);
                if (fields.length !== 2) fail("CSV 每行必须是“名称,密钥”两列", "AMBIGUOUS_INPUT");
                [label, secret] = fields;
            }
            const normalized = normalizeSecret(secret);
            const colon = label.indexOf(":");
            return { ok: true, account: createAccount({ issuer: colon >= 0 ? label.slice(0, colon) : label, account: colon >= 0 ? label.slice(colon + 1) : label || "未命名账号", secret: normalized, source: "text" }), line: lineNumber };
        } catch (error) {
            return { ok: false, error: error.message, code: error.code, line: lineNumber, raw: line };
        }
    }

    function parseBulkText(text) {
        return String(text || "").split(/\r?\n/).map((line, index) => parseTextLine(line, index + 1)).filter(Boolean);
    }

    function toOtpAuth(account) {
        const value = createAccount(account);
        const label = value.issuer ? value.issuer + ":" + value.account : value.account;
        const params = new URLSearchParams();
        params.set("secret", value.secret);
        if (value.issuer) params.set("issuer", value.issuer);
        params.set("algorithm", value.algorithm);
        params.set("digits", String(value.digits));
        params.set("period", String(value.period));
        return "otpauth://totp/" + encodeURIComponent(label) + "?" + params.toString();
    }

    async function generateTOTP(secret, options) {
        const settings = options || {};
        const algorithm = normalizeAlgorithm(settings.algorithm, true);
        const digits = normalizeDigits(settings.digits, true);
        const period = normalizePeriod(settings.period, true);
        const timestamp = settings.timestamp == null ? Date.now() : Number(settings.timestamp);
        if (!Number.isFinite(timestamp) || timestamp < 0 || !Number.isSafeInteger(Math.floor(timestamp))) fail("时间戳无效", "INVALID_TIMESTAMP");
        const counter = Math.floor(timestamp / 1000 / period);
        const message = new ArrayBuffer(8);
        const view = new DataView(message);
        view.setUint32(0, Math.floor(counter / 0x100000000), false);
        view.setUint32(4, counter >>> 0, false);
        const key = await crypto.subtle.importKey("raw", base32ToBytes(normalizeSecret(secret)), { name: "HMAC", hash: HASH_NAMES[algorithm] }, false, ["sign"]);
        const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
        const offset = digest[digest.length - 1] & 15;
        const binary = (((digest[offset] & 127) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3]) >>> 0;
        return String(binary % Math.pow(10, digits)).padStart(digits, "0");
    }

    function formatCode(code) {
        const value = String(code || "");
        return value.length === 8 ? value.slice(0, 4) + " " + value.slice(4) : value.slice(0, 3) + " " + value.slice(3);
    }

    return { DEFAULTS, normalizeSecret, base32ToBytes, bytesToBase32, createAccount, parseOtpAuth, parseTextLine, parseBulkText, toOtpAuth, generateTOTP, formatCode };
});
