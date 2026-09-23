# dsh-tweaks

Two small quality-of-life add-ons for [DeepSeek Harness](https://github.com/deepseek-ai) (DSH).

[简体中文](README.zh-CN.md)

## Why

Two rough edges in the built-in settings screen:

1. **No way to let a model see images.** Models you write by hand in your config
   default to text-only — even when the model actually supports images. Turning it
   on meant hand-editing a config file, with no way to tell whether it worked.

2. **Standing preferences have to be retyped every session.** Things like "answer
   in Chinese", "don't flatter me", or "lead with the conclusion" — you end up
   repeating yourself in every new conversation.

## What you get

### 1. Image input per model (Settings → Models)

Each provider card gains an **Image input** panel. Just tick the models.

- Ticked — that model accepts images
- Unticked — back to text-only

Long lists collapse, so they never take over the screen.

### 2. General system instruction (Settings → Personalization)

One text box. Write it once, it applies everywhere.

Whatever you put here is injected at the **very beginning of every conversation**,
so it acts as a standing rule for all sessions. For example:

> Always answer in Chinese; lead with the conclusion, then the reasoning; don't
> flatter me, point out my mistakes directly.

It saves when you click away (same as the built-in settings rows — there is no
Save button). **Leave it empty and nothing is injected at all.**

## Install

```sh
dsh plugin --profile web add dsh-tweaks
```

Then **restart DSH**. No code changes needed.

## Good to know

- The image toggle only applies to models **you wrote by hand**. Routes that use
  the official model catalog, or a self-hosted gateway, are not covered — edit
  your config file directly for those.
- The toggle is a *declaration*, not a *test*: nothing asks the endpoint what it
  actually accepts, so switching it on for a model that cannot handle images gets
  the request rejected by the provider.

## Development

```sh
pnpm install
pnpm run build   # build both halves
pnpm run watch   # rebuild on change
```

## License

MIT
