(function () {
    "use strict";
    const $ = (id) => document.getElementById(id);
    const Core = TotpCore;
    const collector = new GoogleMigration.BatchCollector();
    let accounts = [];
    let renderVersion = 0;
    let preview = [];
    let qrPages = [];
    let qrIndex = 0;
    let stream = null;
    let selectedVaultMode = null;
    let quickAccount = null;
    let quickRequest = 0;

    function toast(message) { const element = $("toast"); element.textContent = message; element.classList.add("show"); clearTimeout(element.timer); element.timer = setTimeout(() => element.classList.remove("show"), 1800); }
    function show(dialog) { if (!dialog.open) dialog.showModal(); }
    function close(dialog) { if (dialog.open) dialog.close(); }
    async function copy(text, message) {
        try { await navigator.clipboard.writeText(text); toast(message || "已复制"); }
        catch (_) {
            const input = document.createElement("textarea"); input.value = text; input.style.position = "fixed"; input.style.opacity = "0"; document.body.appendChild(input); input.select(); const ok = document.execCommand("copy"); input.remove(); toast(ok ? (message || "已复制") : "复制失败，请手动复制");
        }
    }
    function safeAccount(value) { return { id: value.id, issuer: value.issuer, account: value.account, secret: value.secret, type: value.type, algorithm: value.algorithm, digits: value.digits, period: value.period, source: value.source, warnings: value.warnings || [] }; }
    function dedupe(values) {
        const seen = new Set(accounts.map((item) => [item.secret, item.issuer, item.account].join("|")));
        return values.filter((item) => { const key = [item.secret, item.issuer, item.account].join("|"); if (seen.has(key)) return false; seen.add(key); return true; });
    }
    async function persist() {
        const status = EncryptedVault.status();
        if (!status.exists) return;
        try { await EncryptedVault.save(accounts.map(safeAccount)); }
        catch (error) { toast(error.message); }
    }

    function clearQuick() {
        quickRequest += 1;
        quickAccount = null;
        $("quickSecret").value = "";
        $("quickIssuer").value = "";
        $("quickAccount").value = "";
        $("saveQuickChoice").checked = false;
        $("quickPrivacy").textContent = "本次仅临时查看，不会保存密钥。";
        $("quickError").textContent = "";
        $("quickResult").classList.add("hidden");
        $("quickCode").textContent = "--- ---";
        $("quickSecret").focus();
    }

    async function updateQuick(now) {
        if (!quickAccount) return;
        const counter = Math.floor(now / 1000 / quickAccount.period);
        const remainingMs = quickAccount.period * 1000 - (now % (quickAccount.period * 1000));
        $("quickRemaining").textContent = Math.ceil(remainingMs / 1000) + " 秒后过期";
        $("quickProgress").style.transform = "scaleX(" + Math.max(0, remainingMs / (quickAccount.period * 1000)) + ")";
        $("quickResult").classList.toggle("soon", remainingMs <= 5000);
        if (quickAccount.counter === counter && quickAccount.code) return;
        quickAccount.counter = counter;
        const request = ++quickRequest;
        $("quickCode").textContent = "更新中";
        try {
            const code = await Core.generateTOTP(quickAccount.secret, { algorithm: quickAccount.algorithm, digits: quickAccount.digits, period: quickAccount.period, timestamp: now });
            if (!quickAccount || request !== quickRequest || quickAccount.counter !== counter) return;
            quickAccount.code = code;
            $("quickCode").textContent = Core.formatCode(code);
        } catch (error) {
            if (request === quickRequest) $("quickError").textContent = error.message;
        }
    }

    async function generateQuick() {
        $("quickError").textContent = "";
        try {
            const shouldSave = $("saveQuickChoice").checked;
            quickAccount = Core.createAccount({
                issuer: $("quickIssuer").value,
                account: $("quickAccount").value || (shouldSave ? "未命名账号" : "临时查看"),
                secret: $("quickSecret").value,
                source: shouldSave ? "saved-from-viewer" : "temporary",
            });
            quickAccount.counter = null;
            quickAccount.code = null;
            if (shouldSave) {
                const saved = Core.createAccount({ ...safeAccount(quickAccount), id: undefined, source: "saved-from-viewer" });
                const added = dedupe([saved]);
                if (added.length) {
                    accounts.push(saved);
                    render();
                    await persist();
                    if (EncryptedVault.status().exists) {
                        toast("验证码已查看，账号已加密保存");
                    } else {
                        toast("账号已加入列表，请选择加密保存方式");
                        updateVaultUi();
                        show($("vaultDialog"));
                    }
                } else {
                    toast("验证码已查看，该账号已在列表中");
                }
                $("quickPrivacy").textContent = EncryptedVault.status().exists
                    ? "这个账号已加入列表，并同步到加密本地仓库。"
                    : "这个账号已加入当前列表；请选择加密方式完成本地保存。";
            } else {
                $("quickPrivacy").textContent = "本次仅临时查看，不会保存密钥。";
            }
            $("quickResult").classList.remove("hidden");
            await updateQuick(Date.now());
        } catch (error) {
            quickAccount = null;
            $("quickResult").classList.add("hidden");
            $("quickError").textContent = error.message;
        }
    }

    function render() {
        renderVersion += 1;
        const version = renderVersion;
        const container = $("accounts");
        container.replaceChildren();
        const query = $("search").value.trim().toLowerCase();
        const visible = accounts.filter((item) => (item.issuer + " " + item.account).toLowerCase().includes(query));
        $("count").textContent = accounts.length + " 个账号" + (query ? " · 显示 " + visible.length : "");
        if (!visible.length) {
            const empty = document.createElement("div"); empty.className = "empty";
            const strong = document.createElement("strong"); strong.textContent = accounts.length ? "没有匹配账号" : "还没有验证码";
            const span = document.createElement("span"); span.textContent = accounts.length ? "尝试其他搜索词" : "添加密钥或从二维码安全导入";
            empty.append(strong, span); container.appendChild(empty); return;
        }
        visible.forEach((item) => {
            const card = document.createElement("article"); card.className = "account-card"; card.dataset.id = item.id;
            const head = document.createElement("div"); head.className = "account-head";
            const title = document.createElement("div"); title.className = "account-title";
            const issuer = document.createElement("div"); issuer.className = "issuer"; issuer.textContent = item.issuer || "TOTP";
            const name = document.createElement("div"); name.className = "account-name"; name.textContent = item.account;
            title.append(issuer, name);
            const actions = document.createElement("div"); actions.className = "account-actions";
            const qr = document.createElement("button"); qr.className = "ghost"; qr.textContent = "▣"; qr.title = "显示传输二维码"; qr.setAttribute("aria-label", "显示 " + item.account + " 的传输二维码"); qr.addEventListener("click", () => showAccountQr(item));
            const remove = document.createElement("button"); remove.className = "ghost danger"; remove.textContent = "×"; remove.title = "删除"; remove.setAttribute("aria-label", "删除 " + item.account); remove.addEventListener("click", async () => { if (confirm("从当前列表删除“" + item.account + "”？")) { accounts = accounts.filter((value) => value.id !== item.id); render(); await persist(); } });
            actions.append(qr, remove); head.append(title, actions);
            const codeLine = document.createElement("div"); codeLine.className = "code-line";
            const code = document.createElement("span"); code.className = "code"; code.textContent = item.code ? Core.formatCode(item.code) : "··· ···";
            const copyButton = document.createElement("button"); copyButton.className = "copy-code"; copyButton.textContent = "复制"; copyButton.addEventListener("click", () => item.code && copy(item.code, "验证码已复制"));
            codeLine.append(code, copyButton);
            const expiry = document.createElement("div"); expiry.className = "expiry"; const left = document.createElement("span"); left.textContent = "正在计算"; const config = document.createElement("span"); config.textContent = item.algorithm + " · " + item.digits + " 位"; expiry.append(left, config);
            const progress = document.createElement("div"); progress.className = "progress"; const bar = document.createElement("span"); progress.appendChild(bar);
            card.append(head, codeLine, expiry, progress); container.appendChild(card); item.elements = { card, code, left, bar };
            refreshCode(item, Date.now(), version);
        });
    }

    async function refreshCode(item, now, version) {
        const counter = Math.floor(now / 1000 / item.period);
        if (item.counter === counter && item.code) return;
        item.counter = counter; item.request = (item.request || 0) + 1; const request = item.request;
        if (item.elements) item.elements.code.textContent = "更新中";
        try {
            const code = await Core.generateTOTP(item.secret, { algorithm: item.algorithm, digits: item.digits, period: item.period, timestamp: now });
            if (version !== renderVersion || request !== item.request || item.counter !== counter || !item.elements) return;
            item.code = code; item.elements.code.textContent = Core.formatCode(code);
        } catch (error) { if (item.elements) item.elements.code.textContent = "生成失败"; }
    }

    function tick() {
        const now = Date.now(); const time = new Date(now); $("clock").textContent = [time.getHours(), time.getMinutes(), time.getSeconds()].map((v) => String(v).padStart(2, "0")).join(":") + " 本机时间";
        updateQuick(now);
        for (const item of accounts) {
            if (!item.elements || !document.body.contains(item.elements.card)) continue;
            const remainingMs = item.period * 1000 - (now % (item.period * 1000)); const seconds = Math.ceil(remainingMs / 1000); const soon = seconds <= 5;
            item.elements.left.textContent = seconds + " 秒后过期"; item.elements.card.classList.toggle("soon", soon); item.elements.bar.style.transform = "scaleX(" + Math.max(0, remainingMs / (item.period * 1000)) + ")";
            refreshCode(item, now, renderVersion);
        }
    }

    function renderPreview(items, target) {
        target.replaceChildren();
        items.forEach((result) => {
            const row = document.createElement("label"); row.className = "preview-item" + (result.ok ? "" : " error");
            const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.checked = result.ok; checkbox.disabled = !result.ok;
            const content = document.createElement("div"); const title = document.createElement("strong"); const detail = document.createElement("span");
            if (result.ok) { title.textContent = (result.account.issuer || "TOTP") + " · " + result.account.account; detail.textContent = result.account.algorithm + " / " + result.account.digits + " 位 / " + result.account.period + " 秒"; }
            else { title.textContent = "第 " + result.line + " 行无法导入"; detail.textContent = result.error; }
            content.append(title, detail); row.append(checkbox, content); row.checkbox = checkbox; result.checkbox = checkbox; target.appendChild(row);
        });
    }

    function processDecoded(text) {
        try {
            if (/^otpauth-migration:\/\//i.test(text.trim())) {
                const result = collector.add(text.trim());
                const status = document.createElement("div"); status.className = "preview-item"; const content = document.createElement("div"); const strong = document.createElement("strong"); const detail = document.createElement("span");
                strong.textContent = result.duplicate ? "这一页已经扫描过" : "Google 迁移批次：" + result.received + " / " + result.total + " 页";
                detail.textContent = result.complete ? "批次完整，已导入 " + result.accounts.length + " 个 TOTP 账号" : "请继续扫描此批次的其他二维码"; content.append(strong, detail); status.append(content); $("importStatus").appendChild(status);
                if (result.complete) { const added = dedupe(result.accounts); accounts.push(...added); render(); persist(); collector.reset(); toast("已导入 " + added.length + " 个账号"); }
            } else {
                const account = Core.parseOtpAuth(text.trim()); const added = dedupe([account]); if (added.length) { accounts.push(account); render(); persist(); toast("账号已导入"); } else toast("该账号已存在");
            }
        } catch (error) { const row = document.createElement("div"); row.className = "preview-item error"; const content = document.createElement("div"); const strong = document.createElement("strong"); strong.textContent = "无法导入"; const detail = document.createElement("span"); detail.textContent = error.message; content.append(strong, detail); row.append(content); $("importStatus").appendChild(row); }
    }

    async function processFile(file) { try { processDecoded(await LocalQR.decodeFile(file)); } catch (error) { toast(error.message); } }
    function drawCurrentQr() {
        const value = qrPages[qrIndex]; LocalQR.render(value, $("qrCanvas"), 360); $("qrPage").textContent = qrPages.length > 1 ? "第 " + (qrIndex + 1) + " / " + qrPages.length + " 页" : "";
        $("prevQr").classList.toggle("hidden", qrPages.length < 2 || qrIndex === 0); $("nextQr").classList.toggle("hidden", qrPages.length < 2 || qrIndex === qrPages.length - 1);
    }
    function showAccountQr(account) { qrPages = [Core.toOtpAuth(account)]; qrIndex = 0; $("qrTitle").textContent = "传输二维码"; $("qrSubtitle").textContent = (account.issuer || "TOTP") + " · " + account.account; drawCurrentQr(); show($("qrDialog")); }
    function showGoogleExport() { try { qrPages = GoogleMigration.exportPages(accounts); qrIndex = 0; $("qrTitle").textContent = "导出到 Google Authenticator"; $("qrSubtitle").textContent = accounts.length + " 个账号 · 按顺序扫描全部页面"; drawCurrentQr(); show($("qrDialog")); } catch (error) { toast(error.message); } }

    $("quickForm").addEventListener("submit", (event) => { event.preventDefault(); generateQuick(); });
    $("quickCode").addEventListener("click", () => quickAccount && quickAccount.code && copy(quickAccount.code, "验证码已复制"));
    $("clearQuick").addEventListener("click", clearQuick);
    document.querySelectorAll("dialog .close").forEach((button) => button.addEventListener("click", () => close(button.closest("dialog"))));
    document.querySelectorAll("dialog").forEach((dialog) => dialog.addEventListener("close", () => { if (dialog === $("importDialog")) stopCamera(); }));
    $("addBtn").addEventListener("click", () => { $("bulkInput").value = ""; preview = []; $("textPreview").replaceChildren(); show($("addDialog")); $("bulkInput").focus(); });
    $("bulkInput").addEventListener("input", () => { preview = Core.parseBulkText($("bulkInput").value); renderPreview(preview, $("textPreview")); });
    $("confirmAdd").addEventListener("click", async () => { const selected = preview.filter((item) => item.ok && item.checkbox.checked).map((item) => item.account); const added = dedupe(selected); accounts.push(...added); render(); close($("addDialog")); await persist(); toast("已添加 " + added.length + " 个账号"); });
    $("importBtn").addEventListener("click", () => show($("importDialog")));
    $("processQrText").addEventListener("click", () => processDecoded($("qrText").value));
    $("fileInput").addEventListener("change", (event) => event.target.files[0] && processFile(event.target.files[0]));
    $("dropZone").addEventListener("dragover", (event) => { event.preventDefault(); event.currentTarget.classList.add("drag"); });
    $("dropZone").addEventListener("dragleave", (event) => event.currentTarget.classList.remove("drag"));
    $("dropZone").addEventListener("drop", (event) => { event.preventDefault(); event.currentTarget.classList.remove("drag"); if (event.dataTransfer.files[0]) processFile(event.dataTransfer.files[0]); });
    document.addEventListener("paste", (event) => { if (!$("importDialog").open) return; const item = Array.from(event.clipboardData.items).find((entry) => entry.type.startsWith("image/")); if (item) { event.preventDefault(); processFile(item.getAsFile()); } });
    $("googleExportBtn").addEventListener("click", showGoogleExport);
    $("prevQr").addEventListener("click", () => { qrIndex -= 1; drawCurrentQr(); }); $("nextQr").addEventListener("click", () => { qrIndex += 1; drawCurrentQr(); });
    $("copyUri").addEventListener("click", () => copy(qrPages[qrIndex], "迁移链接已复制"));
    $("downloadQr").addEventListener("click", () => { const link = document.createElement("a"); link.download = "totp-qr-" + (qrIndex + 1) + ".png"; link.href = $("qrCanvas").toDataURL("image/png"); link.click(); });
    $("search").addEventListener("input", render);
    $("clearBtn").addEventListener("click", async () => { if (accounts.length && confirm("清空当前列表中的全部账号？已启用的加密仓库也会同步更新。")) { accounts = []; render(); await persist(); } });
    const themeMedia = matchMedia("(prefers-color-scheme: dark)");
    function applyTheme() {
        const preference = localStorage.getItem("offline-totp-theme") || "system";
        document.body.classList.toggle("dark", preference === "dark" || (preference === "system" && themeMedia.matches));
        $("themeBtn").title = "主题：" + ({ system: "跟随系统", light: "浅色", dark: "深色" }[preference]);
        $("themeBtn").setAttribute("aria-label", $("themeBtn").title + "，点击切换");
    }
    $("themeBtn").addEventListener("click", () => {
        const current = localStorage.getItem("offline-totp-theme") || "system";
        localStorage.setItem("offline-totp-theme", current === "system" ? "light" : current === "light" ? "dark" : "system");
        applyTheme();
        toast($("themeBtn").title);
    });
    if (themeMedia.addEventListener) themeMedia.addEventListener("change", applyTheme);
    else if (themeMedia.addListener) themeMedia.addListener(applyTheme);

    async function startCamera() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return toast("当前浏览器或本地文件环境不支持相机，请上传图片");
        try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false }); const video = $("camera"); video.srcObject = stream; video.classList.remove("hidden"); await video.play(); cameraLoop(); } catch (_) { toast("无法使用相机，请检查权限或改用图片导入"); }
    }
    async function cameraLoop() { if (!stream) return; const result = await LocalQR.scanVideo($("camera")); if (result) { stopCamera(); processDecoded(result); } else requestAnimationFrame(cameraLoop); }
    function stopCamera() { if (stream) stream.getTracks().forEach((track) => track.stop()); stream = null; $("camera").classList.add("hidden"); }
    $("cameraBtn").addEventListener("click", startCamera);

    function updateVaultUi() {
        const status = EncryptedVault.status(); $("vaultStatus").textContent = status.exists ? (status.mode === "password" ? "主密码加密仓库已启用" : "本机自动解锁仓库已启用") : "默认仅保留在当前页面内存";
        $("vaultSetup").classList.toggle("hidden", status.exists); $("vaultUnlock").classList.toggle("hidden", !status.exists || status.mode !== "password"); $("forgetVault").classList.toggle("hidden", !status.exists);
    }
    $("vaultBtn").addEventListener("click", () => { updateVaultUi(); show($("vaultDialog")); });
    $("passwordMode").addEventListener("click", () => { selectedVaultMode = "password"; $("passwordField").classList.remove("hidden"); $("vaultPassword").focus(); });
    $("vaultPassword").addEventListener("change", async () => { if (selectedVaultMode !== "password") return; try { await EncryptedVault.createPassword(accounts.map(safeAccount), $("vaultPassword").value); $("vaultPassword").value = ""; updateVaultUi(); toast("主密码仓库已创建"); } catch (error) { toast(error.message); } });
    $("deviceMode").addEventListener("click", async () => { if (!confirm("自动解锁密钥会保存在同一浏览器配置中。它无法抵御能访问此浏览器或设备的人。仍要启用吗？")) return; try { await EncryptedVault.createDevice(accounts.map(safeAccount)); updateVaultUi(); toast("本机自动解锁已启用"); } catch (error) { toast(error.message); } });
    $("unlockBtn").addEventListener("click", async () => { try { accounts = (await EncryptedVault.unlockPassword($("unlockPassword").value)).map(Core.createAccount); $("unlockPassword").value = ""; render(); close($("vaultDialog")); toast("仓库已解锁"); } catch (error) { toast(error.message); } });
    $("forgetVault").addEventListener("click", async () => { if (confirm("永久删除浏览器中保存的加密仓库？当前页面内存中的账号不会立即删除。")) { await EncryptedVault.clear(); updateVaultUi(); toast("本地仓库已删除"); } });

    async function initialize() {
        applyTheme();
        try { const status = EncryptedVault.status(); if (status.mode === "device") { accounts = (await EncryptedVault.unlockDevice()).map(Core.createAccount); toast("已从本机加密仓库恢复"); } else if (status.mode === "password") { updateVaultUi(); show($("vaultDialog")); } } catch (error) { toast(error.message); }
        render(); tick(); setInterval(tick, 250); document.addEventListener("visibilitychange", () => !document.hidden && tick()); window.addEventListener("focus", tick);
    }
    initialize();
})();
