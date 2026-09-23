# dsh-tweaks

一个 [DeepSeek Harness](https://github.com/deepseek-ai)（DSH）的**体验优化插件**。

补上官方设置界面里两个"适配器其实支持、但界面没有入口"的能力。装上后重启 profile 即可，无需改任何代码。

两个功能都在「设置」里：

---

## 功能一：为每个模型单独开关「图片输入」（设置 → 模型）

### 解决了什么问题

DSH 的 `llm-pi-ai` 适配器其实支持给单个模型声明 `input: ["text", "image"]`，
但官方的模型编辑器**从来没画过这个开关**。

后果是：你在 `settings.yaml` 里手写的每一个模型，都**静默退化成纯文本**
（因为 `DEFAULT_INPUT = ["text"]`）—— 哪怕你的模型明明支持看图。

想开启只能手改 YAML 文件，而且很容易改错、改完不知道生没生效。

### 现在

每张提供方卡片上多出一个 **图片输入能力** 面板，勾选即写入 `input: [text, image]`，
取消勾选则移除该字段、回落到适配器默认的纯文本。

列表超过 3.5 行会折叠，第 4 行用渐变遮罩淡出。

### 哪些路由能改、哪些不能

面板改的是某个路由**用户层的 `models` 列表**，所以只能碰到**你自己手写的模型**：

- **手写 `models` 列表** —— ✅ 可改，这是最常见的情况
- **目录路由且没有 `models` 列表** —— ❌ 面板会提示"没有手写的模型列表"。
  这类路由用的是 pi-ai 已安装的目录，能力由目录决定；要改单个模型请用 `modelOverrides`
- **网关类路由**（自建转发端点，pi-ai 目录里没有的）—— ❌ pi-ai 官方建议这类路由
  在路由级的 `defaultInput` 上**一次性声明** `[text, image]`，而不是每个模型写一遍。
  面板不写 `defaultInput`，需要的话请直接编辑 `settings.yaml`

两者不能互相替代：`models[].input` 只覆盖单个模型，而 `defaultInput` 是路由级兜底，
模型自己没声明时才继承它。

另外要注意：`input` 是**声明**，不是**探测**——没有任何机制会去问网关到底支不支持，
所以给一个实际不支持的模型开了图片，请求会在中途被提供方拒绝。

---

## 功能二：通用系统指令（设置 → 个性化）

一个文本框，内容会被注入**每次对话系统提示词的最开头** ——
在 harness 身份说明之后、所有工具与策略说明之前。

适合放那些你本来每次开会话都要重新交代一遍的长期偏好，例如：

> 始终用中文回答；先给结论再给理由；不要奉承，直接指出我的错误。

离开输入框即自动保存（和原生设置项一致，没有保存按钮）。**留空则不注入任何内容**。

---

## 安装

```sh
dsh plugin --profile web add dsh-tweaks
```

或从本地目录安装：

```sh
dsh plugin --profile web add file:/path/to/dsh-tweaks
```

装完**重启 profile**。

---

## 开发

```sh
pnpm install
pnpm run build     # -> lib/index.js（Host 半侧）, lib/client.js（浏览器半侧）
pnpm run watch
```

### 目录结构

```
src/shared/constants.ts   两侧共用的名字（命名空间、字段、RPC 方法）
src/host/index.ts         设置读写 + 系统提示词段落 + HTTP 路由
src/client/index.tsx      设置界面（React，打包进浏览器）
cordis.patch.yml          声明 bundle 行
scripts/wrap-client.mjs   给浏览器产物套上 __ModuleLoader__ 信封
```

### 为什么 Host 半侧能拥有自己的命名空间

*动态* Cordis 插件的 Host 半侧跑在 `node:vm` 沙箱里、没有 schemastery，
因此无法调用 `settings.register()`，只能借用已有命名空间。

而真正的 bundle Host 半侧是普通 Node 模块，所以 `dsh-tweaks` 可以注册自己的
`dsh-tweaks` 设置命名空间。

---

## 许可

MIT
