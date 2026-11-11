// Code blocks: highlighted by Shiki (VS Code grammars and themes) and animated between versions of the code, token
// by token, as in Motion Canvas.
import { Easing } from './animation.ts';
import { box, type Deferred, type MeasureText, type NodeStyle, type SceneNode, span, text } from './nodes.ts';

export interface CodeOptions {
  /** A language Shiki knows, such as `'ts'`, `'rust'` or `'python'`. Default `'ts'`. */
  language?: string;
  /** A Shiki theme name. Default `'github-dark-default'`. */
  theme?: string;
  /** Pixels. Default 28. */
  fontSize?: number;
  /** A monospace font. Default: the composition's first font. */
  fontFamily?: string;
  /** Line height as a multiple of the font size. Default 1.5. */
  lineHeight?: number;
  /** Spaces per tab. Default 2. */
  tabSize?: number;
  /** The previous version of the code. With `progress`, the block changes from `from` to the code. */
  from?: string;
  /**
   * 0 shows `from`, 1 shows the code. In between, removed tokens fade out, kept tokens move to their new places and
   * added tokens fade in.
   */
  progress?: number;
  /** Lines to bring forward (1-based numbers or `[first, last]` ranges); the others are dimmed. */
  highlight?: readonly (number | readonly [number, number])[];
  /** Shows line numbers. */
  lineNumbers?: boolean;
}

interface Token {
  text: string;
  color: string;
  italic: boolean;
  bold: boolean;
  line: number;
  column: number;
}

interface Version {
  lines: { text: string; color: string; italic: boolean; bold: boolean }[][];
  /** Tokens without whitespace, for matching. */
  tokens: Token[];
  columns: number;
}

interface CodeLayout {
  to: Version;
  from: Version | null;
  /** For each `from` token, its index in `to`, or -1 when removed. */
  match: Int32Array;
  added: Uint8Array;
  advance: number;
  baseline: number;
  background: string;
  foreground: string;
}

// Loading Shiki

type Shiki = typeof import('shiki');
type Highlighter = Awaited<ReturnType<Shiki['createHighlighter']>>;
let highlighter: Promise<Highlighter> | null = null;
let ready: Highlighter | null = null;
const loaded = new Set<string>();

async function loadCode(language: string, theme: string): Promise<void> {
  highlighter ??= (async () => {
    const [shiki, engine] = await Promise.all([import('shiki'), import('shiki/engine/javascript')]);
    // The JavaScript regex engine needs no WebAssembly, so it loads the same way on Node and the web.
    return shiki.createHighlighter({ themes: [], langs: [], engine: engine.createJavaScriptRegexEngine() });
  })();
  const h = await highlighter;
  await Promise.all([
    h.getLoadedLanguages().includes(language) ? null : h.loadLanguage(language as never),
    h.getLoadedThemes().includes(theme) ? null : h.loadTheme(theme as never),
  ]);
  ready = h;
  loaded.add(`${language}\u0000${theme}`);
}

function tokenize(source: string, language: string, theme: string, tabSize: number) {
  const code = source.replace(/\t/g, ' '.repeat(tabSize)).replace(/\s+$/, '');
  const r = ready!.codeToTokens(code, { lang: language as never, theme: theme as never });
  const version: Version = { lines: [], tokens: [], columns: 0 };
  r.tokens.forEach((line, li) => {
    const out: Version['lines'][number] = [];
    let column = 0;
    for (const t of line) {
      const style = t.fontStyle ?? 0;
      const color = t.color ?? r.fg ?? '#e6edf3';
      const italic = (style & 1) !== 0,
        bold = (style & 2) !== 0;
      out.push({ text: t.content, color, italic, bold });
      for (const m of t.content.matchAll(/\S+/g))
        version.tokens.push({ text: m[0], color, italic, bold, line: li, column: column + m.index });
      column += t.content.length;
    }
    version.columns = Math.max(version.columns, column);
    version.lines.push(out);
  });
  return { version, background: r.bg ?? '#0d1117', foreground: r.fg ?? '#e6edf3' };
}

/** Longest common subsequence of token texts: which old tokens survive, and where they go. */
function diff(a: Token[], b: Token[]): { match: Int32Array; added: Uint8Array } {
  const n = a.length,
    m = b.length;
  const dp = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i * (m + 1) + j] =
        a[i]!.text === b[j]!.text
          ? dp[(i + 1) * (m + 1) + j + 1]! + 1
          : Math.max(dp[(i + 1) * (m + 1) + j]!, dp[i * (m + 1) + j + 1]!);
  const match = new Int32Array(n).fill(-1);
  const added = new Uint8Array(m).fill(1);
  let i = 0,
    j = 0;
  while (i < n && j < m) {
    if (a[i]!.text === b[j]!.text) {
      match[i] = j;
      added[j] = 0;
      i++;
      j++;
    } else if (dp[(i + 1) * (m + 1) + j]! >= dp[i * (m + 1) + j + 1]!) i++;
    else j++;
  }
  return { match, added };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function lineSet(highlight: CodeOptions['highlight']): Set<number> | null {
  if (!highlight) return null;
  const s = new Set<number>();
  for (const h of highlight) {
    if (typeof h === 'number') s.add(h - 1);
    else for (let i = h[0]; i <= h[1]; i++) s.add(i - 1);
  }
  return s;
}

/**
 * A highlighted code block. Give it `from` and `progress` to animate from one version of the code to the next:
 *
 * ```ts
 * code(after, { from: before, progress: interpolate(t, [1, 2], [0, 1]), language: 'rust' })
 * ```
 *
 * Without a background or padding of its own, it draws on a rounded card in the theme's background color.
 */
