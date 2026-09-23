import * as React from 'react';
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives';
import { LLM_PI_AI_NS, RPC, RPC_PATH } from '../shared/constants.js';

/**
 * dsh-tweaks client half.
 *
 * Two settings surfaces, both writing through the package's own Host route:
 * an image-input panel on each model provider card, and a Personalization
 * section holding the general system instruction.
 *
 * A static client bundle is evaluated with only a `require` shim — the
 * `host`/`styles` closure symbols belong to dynamic halves (source evaluated
 * through `new Function`), so this half talks to its Host through `fetch` and
 * owns its own style tag.
 */

/** Call one Host handler of this package; rejects with the Host's message. */
async function rpc(method: string, args: unknown = null): Promise<any> {
  const response = await fetch(RPC_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args }),
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload === null || typeof payload !== 'object' || payload.ok !== true) {
    throw new Error(
      payload !== null && typeof payload === 'object' && typeof payload.message === 'string'
        ? payload.message
        : `请求失败（${response.status}）`,
    );
  }
  return payload.result ?? null;
}

/** Own the package stylesheet: no `styles` builtin exists for a static bundle. */
function insertStyles(css: string): () => void {
  const tag = document.createElement('style');
  tag.dataset.plugin = 'dsh-tweaks';
  tag.textContent = css;
  document.head.appendChild(tag);
  return () => tag.remove();
}

const SYSTEM_INSTRUCTION_SECTION_ID = 'dsh-tweaks-personalization';

/** How many rows stay visible while collapsed; the next one is half-masked. */
const VISIBLE_ROWS = 3.5;
const ROW_HEIGHT = 32;

