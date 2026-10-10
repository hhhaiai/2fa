/* Encrypted local vault. localStorage stores ciphertext only. */
(function (root) {
    "use strict";
    const STORAGE_KEY = "offline-totp-vault-v2";
    const DB_NAME = "offline-totp-key-store";
    const ITERATIONS = 310000;
    const encoder = new TextEncoder();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let activeKey = null;
    let activeMode = null;

    function bytes(value) { return Uint8Array.from(atob(value), (character) => character.charCodeAt(0)); }
    function base64(value) { let output = ""; for (let i = 0; i < value.length; i += 0x8000) output += String.fromCharCode.apply(null, value.subarray(i, i + 0x8000)); return btoa(output); }
    function random(length) { const value = new Uint8Array(length); crypto.getRandomValues(value); return value; }

    async function derive(password, salt, iterations) {
        const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
        return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    }
    async function encrypt(key, value, aad) {
        const iv = random(12);
        const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(aad) }, key, encoder.encode(JSON.stringify(value)));
        return { iv: base64(iv), data: base64(new Uint8Array(data)) };
    }
    async function decrypt(key, value, aad) {
        const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(value.iv), additionalData: encoder.encode(aad) }, key, bytes(value.data));
        return JSON.parse(decoder.decode(plain));
    }
    async function openDb() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, 1);
            request.onupgradeneeded = () => request.result.createObjectStore("keys");
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    async function dbAction(mode, callback) {
        const db = await openDb();
        try {
            return await new Promise((resolve, reject) => {
                const tx = db.transaction("keys", mode);
                const store = tx.objectStore("keys");
                const request = callback(store);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        } finally { db.close(); }
    }
    function readRecord() {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const record = JSON.parse(raw);
        if (record.version !== 2 || !["password", "device"].includes(record.mode)) throw new Error("本地仓库格式不受支持或已损坏");
        return record;
    }
    function writeRecord(record) {
        const serialized = JSON.stringify(record);
        localStorage.setItem(STORAGE_KEY + "-pending", serialized);
        localStorage.setItem(STORAGE_KEY, serialized);
        localStorage.removeItem(STORAGE_KEY + "-pending");
    }
    async function createPassword(accounts, password) {
        if (String(password).length < 10) throw new Error("主密码至少需要 10 个字符");
        const salt = random(16);
        const key = await derive(password, salt, ITERATIONS);
        activeKey = key;
        activeMode = "password";
        const payload = await encrypt(key, { accounts, savedAt: Date.now() }, "offline-totp-v2-password");
        writeRecord({ version: 2, mode: "password", kdf: { name: "PBKDF2-SHA256", iterations: ITERATIONS, salt: base64(salt) }, payload });
    }
    async function unlockPassword(password) {
        const record = readRecord();
        if (!record || record.mode !== "password") throw new Error("没有主密码仓库");
        try {
            const key = await derive(password, bytes(record.kdf.salt), record.kdf.iterations);
            const accounts = (await decrypt(key, record.payload, "offline-totp-v2-password")).accounts;
            activeKey = key;
            activeMode = "password";
            return accounts;
        } catch (_) { throw new Error("无法解锁：主密码错误或数据已损坏"); }
    }
    async function createDevice(accounts) {
        const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
        activeKey = key;
        activeMode = "device";
        await dbAction("readwrite", (store) => store.put(key, "vault-key"));
        const payload = await encrypt(key, { accounts, savedAt: Date.now() }, "offline-totp-v2-device");
        writeRecord({ version: 2, mode: "device", payload });
    }
    async function unlockDevice() {
        const record = readRecord();
        if (!record || record.mode !== "device") throw new Error("没有自动解锁仓库");
        const key = await dbAction("readonly", (store) => store.get("vault-key"));
        if (!key) throw new Error("本机解密密钥不存在");
        try {
            const accounts = (await decrypt(key, record.payload, "offline-totp-v2-device")).accounts;
            activeKey = key;
            activeMode = "device";
            return accounts;
        }
        catch (_) { throw new Error("本机仓库已损坏或无法解密"); }
    }
    async function save(accounts, password) {
        const record = readRecord();
        if (!record) throw new Error("尚未启用本地保存");
        if (record.mode === "password") {
            let key = activeMode === "password" ? activeKey : null;
            if (!key && password) key = await derive(password, bytes(record.kdf.salt), record.kdf.iterations);
            if (!key) throw new Error("仓库已锁定，请先用主密码解锁后再保存");
            const payload = await encrypt(key, { accounts, savedAt: Date.now() }, "offline-totp-v2-password");
            writeRecord({ ...record, payload });
            return;
        }
        let key = activeMode === "device" ? activeKey : await dbAction("readonly", (store) => store.get("vault-key"));
        if (!key) throw new Error("本机解密密钥不存在");
        activeKey = key;
        activeMode = "device";
        const payload = await encrypt(key, { accounts, savedAt: Date.now() }, "offline-totp-v2-device");
        writeRecord({ ...record, payload });
    }
    async function clear() {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(STORAGE_KEY + "-pending");
        activeKey = null;
        activeMode = null;
        try { await dbAction("readwrite", (store) => store.delete("vault-key")); } catch (_) { /* storage may be unavailable */ }
    }
    function status() { const record = readRecord(); return record ? { exists: true, mode: record.mode } : { exists: false, mode: null }; }

    root.EncryptedVault = { createPassword, unlockPassword, createDevice, unlockDevice, save, clear, status };
})(globalThis);
