import z from '@deepseek-ai/schemastery';
import {
  LLM_PI_AI_NS,
  PERSONALIZATION_NS,
  RPC,
  RPC_PATH,
  SYSTEM_INSTRUCTION_FIELD,
} from '../shared/constants.js';

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
const SECTION_NAME = 'dsh-tweaks:system-instruction';
const SECTION_ORDER = -500;

function describeTweaks(ctx: any) {
  return ctx.settings.describe({ redactSecrets: true }).find((entry: any) => String(entry.ns) === PERSONALIZATION_NS);
}

function describeCatalog(ctx: any) {
  return ctx.settings.describe({ redactSecrets: true }).find((entry: any) => String(entry.ns) === LLM_PI_AI_NS);
}

/** Read the stored instruction; absent, unreadable, or unregistered all mean "nothing to inject". */
function readInstruction(ctx: any): string {
  try {
    const found = describeTweaks(ctx);
    if (found === undefined) return '';
    const user = found.user;
    if (user === null || typeof user !== 'object' || Array.isArray(user)) return '';
    const text = (user as Record<string, unknown>)[SYSTEM_INSTRUCTION_FIELD];
    return typeof text === 'string' ? text : '';
  } catch {
    return '';
  }
}

function modelsOf(described: any, provider: string): any[] | undefined {
  const user = described?.user;
  if (user === null || typeof user !== 'object') return undefined;
  const providers = (user as Record<string, unknown>).providers;
  if (providers === null || typeof providers !== 'object') return undefined;
  const profile = (providers as Record<string, unknown>)[provider];
  if (profile === null || typeof profile !== 'object') return undefined;
  const models = (profile as Record<string, unknown>).models;
  return Array.isArray(models) ? models : undefined;
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
async function setImage(ctx: any, provider: string, modelId: string, image: boolean) {
  const described = describeCatalog(ctx);
  if (described === undefined) return { ok: false, message: '模型设置未注册' };

  const models = modelsOf(described, provider);
  if (models === undefined) return { ok: false, message: '这个提供方没有手写的模型列表' };
  if (!models.some((model) => model !== null && typeof model === 'object' && model.id === modelId)) {
    return { ok: false, message: '配置中已找不到该模型，请重新打开设置' };
  }

  // Rebuild the array by copying every entry and overriding only `input` on the
  // target, so no field the panel never displayed can be lost.
  const next = models.map((model) => {
    const copy: Record<string, unknown> = { ...model };
    if (model.id === modelId) {
      if (image) copy.input = ['text', 'image'];
      else delete copy.input;
    }
    return copy;
  });

  await ctx.settings.mutate(
    LLM_PI_AI_NS,
    [{ op: 'set', path: ['providers', provider, 'models'], value: next }],
    described.revision,
  );
  return { ok: true };
}

function readCatalog(ctx: any) {
  const described = describeCatalog(ctx);
  if (described === undefined) return { ok: false, reason: '模型设置未注册' };

  const user = described.user;
  const providers =
    user !== null && typeof user === 'object' && !Array.isArray(user)
      ? (user as Record<string, unknown>).providers
      : undefined;

  const rows: Array<{ provider: string; models: unknown[] }> = [];
  if (providers !== null && typeof providers === 'object' && !Array.isArray(providers)) {
    for (const providerKey of Object.keys(providers as Record<string, unknown>)) {
      const profile = (providers as Record<string, unknown>)[providerKey];
      if (profile === null || typeof profile !== 'object' || Array.isArray(profile)) continue;
      const models = Array.isArray((profile as Record<string, unknown>).models)
        ? ((profile as Record<string, unknown>).models as unknown[])
        : [];

      const entries = [];
      for (const model of models) {
        if (model === null || typeof model !== 'object' || Array.isArray(model)) continue;
        const record = model as Record<string, unknown>;
        const id = typeof record.id === 'string' ? record.id : '';
        if (id.length === 0) continue;
        const input = Array.isArray(record.input)
          ? (record.input as unknown[]).filter((value) => typeof value === 'string')
          : [];
        entries.push({
          id,
          name: typeof record.name === 'string' ? record.name : '',
          contextWindow: typeof record.contextWindow === 'number' ? record.contextWindow : null,
          image: input.includes('image'),
          declaresInput: Array.isArray(record.input),
        });
      }
      rows.push({ provider: providerKey, models: entries });
    }
  }
  return { ok: true, revision: described.revision, providers: rows };
}

/** Write one JSON response the way every `/api` route in the app answers. */
function sendJson(res: any, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

/** Read and parse a bounded JSON request body. */
function readJson(req: any, limitBytes = 64 * 1024): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = '';
    let oversized = false;
    req.on('data', (chunk: Buffer) => {
      if (oversized) return;
      raw += chunk.toString('utf8');
      if (Buffer.byteLength(raw) > limitBytes) {
        oversized = true;
        reject(new Error('请求内容过大'));
      }
    });
    req.on('end', () => {
      if (oversized) return;
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('请求内容不是有效 JSON'));
      }
    });
    req.on('error', reject);
  });
}