function ImageInputPanel({ providerId, invalidations }: { providerId: string; invalidations: InvalidationSource }) {
  const invalidationVersion = useInvalidationVersion(invalidations);
  const [catalog, setCatalog] = React.useState<any>(null);
  const [pending, setPending] = React.useState<Record<string, boolean> | null>(null);
  const [failure, setFailure] = React.useState('');
  const [expanded, setExpanded] = React.useState(false);

  // One monotonic read id per reload: an older read can never overwrite a newer
  // one, so two quick toggles (or an invalidation racing a write) cannot leave
  // the checkboxes showing a snapshot the Host has already moved past.
  const readId = React.useRef(0);
  // Serialize writes through this panel: `settings.mutate` fences each write on
  // the revision the caller read, so two concurrent set-image calls make the
  // second fail the fence. Chaining them keeps every write ordered after the
  // previous one's reload instead of racing it.
  const writeChain = React.useRef<Promise<unknown>>(Promise.resolve());

  const reload = () => {
    const mine = ++readId.current;
    return rpc(RPC.READ_CATALOG).then(
      (result: any) => {
        if (mine !== readId.current) return;
        setCatalog({ revision: result?.revision, providers: result?.providers ?? [] });
        setFailure('');
      },
      () => {
        if (mine !== readId.current) return;
        setFailure('无法读取模型配置');
      },
    );
  };

  // Mount plus every external invalidation the section subscribes to: a
  // `settings.yaml` edit in another tab, a Host settings commit, or a
  // reconnect. Without this the panel holds a stale snapshot until the
  // settings page is reopened.
  React.useEffect(() => {
    void reload();
  }, [providerId, invalidations]);

  const row =
    catalog === null
      ? undefined
      : (catalog.providers as any[]).find((entry: any) => entry.provider === providerId);

  const keyOf = (modelId: string) => `${providerId}::${modelId}`;
  const isBusy = (model: any) => pending !== null && pending[keyOf(model.id)] === true;

  const toggle = (model: any) => {
    const next = !model.image;
    setPending((current) => ({ ...(current ?? {}), [keyOf(model.id)]: true }));
    setFailure('');
    // Optimistic flip so the click feels native; a rejected write reloads the
    // real state rather than leaving the checkbox claiming a value it lacks.
    setCatalog((current: any) =>
      current === null
        ? current
        : {
            revision: current.revision,
            providers: current.providers.map((entry: any) =>
              entry.provider !== providerId
                ? entry
                : {
                    provider: entry.provider,
                    models: entry.models.map((m: any) =>
                      m.id !== model.id ? m : { ...m, image: next },
                    ),
                  },
            ),
          },
    );

    // Queue behind any write already in flight instead of firing alongside it,
    // and bump the read id first so this write's own reload is the newest one.
    const mine = ++readId.current;
    writeChain.current = writeChain.current.then(async () => {
      try {
        await rpc(RPC.SET_IMAGE, { provider: providerId, modelId: model.id, image: next });
        await reload();
      } catch (error) {
        if (mine === readId.current) {
          setFailure(error instanceof Error ? error.message : '写入失败');
        }
        // Re-read the real state either way: the optimistic flip must not
        // outlive a write the Host refused.
        await reload();
      } finally {
        setPending((current) => {
          const copy = { ...(current ?? {}) };
          delete copy[keyOf(model.id)];
          return copy;
        });
      }
    });
  };

  const children: React.ReactNode[] = [];
  children.push(
    React.createElement('div', { key: 'head', className: 'dsh-tw-head' },
      React.createElement('span', { className: 'dsh-tw-title' }, '图片输入能力')),
  );
  children.push(
    React.createElement('p', { key: 'hint', className: 'dsh-tw-hint' }, '勾选后，模型允许输入图片'),
  );

  if (catalog === null) {
    children.push(React.createElement('p', { key: 'loading', className: 'dsh-tw-hint' }, '读取中…'));
  } else if (row === undefined || row.models.length === 0) {
    children.push(
      React.createElement('p', { key: 'empty', className: 'dsh-tw-hint' },
        '这个提供方目前没有手写的模型列表（使用内置目录），无法逐项声明图片能力。'),
    );
  } else {
    const models = row.models as any[];
    const collapsedHeight = Math.round(ROW_HEIGHT * VISIBLE_ROWS);
    const overflows = models.length > VISIBLE_ROWS;
    const showAll = expanded || !overflows;

    const rows = models.map((model: any) =>
      React.createElement('label', {
        key: `row-${model.id}`,
        className: 'dsh-tw-row',
        title: model.declaresInput ? '配置中已显式声明 input' : '尚未声明 input（默认纯文本）',
      }, [
        React.createElement('input', {
          key: 'cb',
          type: 'checkbox',
          checked: model.image,
          disabled: isBusy(model),
          onChange: () => toggle(model),
        }),
        React.createElement('span', { key: 'id', className: 'dsh-tw-id' },
          model.name.length > 0 ? `${model.name} (${model.id})` : model.id),
        model.contextWindow === null
          ? null
          : React.createElement('span', { key: 'cap', className: 'dsh-tw-cap' }, `${model.contextWindow} ctx`),
        isBusy(model)
          ? React.createElement('span', { key: 'p', className: 'dsh-tw-cap' }, '保存中…')
          : null,
      ]),
    );

    const listChildren: React.ReactNode[] = [
      React.createElement('div', {
        key: 'list',
        className: 'dsh-tw-list',
        style: showAll ? undefined : { height: `${collapsedHeight}px` },
      }, rows),
    ];
    if (!showAll) {
      listChildren.push(React.createElement('div', { key: 'mask', className: 'dsh-tw-mask' }));
    }
    children.push(React.createElement('div', { key: 'wrap', className: 'dsh-tw-listWrap' }, listChildren));

    if (overflows) {
      children.push(
        React.createElement('button', {
          key: 'toggle',
          type: 'button',
          className: 'dsh-tw-toggle',
          onClick: () => setExpanded((v: boolean) => !v),
        }, [
          React.createElement('span', { key: 't' }, expanded ? '收起' : `展开全部 ${models.length} 个模型`),
          React.createElement('span', {
            key: 'i',
            className: 'dsh-tw-chevron',
            style: expanded ? { transform: 'rotate(180deg)' } : undefined,
          }, React.createElement(IconChevronDownOutline14 as any, {})),
        ]),
      );
    }
  }

  if (failure.length > 0) {
    children.push(React.createElement('div', { key: 'err', className: 'dsh-tw-err' }, failure));
  }

  return React.createElement('div', { 'data-dsh-tweaks-image': providerId }, children);
}

