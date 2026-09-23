import z from "@deepseek-ai/schemastery";
//#region src/shared/constants.ts
/**
* Shared constants for dsh-tweaks.
*
* Host and client halves are separate bundles, so anything both sides name —
* the namespace, the field, the RPC methods — lives here rather than being
* duplicated as string literals that can drift.
*/
/** Settings namespace holding the general system instruction. */
const PERSONALIZATION_NS = "dsh-tweaks";
/** Field inside that namespace carrying the instruction text. */
const SYSTEM_INSTRUCTION_FIELD = "systemInstruction";
/** The model-catalog namespace the image-input panel edits. */
const LLM_PI_AI_NS = "llm-pi-ai";
/**
* The one HTTP endpoint the browser half calls.
*
* A static client package is a prebuilt `__ModuleLoader__` bundle: it gets a
* `require` shim and nothing else, so the dynamic-half closure symbols
* (`host`, `styles`, `harness`) do not exist for it. The package therefore
* bridges to its own Host half the way every out-of-repository web plugin
* does — a `/api/...` route registered by the Host half.
*/
const RPC_PATH = "/api/dsh-tweaks/rpc";
/** Client-to-Host RPC method names. */
const RPC = {
	READ_CATALOG: "read-catalog",
	SET_IMAGE: "set-image",
	READ_INSTRUCTION: "read-instruction",
	WRITE_INSTRUCTION: "write-instruction"
};
//#endregion
//#region src/host/index.ts
/**
* dsh-tweaks host half.
*
* The browser half reaches these handlers over one `/api` route this half
* registers on the web server. `harness.handle` is the dynamic-half seat — a
* static bundle host half is a plain Node module and never receives that
* symbol, so the wire here is an ordinary route, the same bridge any
* out-of-repository web plugin uses.
*/
/**
* The one prompt position a general instruction belongs in.
*
* HARNESS_IDENTITY is -1000 and DEPLOYMENT_PERSONA_PREFIX is 0; -500 sits
* strictly between them, so this text follows the identity line but precedes
* every policy and tool section. Registering at an order equal to an existing
* section would be rejected as a duplicate.
*/
const SECTION_NAME = "dsh-tweaks:system-instruction";
const SECTION_ORDER = -500;
function describeTweaks(ctx) {
	return ctx.settings.describe({ redactSecrets: true }).find((entry) => String(entry.ns) === PERSONALIZATION_NS);
}
function describeCatalog(ctx) {
	return ctx.settings.describe({ redactSecrets: true }).find((entry) => String(entry.ns) === LLM_PI_AI_NS);
}
/** Read the stored instruction; absent, unreadable, or unregistered all mean "nothing to inject". */
function readInstruction(ctx) {
	try {
		const found = describeTweaks(ctx);
		if (found === void 0) return "";
		const user = found.user;
		if (user === null || typeof user !== "object" || Array.isArray(user)) return "";
		const text = user[SYSTEM_INSTRUCTION_FIELD];
		return typeof text === "string" ? text : "";
	} catch {
		return "";
	}
}
function modelsOf(described, provider) {
	const user = described?.user;
	if (user === null || typeof user !== "object") return void 0;
	const providers = user.providers;
	if (providers === null || typeof providers !== "object") return void 0;
	const profile = providers[provider];
	if (profile === null || typeof profile !== "object") return void 0;
	const models = profile.models;
	return Array.isArray(models) ? models : void 0;
}
/**
* Set one model's image capability.
*
* Two constraints of `settings.mutate` shape this:
*
* 1. Array elements are NOT addressable. `applyPathOp` walks with
*    `!isPlainObject(child)`, and arrays are not plain objects, so a path step
*    naming an array discards it and rebuilds `{}` in its place. The whole
*    `models` array must be read, edited, and written back as one value.
*
* 2. The op must be a plain object. The host half of a bundle is a normal Node
*    module (no vm realm), so an object literal is fine here — unlike a dynamic
*    package, which runs in a sandbox realm and must borrow a prototype.
*/
async function setImage(ctx, provider, modelId, image) {
	const described = describeCatalog(ctx);
	if (described === void 0) return {
		ok: false,
		message: "模型设置未注册"
	};
	const models = modelsOf(described, provider);
	if (models === void 0) return {
		ok: false,
		message: "这个提供方没有手写的模型列表"
	};
	if (!models.some((model) => model !== null && typeof model === "object" && model.id === modelId)) return {
		ok: false,
		message: "配置中已找不到该模型，请重新打开设置"
	};
	const next = models.map((model) => {
		const copy = { ...model };
		if (model.id === modelId) {
			if (image) copy.input = ["text", "image"];
			else delete copy.input;
		}
		return copy;
	});
	await ctx.settings.mutate(LLM_PI_AI_NS, [{
		op: "set",
		path: [
			"providers",
			provider,
			"models"
		],
		value: next
	}], described.revision);
	return { ok: true };
}
function readCatalog(ctx) {
	const described = describeCatalog(ctx);
	if (described === void 0) return {
		ok: false,
		reason: "模型设置未注册"
	};
	const user = described.user;
	const providers = user !== null && typeof user === "object" && !Array.isArray(user) ? user.providers : void 0;
	const rows = [];
	if (providers !== null && typeof providers === "object" && !Array.isArray(providers)) for (const providerKey of Object.keys(providers)) {
		const profile = providers[providerKey];
		if (profile === null || typeof profile !== "object" || Array.isArray(profile)) continue;
		const models = Array.isArray(profile.models) ? profile.models : [];
		const entries = [];
		for (const model of models) {
			if (model === null || typeof model !== "object" || Array.isArray(model)) continue;
			const record = model;
			const id = typeof record.id === "string" ? record.id : "";
			if (id.length === 0) continue;
			const input = Array.isArray(record.input) ? record.input.filter((value) => typeof value === "string") : [];
			entries.push({
				id,
				name: typeof record.name === "string" ? record.name : "",
				contextWindow: typeof record.contextWindow === "number" ? record.contextWindow : null,
				image: input.includes("image"),
				declaresInput: Array.isArray(record.input)
			});
		}
		rows.push({
			provider: providerKey,
			models: entries
		});
	}
	return {
		ok: true,
		revision: described.revision,
		providers: rows
	};
}
/** Write one JSON response the way every `/api` route in the app answers. */
function sendJson(res, status, payload) {
	res.statusCode = status;
	res.setHeader("Content-Type", "application/json; charset=utf-8");
	res.setHeader("Cache-Control", "no-store");
	res.end(JSON.stringify(payload));
}
/** Read and parse a bounded JSON request body. */
function readJson(req, limitBytes = 65536) {
	return new Promise((resolve, reject) => {
		let raw = "";
		let oversized = false;
		req.on("data", (chunk) => {
			if (oversized) return;
			raw += chunk.toString("utf8");
			if (Buffer.byteLength(raw) > limitBytes) {
				oversized = true;
				reject(/* @__PURE__ */ new Error("请求内容过大"));
			}
		});
		req.on("end", () => {
			if (oversized) return;
			try {
				resolve(JSON.parse(raw));
			} catch {
				reject(/* @__PURE__ */ new Error("请求内容不是有效 JSON"));
			}
		});
		req.on("error", reject);
	});
}
/** Loopback-only caller: `::ffff:`-prefixed IPv4 included. */
function isLoopbackAddress(address) {
	if (typeof address !== "string") return false;
	const value = address.replace(/^::ffff:/i, "");
	return value === "::1" || value === "127.0.0.1" || value === "0:0:0:0:0:0:0:1";
}
/** Accept the request only when it came from this same origin. */
function isSameOrigin(req) {
	if (!isLoopbackAddress(req.socket?.remoteAddress)) return false;
	const host = req.headers.host;
	if (typeof host !== "string") return false;
	try {
		return new URL(`http://${host}`).hostname === "localhost" || new URL(`http://${host}`).hostname === "127.0.0.1" || new URL(`http://${host}`).hostname === "::1" || new URL(`http://${host}`).hostname === "[::1]";
	} catch {
		return false;
	}
}
const name = "dsh-tweaks";
const inject = [
	"settings",
	"systemPrompt",
	"webServer"
];
function apply(ctx) {
	const settings = ctx.get("settings");
	const systemPrompt = ctx.get("systemPrompt");
	if (settings === void 0 || systemPrompt === void 0) return;
	settings.register(PERSONALIZATION_NS, z.object({ [SYSTEM_INSTRUCTION_FIELD]: z.string().default("") }));
	systemPrompt.section({
		name: SECTION_NAME,
		order: SECTION_ORDER,
		text: () => readInstruction(ctx)
	});
	const handlers = {
		[RPC.READ_CATALOG]: async () => readCatalog(ctx),
		[RPC.SET_IMAGE]: async (args) => {
			const provider = typeof args?.provider === "string" ? args.provider : "";
			const modelId = typeof args?.modelId === "string" ? args.modelId : "";
			if (provider.length === 0 || modelId.length === 0) return {
				ok: false,
				message: "缺少 provider 或 modelId"
			};
			try {
				return await setImage(ctx, provider, modelId, args.image === true);
			} catch (error) {
				return {
					ok: false,
					message: error instanceof Error ? error.message : "写入被拒绝"
				};
			}
		},
		[RPC.READ_INSTRUCTION]: async () => {
			try {
				return {
					ok: true,
					text: readInstruction(ctx),
					writable: settings.writable === true
				};
			} catch (error) {
				return {
					ok: false,
					message: error instanceof Error ? error.message : "读取失败"
				};
			}
		},
		[RPC.WRITE_INSTRUCTION]: async (args) => {
			const text = typeof args?.text === "string" ? args.text : "";
			try {
				const described = describeTweaks(ctx);
				if (described === void 0) return {
					ok: false,
					message: "设置未注册"
				};
				const ops = text.length === 0 ? [{
					op: "unset",
					path: [SYSTEM_INSTRUCTION_FIELD]
				}] : [{
					op: "set",
					path: [SYSTEM_INSTRUCTION_FIELD],
					value: text
				}];
				await ctx.settings.mutate(PERSONALIZATION_NS, ops, described.revision);
				return {
					ok: true,
					text: readInstruction(ctx)
				};
			} catch (error) {
				return {
					ok: false,
					message: error instanceof Error ? error.message : "写入被拒绝"
				};
			}
		}
	};
	const webServer = ctx.get("webServer");
	if (webServer === void 0) return;
	webServer.register({
		kind: "exact",
		path: RPC_PATH,
		handler: async (req, res) => {
			if (req.method !== "POST") {
				res.setHeader("Allow", "POST");
				sendJson(res, 405, {
					ok: false,
					message: "仅支持 POST"
				});
				return;
			}
			if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
				sendJson(res, 415, {
					ok: false,
					message: "仅接受 JSON 请求"
				});
				return;
			}
			if (!isSameOrigin(req)) {
				sendJson(res, 403, {
					ok: false,
					message: "拒绝跨来源请求"
				});
				return;
			}
			let method;
			let args;
			try {
				const body = await readJson(req);
				method = typeof body?.method === "string" ? body.method : "";
				args = body?.args ?? null;
			} catch (error) {
				sendJson(res, 400, {
					ok: false,
					message: error instanceof Error ? error.message : "请求解析失败"
				});
				return;
			}
			const handler = handlers[method];
			if (handler === void 0) {
				sendJson(res, 404, {
					ok: false,
					message: `未知方法 ${method}`
				});
				return;
			}
			try {
				const result = await handler(args);
				if (result !== null && typeof result === "object" && result.ok === false) {
					sendJson(res, 200, {
						ok: false,
						message: result.message ?? "操作被拒绝"
					});
					return;
				}
				sendJson(res, 200, {
					ok: true,
					result
				});
			} catch (error) {
				sendJson(res, 502, {
					ok: false,
					message: error instanceof Error ? error.message : "处理失败"
				});
			}
		}
	});
}
//#endregion
export { apply, inject, name };
