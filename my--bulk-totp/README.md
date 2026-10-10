# 本地验证器（Offline Authenticator）

完全本地、零网络请求的 TOTP 临时查询、账号管理与迁移工具。

## 直接使用

复制完整的 `dist/` 目录，然后双击其中的 `index.html`。运行时不需要 Node、不需要安装依赖、不需要服务器，也不访问 CDN。

## 两个独立场景

### 1. 临时查询（默认）

- 粘贴 Base32 TOTP 密钥，点击“临时查看”。
- 立即显示动态验证码、倒计时，并在周期切换时自动刷新。
- 服务名称和账号备注均可不填。
- 默认不加入账号列表、不写入 localStorage 或加密仓库。
- 清空输入或关闭页面后，临时密钥即从当前页面消失。

### 2. 本地账号库（可选）

- 用户明确点击“添加到账号列表”后，账号才进入当前列表。
- 当前列表默认仍只存在于页面内存。
- 只有主动启用加密仓库后，列表才会以 AES-GCM 密文形式保存。
- 支持主密码解锁和本机自动解锁，两种模式安全边界不同。

## 功能范围

- RFC 6238 TOTP：SHA-1 / SHA-256 / SHA-512，6 位或 8 位，1–300 秒周期。
- Base32、`otpauth://totp`、`名称|密钥`、Tab 和两列 CSV 导入。
- 验证码自动倒计时、周期边界刷新、复制与搜索。
- 黑、白、灰中性色界面；浅色、深色及跟随系统三种主题状态。
- 标准 TOTP 二维码本地生成、链接复制及 PNG 下载。
- 图片、拖放、剪贴板、二维码文本及浏览器允许时的摄像头导入。
- Google Authenticator Migration 批量导入和导出，包括多页批次。
- AES-GCM 加密保存；主密码模式使用 PBKDF2-SHA-256。

## 平台兼容边界

标准 `otpauth://totp` 可供 Google Authenticator、Microsoft Authenticator、Oracle Mobile Authenticator 及其他兼容验证器扫描。兼容性最佳的参数是 SHA-1、6 位、30 秒。

本工具不迁移 Microsoft/Oracle 专有云备份、推送验证、无密码凭据、设备注册或设备绑定数据，也不支持 HOTP 计数器账号。Google 批量迁移格式是 Google 专用协议。

## 安全说明

- 密钥和迁移二维码等同第二因素本身，任何持有者都能生成未来验证码。
- CSP 禁止网络连接、远程资源、对象、框架和表单提交。
- 离线运行不能防护已被入侵的设备、恶意扩展、截图或剪贴板管理器。
- 主密码不会保存；localStorage 中仅保存 AES-GCM 密文和非秘密参数。
- 自动解锁密钥位于同一浏览器配置的 IndexedDB 中，便利但无法抵御本机访问者。
- 不同浏览器对 `file://` 下的 Web Crypto、IndexedDB、剪贴板和摄像头权限支持不同；图片导入是最稳定的 QR 导入方式。

## 维护与构建

唯一可编辑源码位于 `src/`。`dist/` 是生成后的正式交付物，请勿手工修改。

```text
src/index.html
src/assets/styles.css
src/js/*.js
tools/build.js
tools/verify-dist.js
tests/*.js
dist/                    可直接复制使用
```

开发验证：

```bash
npm run check
```

该命令依次运行源码协议测试、确定性构建、产物协议测试和离线交付审计。构建同时生成 `dist/MANIFEST.sha256` 和第三方许可证说明。

发布前仍应在目标 Chromium、Firefox 和 Safari 中使用测试密钥进行 `file://` 手工验证。不得把真实 TOTP 密钥写入测试、文档或构建物。
