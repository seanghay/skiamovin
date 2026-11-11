// Scene transitions from the gl-transitions collection (MIT for most; each transition lists its own license).
// The collection is loaded on first use.

type ParamValue = number | boolean | readonly number[];

export interface TransitionInfo {
  name: string;
  description?: string;
  author: string;
  license: string;
  tags: string[];
  /** Extra images the transition needs, passed with `textures`, such as a wipe pattern. */
  textures: string[];
  /** Parameters with their type and default. */
  params: Record<string, { type: string; default?: ParamValue; min?: number; max?: number }>;
}

interface Loaded {
  sksl: Record<string, string>;
  info: Map<string, TransitionInfo>;
}

let loading: Promise<Loaded> | null = null;
let loaded: Loaded | null = null;

/** Loads the transition collection. The renderer does this when a composition uses a transition. */
export function loadTransitions(): Promise<Loaded> {
  loading ??= (async () => {
    const [skslMod, metaMod] = await Promise.all([import('gl-transitions/sksl/index.js'), import('gl-transitions')]);
    const sksl = ((skslMod as { default?: unknown }).default ?? skslMod) as Record<string, string>;
    const meta = ((metaMod as { default?: unknown }).default ?? metaMod) as {
      name: string;
      description?: string;
      author: string;
      license: string;
      tags?: string[];
      textures?: string[];
      params?: TransitionInfo['params'];
      defaultParams?: Record<string, ParamValue>;
    }[];
    const info = new Map<string, TransitionInfo>();
    for (const t of meta) {
      if (!(t.name in sksl)) continue;
      info.set(t.name, {
        name: t.name,
        description: t.description,
        author: t.author,
        license: t.license,
        tags: t.tags ?? [],
        textures: t.textures ?? [],
        params:
          t.params ??
          Object.fromEntries(
            Object.entries(t.defaultParams ?? {}).map(([k, v]) => [k, { type: typeof v, default: v }]),
          ),
      });
    }
    loaded = { sksl, info };
    return loaded;
  })();
  return loading;
}

/** Every available transition with its description, parameters and license, for choosing one by name. */
export async function listTransitions(): Promise<TransitionInfo[]> {
  return [...(await loadTransitions()).info.values()];
}

/** Plain names for the basic film transitions. */
const ALIASES: Record<string, string> = { dissolve: 'Fade', fade: 'FadeColor', wipe: 'DirectionalWipe' };

/** SkSL source and default uniforms for a loaded transition. @internal */
export function transitionProgram(name: string): {
  sksl: string;
  defaults: Record<string, number | readonly number[]>;
  textures: string[];
} {
  if (!loaded) throw new Error('transitions are not loaded yet');
  name = ALIASES[name] ?? name;
  const sksl = loaded.sksl[name];
  const info = loaded.info.get(name);
  if (!sksl || !info) {
    const close = [...loaded.info.keys()]
      .filter((n) => n.toLowerCase().includes(name.toLowerCase().slice(0, 4)))
      .slice(0, 5);
    throw new RangeError(
      `Unknown transition '${name}'.${close.length ? ` Did you mean ${close.join(', ')}?` : ''} See listTransitions().`,
    );
  }
  const defaults: Record<string, number | readonly number[]> = {};
  for (const [k, p] of Object.entries(info.params)) {
    if (p.default === undefined) continue;
    defaults[k] = typeof p.default === 'boolean' ? (p.default ? 1 : 0) : (p.default as number | readonly number[]);
  }
  return { sksl, defaults, textures: info.textures };
}