function PersonalizationSection({ invalidations }: { invalidations: InvalidationSource }) {
  const invalidationVersion = useInvalidationVersion(invalidations);
  const [saved, setSaved] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [failure, setFailure] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const readId = React.useRef(0);
  // True while the textarea holds edits the user has not blurred away yet. An
  // external invalidation must update what is saved but never yank the draft
  // out from under the caret — losing typed text is worse than a stale field.
  const editing = React.useRef(false);

  React.useEffect(() => {
    const mine = ++readId.current;
    rpc(RPC.READ_INSTRUCTION).then(
      (result: any) => {
        if (mine !== readId.current) return;
        const text = String(result?.text ?? '');
        setSaved(text);
        if (!editing.current) setDraft(text);
        setFailure('');
      },
      () => {
        if (mine === readId.current) setFailure('无法读取设置');
      },
    );
  }, [invalidations]);

  const commit = async () => {
    if (saved === null || draft === saved || busy) return;
    setBusy(true);
    setFailure('');
    try {
      await rpc(RPC.WRITE_INSTRUCTION, { text: draft });
      setSaved(draft);
      setStatus(draft.trim().length === 0 ? '已清空（不再注入）' : `已更新 ${draft.length} 字符`);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : '写入失败');
    } finally {
      setBusy(false);
    }
  };

  return React.createElement('div', { 'data-dsh-tweaks-personalization': '1' }, [
    React.createElement('div', { key: 'title', className: 'dsh-tw-title' }, '系统指令'),
    React.createElement('div', { key: 'hint', className: 'dsh-tw-hint' },
      '作为最通用的系统指令，注入每次对话上下文的最开头（身份说明之后、所有工具与策略说明之前）。离开输入框即自动保存；留空则不注入。'),
    React.createElement('textarea', {
      key: 'ta',
      className: 'dsh-tw-textarea',
      value: draft,
      disabled: busy,
      spellCheck: false,
      placeholder: '例如：始终用中文回答；先给结论再给理由；不要奉承，直接指出我的错误。',
      onChange: (event: any) => {
        editing.current = true;
        setDraft(event.target.value);
        setStatus('');
      },
      onBlur: () => {
        editing.current = false;
        void commit();
      },
    }),
    React.createElement('div', { key: 'st', className: 'dsh-tw-status' },
      busy ? '保存中…' : status.length > 0 ? status : saved !== null && draft !== saved ? '有未保存的改动（离开输入框时保存）' : ''),
    failure.length > 0 ? React.createElement('div', { key: 'err', className: 'dsh-tw-err' }, failure) : null,
  ]);
}

/**
 * A plain (non-hook) invalidation source: a version number plus a subscriber
 * set, owned by the plugin fiber.
 *
 * `apply()` runs once at activation, outside any React render, so it cannot
 * call hooks — this is a store the components subscribe to instead. It bumps
 * on every signal that can move the settings document underneath the panels.
 *
 * `settings/document-updated` is a forwarded Host event: it sits on the
 * `API_REMOTE_FORWARDED_EVENTS` allowlist, which is also the legal key set of
 * `ctx.remote.$on`. `connection/reset` is the local reconnect signal the
 * settings mirror refreshes on.
 *
 * Both subscriptions are optional by construction: a static bundle whose
 * composition lacks `remote` must still mount and simply never refresh. A
 * missing listener is a stale panel; a throw here would be a failed plugin.
 */
function createInvalidationSource(ctx: any) {
  let version = 0;
  const listeners = new Set<() => void>();
  const notify = () => {
    version += 1;
    for (const listener of [...listeners]) listener();
  };

  const disposers: Array<() => void> = [];
  const remote = ctx?.remote;
  if (remote !== undefined && typeof remote.$on === 'function') {
    try {
      disposers.push(remote.$on('settings/document-updated', notify));
    } catch {
      /* event not forwarded by this assembly */
    }
  }
  if (typeof ctx?.on === 'function') {
    try {
      disposers.push(ctx.on('connection/reset', notify));
    } catch {
      /* no local connection event in this composition */
    }
  }

  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getVersion: () => version,
    dispose: () => {
      for (const dispose of disposers) dispose();
      listeners.clear();
    },
  };
}

/** The invalidation store a panel subscribes to. */
type InvalidationSource = ReturnType<typeof createInvalidationSource>;

/** Subscribe one component to the invalidation source. */
function useInvalidationVersion(source: InvalidationSource): number {
  return React.useSyncExternalStore(source.subscribe, source.getVersion, source.getVersion);
}

export const inject = ['slots', 'remote'] as string[];

