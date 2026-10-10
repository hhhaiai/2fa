# 2FA 验证码绑定到固定网站 + 密钥直接生成验证码实现方案

以下是**最完整、最兼容**的实现方案，完美支持 Google Authenticator、Microsoft Authenticator、Oracle Authenticator、Aegis、2FAS 等所有主流 App。

---

## 一、核心概念：otpauth:// URI 标准绑定

**绑定 = 让 Google Authenticator 等 App 记住一个“密钥”**

当你给某网站绑定 2FA 时，网站会给你一个 **otpauth://** 链接：

```
otpauth://totp/网站名:你的账号?secret=BASE32密钥&issuer=网站名&digits=6&period=30
```

**所有兼容 App（Google/Microsoft/Oracle）都遵循这个标准**，所以绑定成功后：

- 你的手机 App 立刻开始**每 30 秒自动生成一次 6 位验证码**
- 网站可以**通过密钥直接生成当前验证码**（无需再向后端要）

---

## 二、两种实现方式对比

| 方式 | 是否需要存储密钥 | 是否需要后端 | 推荐场景 |
|------|------------------|--------------|----------|
| **方式一**（推荐） | 需要存储（加密后） | 需要 | 大型网站、需要验证 |
| **方式二**（最简单） | 不需要存储 | 提供公共 OTP 接口 | 任何网站都行 |

---

## 三、推荐实现方案（方式二 + 公共 OTP 接口）

这是目前最优雅、最兼容的方式：

### 1. 生成 otpauth:// 链接（前端）

```js
// 生成 otpauth:// URI（兼容所有 App）
function generateOTPAuthURI({
  secret,           // 基础32密钥
  issuer = "MySite",
  account = "user@example.com",
  digits = 6,
  period = 30,
  algorithm = "SHA1"
}) {
  const params = new URLSearchParams({
    secret: secret,
    issuer: issuer,
    digits: digits,
    period: period,
    algorithm: algorithm
  });
  
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?${params.toString()}`;
}
```

### 2. 后端提供公共 OTP 生成接口（核心）

像 `2fa-run` 一样实现：

```js
// GET /otp/{secret} —— 公共端点，无需登录
app.get('/otp/:secret', (req, res) => {
  const { secret } = req.params;
  const { type = 'totp', digits = 6, period = 30, algorithm = 'SHA1', counter } = req.query;
  
  let otp;
  
  if (type === 'hotp') {
    otp = hotp.generate(secret, counter || 0, { digits, algorithm });
  } else {
    otp = totp.generate(secret, { digits, period, algorithm });
  }
  
  res.json({
    otp,
    timeRemaining: period - (Date.now() % period),
    type,
    nextOtp: totp.generate(secret, { digits, period, algorithm }) // 下一个
  });
});
```

### 3. 前端使用（最简单）

```js
// 方式A：直接调用公共接口生成验证码（推荐）
const code = await fetch(`/otp/${secretBase32}`).then(r => r.json()).then(data => data.otp);

// 方式B：自己本地计算（完全离线）
const code = await generateTOTP(secretBase32);
```

---

## 四、完整 TOTP 算法实现（推荐复制 bulk-totp 的实现）

以下是 `bulk-totp/index.html` 核心算法，可直接复用：

```js
// 基础32解码
function base32Decode(str) {
  str = str.replace(/=/g, '').replace(/ /g, '');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = new Uint8Array(str.length * 5 / 8);
  let bitIndex = 0;
  
  for (let char of str) {
    const value = alphabet.indexOf(char.toUpperCase());
    for (let i = 0; i < 5; i++) {
      bits[bitIndex + i] = (value >> (4 - i)) & 1;
    }
    bitIndex += 5;
  }
  return bits;
}

// TOTP 生成
async function generateTOTP(secretBase32, options = {}) {
  const { digits = 6, period = 30, algorithm = 'SHA1' } = options;
  
  const secret = base32Decode(secretBase32);
  const counter = Math.floor(Date.now() / 1000 / period);
  
  // HMAC
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: algorithm }, false, ['sign']);
  const msg = new Uint8Array(8); // big-endian counter
  new DataView(msg.buffer).setUint32(0, counter, false);
  
  const signature = await crypto.subtle.sign('HMAC', key, msg);
  const hmac = new Uint8Array(signature);
  
  // 动态截断
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[offset] & 0x7f) << 24) |
              (hmac[offset + 1] << 16) |
              (hmac[offset + 2] << 8) |
              hmac[offset + 3];
  
  const otp = (bin % Math.pow(10, digits)).toString().padStart(digits, '0');
  return otp;
}
```

---

## 五、实际使用流程（Google Authenticator 绑定流程）

1. 前端生成 otpauth:// 链接 + 二维码
2. 用户用 Google / Microsoft / Oracle 扫描
3. 绑定成功后，网站可以：
   - 存储密钥（方式一）
   - 或者直接调用 `/otp/{secret}` 获取验证码（方式二）

**推荐方式二**（最简单）：

```js
// 登录时直接调用公共接口生成验证码
const { otp, timeRemaining } = await fetch(`/otp/${user.secret}`).then(r => r.json());
```

---

## 六、额外建议

- **加密存储**：如 `2fa/` 项目，使用 AES-256-GCM 加密 `secret`
- **Hotp 支持**：支持计数器模式（银行卡等）
- **多算法支持**：SHA1 / SHA256 / SHA512（Google 用 SHA1，微软用 SHA256）
- **离线模式**：可以让前端完全离线计算（像 `bulk-totp`）

---

**最推荐的项目**：
- `2fa-run/` —— 已有公共 `/otp/{secret}` 接口
- `bulk-totp/` —— 已有完整本地计算实现
- `2FA-App/` —— 已有后端存储 + 验证逻辑

需要我给你**完整可直接使用的代码**（包含 otpauth 生成 + 公共 OTP 接口 + 加密存储）吗？可以直接复制到你的项目中。