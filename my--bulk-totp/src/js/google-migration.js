/* Google Authenticator migration protocol (bounded protobuf implementation). */
(function (root, factory) {
    const api = factory(root.TotpCore);
    if (typeof module === "object" && module.exports) module.exports = api;
    root.GoogleMigration = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Core) {
    "use strict";
    const MAX_PAYLOAD = 1024 * 1024;
    const ALGORITHMS = { 1: "SHA1", 2: "SHA256", 3: "SHA512" };
    const ALGORITHM_IDS = { SHA1: 1, SHA256: 2, SHA512: 3 };

    class Reader {
        constructor(bytes) { this.bytes = bytes; this.pos = 0; }
        varint() {
            let value = 0;
            let factor = 1;
            for (let i = 0; i < 10; i += 1) {
                if (this.pos >= this.bytes.length) throw new Error("Protobuf varint 被截断");
                const byte = this.bytes[this.pos++];
                value += (byte & 127) * factor;
                if (!(byte & 128)) {
                    if (!Number.isSafeInteger(value)) throw new Error("Protobuf 整数超出安全范围");
                    return value;
                }
                factor *= 128;
            }
            throw new Error("Protobuf varint 过长");
        }
        data(length) {
            if (!Number.isSafeInteger(length) || length < 0 || this.pos + length > this.bytes.length) throw new Error("Protobuf 字段长度无效");
            const result = this.bytes.slice(this.pos, this.pos + length);
            this.pos += length;
            return result;
        }
        skip(wire) {
            if (wire === 0) this.varint();
            else if (wire === 1) this.data(8);
            else if (wire === 2) this.data(this.varint());
            else if (wire === 5) this.data(4);
            else throw new Error("不支持的 Protobuf wire type：" + wire);
        }
        tag() { const tag = this.varint(); return { field: Math.floor(tag / 8), wire: tag & 7 }; }
    }

    function decodeOtp(bytes) {
        const reader = new Reader(bytes);
        const item = { secretBytes: null, name: "", issuer: "", algorithm: 0, digits: 0, type: 0, counter: 0 };
        while (reader.pos < bytes.length) {
            const tag = reader.tag();
            if (tag.field >= 1 && tag.field <= 3 && tag.wire === 2) {
                const data = reader.data(reader.varint());
                if (tag.field === 1) item.secretBytes = data;
                else item[tag.field === 2 ? "name" : "issuer"] = new TextDecoder("utf-8", { fatal: true }).decode(data);
            } else if (tag.field >= 4 && tag.field <= 7 && tag.wire === 0) {
                const value = reader.varint();
                item[{ 4: "algorithm", 5: "digits", 6: "type", 7: "counter" }[tag.field]] = value;
            } else reader.skip(tag.wire);
        }
        if (!item.secretBytes || !item.secretBytes.length) throw new Error("迁移账号缺少密钥");
        if (item.type === 1) return { unsupported: true, reason: "HOTP 暂不支持", name: item.name, issuer: item.issuer };
        if (item.type !== 2) throw new Error("迁移账号类型未知");
        if (!ALGORITHMS[item.algorithm]) throw new Error("迁移账号算法不受支持");
        if (item.digits !== 1 && item.digits !== 2) throw new Error("迁移账号位数不受支持");
        return Core.createAccount({ issuer: item.issuer, account: item.name, secret: Core.bytesToBase32(item.secretBytes), algorithm: ALGORITHMS[item.algorithm], digits: item.digits === 2 ? 8 : 6, period: 30, source: "google-migration" });
    }

    function base64ToBytes(value) {
        if (value.length > MAX_PAYLOAD * 2) throw new Error("迁移数据过大");
        const binary = atob(value.replace(/ /g, "+"));
        if (binary.length > MAX_PAYLOAD) throw new Error("迁移数据过大");
        return Uint8Array.from(binary, (character) => character.charCodeAt(0));
    }

    function bytesToBase64(bytes) {
        let output = "";
        for (let i = 0; i < bytes.length; i += 0x8000) output += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return btoa(output);
    }

    function decodeUri(uri) {
        const url = new URL(uri);
        if (url.protocol !== "otpauth-migration:" || url.hostname !== "offline") throw new Error("不是 Google Authenticator 迁移链接");
        const values = url.searchParams.getAll("data");
        if (values.length !== 1 || !values[0]) throw new Error("迁移链接缺少或重复 data 参数");
        const bytes = base64ToBytes(values[0]);
        const reader = new Reader(bytes);
        const page = { accounts: [], unsupported: [], version: null, batchSize: null, batchIndex: null, batchId: null };
        while (reader.pos < bytes.length) {
            const tag = reader.tag();
            if (tag.field === 1 && tag.wire === 2) {
                const item = decodeOtp(reader.data(reader.varint()));
                (item.unsupported ? page.unsupported : page.accounts).push(item);
            } else if (tag.field >= 2 && tag.field <= 5 && tag.wire === 0) {
                page[{ 2: "version", 3: "batchSize", 4: "batchIndex", 5: "batchId" }[tag.field]] = reader.varint();
            } else reader.skip(tag.wire);
        }
        if (page.version !== 1) throw new Error("不支持的迁移版本");
        if (!Number.isInteger(page.batchSize) || page.batchSize < 1 || page.batchSize > 100) throw new Error("迁移批次数量无效");
        if (!Number.isInteger(page.batchIndex) || page.batchIndex < 0 || page.batchIndex >= page.batchSize) throw new Error("迁移页码无效");
        if (!Number.isInteger(page.batchId)) throw new Error("迁移批次 ID 无效");
        return page;
    }

    function varint(value) {
        const output = [];
        let number = value;
        do { let byte = number % 128; number = Math.floor(number / 128); if (number) byte |= 128; output.push(byte); } while (number);
        return output;
    }
    function fieldVarint(field, value) { return [...varint(field * 8), ...varint(value)]; }
    function fieldData(field, data) { return [...varint(field * 8 + 2), ...varint(data.length), ...data]; }
    function encodeOtp(account) {
        const item = Core.createAccount(account);
        const output = [];
        output.push(...fieldData(1, Core.base32ToBytes(item.secret)));
        output.push(...fieldData(2, new TextEncoder().encode(item.account)));
        output.push(...fieldData(3, new TextEncoder().encode(item.issuer)));
        output.push(...fieldVarint(4, ALGORITHM_IDS[item.algorithm]));
        output.push(...fieldVarint(5, item.digits === 8 ? 2 : 1));
        output.push(...fieldVarint(6, 2));
        return output;
    }
    function encodePage(accounts, info) {
        const output = [];
        accounts.forEach((account) => output.push(...fieldData(1, encodeOtp(account))));
        output.push(...fieldVarint(2, 1), ...fieldVarint(3, info.batchSize), ...fieldVarint(4, info.batchIndex), ...fieldVarint(5, info.batchId));
        return "otpauth-migration://offline?data=" + encodeURIComponent(bytesToBase64(new Uint8Array(output)));
    }

    function exportPages(accounts, maxUriLength) {
        if (!accounts.length) throw new Error("没有可导出的账号");
        const limit = maxUriLength || 1800;
        const groups = [];
        let current = [];
        for (const account of accounts) {
            if (account.period !== 30) throw new Error("Google 迁移协议不支持非 30 秒周期：" + account.account);
            const candidate = current.concat(account);
            if (current.length && encodePage(candidate, { batchSize: 99, batchIndex: 98, batchId: 2147483647 }).length > limit) { groups.push(current); current = [account]; }
            else current = candidate;
        }
        if (current.length) groups.push(current);
        if (groups.length > 100) throw new Error("账号数量过多，无法生成迁移批次");
        const random = new Uint32Array(1);
        crypto.getRandomValues(random);
        const batchId = random[0] & 0x7fffffff;
        return groups.map((group, index) => encodePage(group, { batchSize: groups.length, batchIndex: index, batchId }));
    }

    class BatchCollector {
        constructor() { this.reset(); }
        reset() { this.batchId = null; this.batchSize = null; this.pages = new Map(); }
        add(uri) {
            const page = decodeUri(uri);
            if (this.batchId == null) { this.batchId = page.batchId; this.batchSize = page.batchSize; }
            if (page.batchId !== this.batchId || page.batchSize !== this.batchSize) throw new Error("二维码不属于同一迁移批次");
            if (this.pages.has(page.batchIndex)) return { duplicate: true, complete: this.pages.size === this.batchSize, received: this.pages.size, total: this.batchSize };
            this.pages.set(page.batchIndex, page);
            const complete = this.pages.size === this.batchSize;
            return { duplicate: false, complete, received: this.pages.size, total: this.batchSize, accounts: complete ? Array.from(this.pages.keys()).sort((a, b) => a - b).flatMap((index) => this.pages.get(index).accounts) : [], unsupported: complete ? Array.from(this.pages.values()).flatMap((item) => item.unsupported) : [] };
        }
    }

    return { decodeUri, encodePage, exportPages, BatchCollector };
});
