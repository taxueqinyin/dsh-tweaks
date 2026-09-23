/**
 * Shared constants for dsh-tweaks.
 *
 * Host and client halves are separate bundles, so anything both sides name —
 * the namespace, the field, the RPC methods — lives here rather than being
 * duplicated as string literals that can drift.
 */

/** Settings namespace holding the general system instruction. */
export const PERSONALIZATION_NS = 'dsh-tweaks';

/** Field inside that namespace carrying the instruction text. */
export const SYSTEM_INSTRUCTION_FIELD = 'systemInstruction';

/** The model-catalog namespace the image-input panel edits. */
export const LLM_PI_AI_NS = 'llm-pi-ai';

/**
 * The one HTTP endpoint the browser half calls.
 *
 * A static client package is a prebuilt `__ModuleLoader__` bundle: it gets a
 * `require` shim and nothing else, so the dynamic-half closure symbols
 * (`host`, `styles`, `harness`) do not exist for it. The package therefore
 * bridges to its own Host half the way every out-of-repository web plugin
 * does — a `/api/...` route registered by the Host half.
 */
export const RPC_PATH = '/api/dsh-tweaks/rpc';

/** Client-to-Host RPC method names. */
export const RPC = {
  READ_CATALOG: 'read-catalog',
  SET_IMAGE: 'set-image',
  READ_INSTRUCTION: 'read-instruction',
  WRITE_INSTRUCTION: 'write-instruction',
} as const;