export function code(source: string, options: CodeOptions & NodeStyle = {}): SceneNode {
  const {
    language = 'ts',
    theme = 'github-dark-default',
    fontSize = 28,
    fontFamily,
    lineHeight = 1.5,
    tabSize = 2,
    from,
    progress,
    highlight,
    lineNumbers = false,
    ...style
  } = options;
  const p = progress === undefined ? 1 : clamp01(progress);
  const animating = from !== undefined && p < 1;
  const lh = fontSize * lineHeight;
  const lit = lineSet(highlight);
  const props = { fontSize, fontFamily, lineHeight };
  // Without a background or padding of its own, the block sits on a card in the theme's background color.
  const card = style.background === undefined && style.padding === undefined;
  const pad = fontSize * 1.2;

  const deferred: Deferred<CodeLayout> = {
    key: `code:${JSON.stringify([source, animating ? from : null, language, theme, fontSize, fontFamily, lineHeight, tabSize])}`,
    load: () => loadCode(language, theme),
    layout: (measure: MeasureText) => {
      if (!ready || !loaded.has(`${language}\u0000${theme}`)) return null;
      const to = tokenize(source, language, theme, tabSize);
      const prev = animating ? tokenize(from, language, theme, tabSize).version : null;
      const { match, added } = prev
        ? diff(prev.tokens, to.version.tokens)
        : { match: new Int32Array(0), added: new Uint8Array(0) };
      // Monospace: one advance for every column, measured over many characters for precision.
      const m = measure(['0'.repeat(64)], props);
      return {
        to: to.version,
        from: prev,
        match,
        added,
        advance: m.width / 64,
        baseline: m.baseline,
        background: to.background,
        foreground: to.foreground,
      };
    },
    build: (L) => {
      const gutter = lineNumbers
        ? (String(Math.max(L.to.lines.length, L.from?.lines.length ?? 0)).length + 2) * L.advance
        : 0;
      const size = (v: Version) => ({ w: gutter + v.columns * L.advance, h: Math.max(1, v.lines.length) * lh });
      const end = size(L.to);
      const dim = (line: number) => (lit && !lit.has(line) ? 0.3 : 1);
      const children: SceneNode[] = [];
      if (card)
        children.push(
          box({
            position: 'absolute',
            inset: { left: -pad, top: -pad, right: -pad, bottom: -pad },
            background: L.background,
            borderRadius: fontSize * 0.6,
          }),
        );
      const numbers = (v: Version, opacity: number) => {
        if (!lineNumbers || opacity <= 0) return;
        v.lines.forEach((_, i) => {
          children.push(
            text(String(i + 1), {
              ...props,
              color: L.foreground,
              position: 'absolute',
              inset: { left: 0, top: i * lh },
              size: { width: gutter - L.advance },
              textAlign: 'right',
              opacity: 0.35 * opacity,
              maxLines: 1,
            }),
          );
        });
      };
      const tokenNode = (t: Token, x: number, y: number, opacity: number) =>
        text(
          [
            span(t.text, {
              color: t.color,
              fontWeight: t.bold ? 'bold' : undefined,
              fontStyle: t.italic ? 'italic' : undefined,
            }),
          ],
          {
            ...props,
            position: 'absolute',
            inset: { left: x, top: y },
            size: { width: (t.text.length + 1) * L.advance },
            opacity,
            maxLines: 1,
          },
        );

      if (!L.from || !animating) {
        numbers(L.to, 1);
        L.to.lines.forEach((line, i) => {
          if (line.length === 0) return;
          children.push(
            text(
              line.map((s) =>
                span(s.text, {
                  color: s.color,
                  fontWeight: s.bold ? 'bold' : undefined,
                  fontStyle: s.italic ? 'italic' : undefined,
                }),
              ),
              {
                ...props,
                position: 'absolute',
                inset: { left: gutter, top: i * lh },
                size: { width: (L.to.columns + 1) * L.advance },
                opacity: dim(i),
                maxLines: 1,
              },
            ),
          );
        });
        return { width: end.w, height: end.h, children };
      }

      // Removed tokens fade out first, kept tokens move, then added tokens fade in.
      const out = 1 - clamp01(p / 0.35);
      const move = Easing.inOutCubic(clamp01((p - 0.15) / 0.7));
      const fadeIn = clamp01((p - 0.65) / 0.35);
      const start = size(L.from);
      numbers(p < 0.5 ? L.from : L.to, 1);
      L.from.tokens.forEach((t, i) => {
        const j = L.match[i]!;
        const x0 = gutter + t.column * L.advance,
          y0 = t.line * lh;
        if (j < 0) {
          if (out > 0) children.push(tokenNode(t, x0, y0, out));
          return;
        }
        const u = L.to.tokens[j]!;
        const x = x0 + (gutter + u.column * L.advance - x0) * move;
        const y = y0 + (u.line * lh - y0) * move;
        children.push(tokenNode(move < 0.5 ? t : u, x, y, 1 + (dim(u.line) - 1) * move));
      });
      L.to.tokens.forEach((u, j) => {
        if (L.added[j] && fadeIn > 0)
          children.push(tokenNode(u, gutter + u.column * L.advance, u.line * lh, fadeIn * dim(u.line)));
      });
      return {
        width: start.w + (end.w - start.w) * move,
        height: start.h + (end.h - start.h) * move,
        children,
      };
    },
  };

  return {
    type: 'box',
    style: card ? { padding: pad, ...style } : style,
    children: [{ type: 'box', style: {}, children: [], deferred }],
  };
}
