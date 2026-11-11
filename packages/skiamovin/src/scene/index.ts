// Compositions: videos described as a function from time to a node tree.

export type { EasingFunction, InterpolateOptions, SpringOptions, TweenOptions } from './animation.ts';
export { Easing, interpolate, interpolateColor, mixColors, noise, random, spring, Timeline } from './animation.ts';
export type { AssetSource, AudioAnalysis, FontAssetOptions } from './assets.ts';
export { analyzeAudio, FontAsset, ImageAsset, LottieAsset, readSource, SvgAsset } from './assets.ts';
export type { CompositionOptions } from './composition.ts';
export { Composition, CompositionModule } from './composition.ts';
export type {
  Child,
  Fit,
  Gradient,
  NodeStyle,
  RenderContext,
  SceneNode,
  Shadow,
  Span,
  TextProps,
  Transform,
  VideoProps,
  VisualStyle,
} from './nodes.ts';
export {
  audio,
  box,
  draw,
  image,
  linearGradient,
  lottie,
  radialGradient,
  sequence,
  series,
  shader,
  span,
  svg,
  text,
  video,
} from './nodes.ts';
export type { PlayerOptions } from './player.ts';
export { Player } from './player.ts';
export type { CompositionSinkOptions, DiscardReason, RenderOptions } from './render.ts';
export { CompositionAudioSink, CompositionSink, Render } from './render.ts';
export type { WorkerFactory } from './worker.ts';
export { CompositionWorker, serveComposition } from './worker.ts';
