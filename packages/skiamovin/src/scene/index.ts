// Compositions: videos described as a function from time to a node tree.

export type {
  EasingFunction,
  InterpolateOptions,
  KeyframeOptions,
  SpringOptions,
  StaggerFunction,
  StaggerOptions,
  TimelineOptions,
  TweenOptions,
} from './animation.ts';
export {
  Easing,
  interpolate,
  interpolateColor,
  keyframes,
  loopTime,
  mixColors,
  noise,
  random,
  spring,
  stagger,
  Timeline,
  wiggle,
} from './animation.ts';
export type { AssetSource, AudioAnalysis, FontAssetOptions } from './assets.ts';
export { analyzeAudio, FontAsset, ImageAsset, LottieAsset, readSource, SvgAsset } from './assets.ts';
export type { CompositionOptions } from './composition.ts';
export { Composition, CompositionModule } from './composition.ts';
export type {
  Child,
  Fit,
  Gradient,
  NodeStyle,
  PathStyle,
  RenderContext,
  SceneNode,
  Shadow,
  Span,
  SplitText,
  TextProps,
  TextUnit,
  Transform,
  UnitStyle,
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
  path,
  radialGradient,
  sequence,
  series,
  shader,
  span,
  svg,
  text,
  video,
} from './nodes.ts';
export { alongPath, morphPath } from './paths.ts';
export type {
  DecayOptions,
  FallOptions,
  FlingOptions,
  GesturePoint,
  SpringFeel,
  SpringParams,
  SpringPathOptions,
  SpringPhysics,
  SpringTarget,
} from './physics.ts';
export {
  attachmentSpring,
  decay,
  decayDuration,
  decelerationRates,
  fall,
  fling,
  gesture,
  motions,
  projectedEnd,
  rubberBand,
  snapSpring,
  springConstants,
  springPath,
  springSettlingTime,
  springState,
  springs,
} from './physics.ts';
export type { PlayerOptions } from './player.ts';
export { Player } from './player.ts';
export type { CompositionSinkOptions, DiscardReason, RenderOptions } from './render.ts';
export { CompositionAudioSink, CompositionSink, Render } from './render.ts';
export type { RangeShape, TextAnimatorOptions } from './text-effects.ts';
export { counter, graphemeCount, scramble, textAnimator } from './text-effects.ts';
export type { WorkerFactory } from './worker.ts';
export { CompositionWorker, serveComposition } from './worker.ts';