export function apply(ctx: any) {
  const slots = ctx.get('slots');
  if (slots === undefined) return;

  /**
   * One invalidation source for both panels: a slot component is re-created on
   * every render, so a subscription inside one would leak a listener per
   * render. One store owned by this fiber feeds every mounted panel instead.
   */
  const invalidations = createInvalidationSource(ctx);
  ctx.effect(() => invalidations.dispose, 'dsh-tweaks: invalidation subscriptions');

  ctx.effect(() =>
    insertStyles(
      [
        '[data-dsh-tweaks-image]{border:.5px solid var(--dsw-alias-border-l4);border-radius:16px;padding:12px 14px;margin-top:12px;font-size:var(--dsh-content-font-size-secondary,13px)}',
        '[data-dsh-tweaks-image] .dsh-tw-head{display:flex;align-items:center;justify-content:space-between;gap:8px}',
        '[data-dsh-tweaks-image] .dsh-tw-title{font-weight:600;color:var(--dsw-alias-label-primary)}',
        '[data-dsh-tweaks-image] .dsh-tw-hint{color:var(--dsw-alias-label-tertiary);line-height:18px;margin:4px 0 0}',
        '[data-dsh-tweaks-image] .dsh-tw-listWrap{position:relative;margin-top:8px}',
        '[data-dsh-tweaks-image] .dsh-tw-list{overflow:hidden}',
        '[data-dsh-tweaks-image] .dsh-tw-mask{position:absolute;left:0;right:0;bottom:0;height:22px;pointer-events:none;background:linear-gradient(to bottom,transparent,var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-base,transparent)))}',
        '[data-dsh-tweaks-image] .dsh-tw-row{display:flex;align-items:center;gap:8px;padding:5px 0;cursor:pointer;height:32px;box-sizing:border-box}',
        '[data-dsh-tweaks-image] .dsh-tw-id{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}',
        '[data-dsh-tweaks-image] .dsh-tw-cap{flex:none;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}',
        '[data-dsh-tweaks-image] .dsh-tw-row input{flex:none;margin:0;cursor:pointer}',
        '[data-dsh-tweaks-image] .dsh-tw-row input:disabled{cursor:progress}',
        '[data-dsh-tweaks-image] .dsh-tw-toggle{margin-top:8px;width:100%;background:none;border:none;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;padding:4px 0}',
        '[data-dsh-tweaks-image] .dsh-tw-toggle:hover{color:var(--dsw-alias-label-primary)}',
        '[data-dsh-tweaks-image] .dsh-tw-chevron{display:inline-flex;transition:transform 120ms ease}',
        '[data-dsh-tweaks-image] .dsh-tw-err{color:var(--dsw-alias-state-error-primary);margin-top:8px}',
        '[data-dsh-tweaks-personalization]{display:flex;flex-direction:column;gap:10px;width:100%;padding:4px 0}',
        '[data-dsh-tweaks-personalization] .dsh-tw-title{font-weight:600;font-size:14px;color:var(--dsw-alias-label-primary)}',
        '[data-dsh-tweaks-personalization] .dsh-tw-hint{color:var(--dsw-alias-label-tertiary);line-height:18px;font-size:var(--dsh-content-font-size-secondary,13px)}',
        // Matches the provider row card's outline: border-l4 at .5px with a 16px
        // radius. (border-secondary is not a real token — an undefined var()
        // silently invalidates the whole declaration.)
        '[data-dsh-tweaks-personalization] .dsh-tw-textarea{width:100%;min-height:180px;box-sizing:border-box;resize:vertical;overflow:auto;padding:10px 12px;border-radius:16px;border:.5px solid var(--dsw-alias-border-l4);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;line-height:20px;display:block}',
        '[data-dsh-tweaks-personalization] .dsh-tw-textarea:hover{border-color:var(--dsw-alias-label-tertiary)}',
        '[data-dsh-tweaks-personalization] .dsh-tw-textarea:focus{outline:none;border-color:var(--dsw-alias-label-secondary)}',
        '[data-dsh-tweaks-personalization] .dsh-tw-status{color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-content-font-size-secondary,13px);min-height:18px}',
        '[data-dsh-tweaks-personalization] .dsh-tw-err{color:var(--dsw-alias-state-error-primary);font-size:var(--dsh-content-font-size-secondary,13px)}',
      ].join('\n'),
    ),
  );

  slots.inject('settings.models.provider-card', () =>
    slots.register(
      { name: 'settings.models.provider-card', key: LLM_PI_AI_NS },
      (props: any) =>
        React.createElement(ImageInputPanel, {
          providerId: props?.provider?.provider ?? '',
          invalidations,
        }),
    ),
  );

  slots.inject('settings.section', () =>
    slots.register(
      {
        name: 'settings.section',
        id: SYSTEM_INSTRUCTION_SECTION_ID,
        order: 5,
        label: '个性化',
      },
      () => React.createElement(PersonalizationSection, { invalidations }),
    ),
  );
}