/** Loopback-only caller: `::ffff:`-prefixed IPv4 included. */
function isLoopbackAddress(address: unknown): boolean {
  if (typeof address !== 'string') return false;
  const value = address.replace(/^::ffff:/i, '');
  return value === '::1' || value === '127.0.0.1' || value === '0:0:0:0:0:0:0:1';
}

/** Accept the request only when it came from this same origin. */
function isSameOrigin(req: any): boolean {
  if (!isLoopbackAddress(req.socket?.remoteAddress)) return false;
  const host = req.headers.host;
  if (typeof host !== 'string') return false;
  try {
    return new URL(`http://${host}`).hostname === 'localhost' ||
      new URL(`http://${host}`).hostname === '127.0.0.1' ||
      new URL(`http://${host}`).hostname === '::1' ||
      new URL(`http://${host}`).hostname === '[::1]';
  } catch {
    return false;
  }
}

export const name = 'dsh-tweaks';
export const inject = ['settings', 'systemPrompt', 'webServer'] as string[];

export function apply(ctx: any) {
  const settings = ctx.get('settings');
  const systemPrompt = ctx.get('systemPrompt');
  if (settings === undefined || systemPrompt === undefined) return;

  // Own the namespace: a bundle host half has `z`, unlike the dynamic sandbox.
  // An absent field resolves to '' via the schema default, so an unset
  // instruction is indistinguishable from an empty one.
  settings.register(
    PERSONALIZATION_NS,
    z.object({
      [SYSTEM_INSTRUCTION_FIELD]: z.string().default(''),
    }),
  );

  // Re-read on every assembly so a save applies to the next request without
  // re-registering; an empty value renders to '' and assembly drops it entirely.
  systemPrompt.section({
    name: SECTION_NAME,
    order: SECTION_ORDER,
    text: () => readInstruction(ctx),
  });

  const handlers: Record<string, (args: any) => Promise<unknown>> = {
    [RPC.READ_CATALOG]: async () => readCatalog(ctx),

    [RPC.SET_IMAGE]: async (args: any) => {
      const provider = typeof args?.provider === 'string' ? args.provider : '';
      const modelId = typeof args?.modelId === 'string' ? args.modelId : '';
      if (provider.length === 0 || modelId.length === 0) {
        return { ok: false, message: '缺少 provider 或 modelId' };
      }
      try {
        return await setImage(ctx, provider, modelId, args.image === true);
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : '写入被拒绝' };
      }
    },

    [RPC.READ_INSTRUCTION]: async () => {
      try {
        return { ok: true, text: readInstruction(ctx), writable: settings.writable === true };
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : '读取失败' };
      }
    },

    [RPC.WRITE_INSTRUCTION]: async (args: any) => {
      const text = typeof args?.text === 'string' ? args.text : '';
      try {
        const described = describeTweaks(ctx);
        if (described === undefined) return { ok: false, message: '设置未注册' };
        const ops =
          text.length === 0
            ? [{ op: 'unset', path: [SYSTEM_INSTRUCTION_FIELD] }]
            : [{ op: 'set', path: [SYSTEM_INSTRUCTION_FIELD], value: text }];
        await ctx.settings.mutate(PERSONALIZATION_NS, ops, described.revision);
        return { ok: true, text: readInstruction(ctx) };
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : '写入被拒绝' };
      }
    },
  };

  const webServer = ctx.get('webServer');
  if (webServer === undefined) return;

  webServer.register({
    kind: 'exact',
    path: RPC_PATH,
    handler: async (req: any, res: any) => {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        sendJson(res, 405, { ok: false, message: '仅支持 POST' });
        return;
      }
      if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
        sendJson(res, 415, { ok: false, message: '仅接受 JSON 请求' });
        return;
      }
      if (!isSameOrigin(req)) {
        sendJson(res, 403, { ok: false, message: '拒绝跨来源请求' });
        return;
      }

      let method: string;
      let args: unknown;
      try {
        const body = (await readJson(req)) as Record<string, unknown> | null;
        method = typeof body?.method === 'string' ? body.method : '';
        args = body?.args ?? null;
      } catch (error) {
        sendJson(res, 400, { ok: false, message: error instanceof Error ? error.message : '请求解析失败' });
        return;
      }

      const handler = handlers[method];
      if (handler === undefined) {
        sendJson(res, 404, { ok: false, message: `未知方法 ${method}` });
        return;
      }

      try {
        const result = await handler(args);
        if (result !== null && typeof result === 'object' && (result as any).ok === false) {
          const refused = result as { message?: string };
          sendJson(res, 200, { ok: false, message: refused.message ?? '操作被拒绝' });
          return;
        }
        sendJson(res, 200, { ok: true, result });
      } catch (error) {
        sendJson(res, 502, { ok: false, message: error instanceof Error ? error.message : '处理失败' });
      }
    },
  });
}
