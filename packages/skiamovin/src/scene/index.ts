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
export type { AssetSource, AudioAnalysis, FontAssetOptions, LutAssetOptions } from './assets.ts';
export { analyzeAudio, FontAsset, ImageAsset, LottieAsset, LutAsset, readSource, SvgAsset } from './assets.ts';
export { backgrounds } from './backgrounds.ts';
export type { CodeOptions } from './code.ts';
export { code } from './code.ts';
export type { CompositionOptions } from './composition.ts';
export { Composition, CompositionModule } from './composition.ts';
export type { DiagramOptions, DiagramTheme } from './diagram.ts';
export { diagram, diagramThemes } from './diagram.ts';
export type { Effect, GlassOptions, LayerStyle } from './effects.ts';
export { chromaticAberration, glow, grain, halftone, pixelate, sharpen, vignette } from './effects.ts';
export type { Axes, AxesOptions, CameraState } from './explain.ts';
export { axes, camera, create, fadeIn, fitCamera, indicate, numberLine } from './explain.ts';
export type { AdjustOptions, CurvesOptions, Grade, LevelsOptions, ParsedLut } from './grading.ts';
export {
  adjust,
  blendGrades,
  cdl,
  channelMixer,
  curves,
  gradeWheels,
  gradientMap,
  levels,
  lut,
  parseCube,
  posterize,
  threshold,
} from './grading.ts';
export type { MathOptions } from './math.ts';
export { math } from './math.ts';
export type {
  Child,
  Fit,
  Gradient,
  NodeStyle,
  PathStyle,
  RenderContext,
  SceneNode,
  SeriesItem,
  Shadow,
  Span,
  SplitText,
  TextProps,
  TextUnit,
  Transform,
  TransitionOptions,
  UnitStyle,
  VideoProps,
  VisualStyle,
} from './nodes.ts';
export {
  adjustmentLayer,
  audio,
  box,
  clipTo,
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
  transition,
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
export type { BodyDef, BodyShape, BodyState, Contact, JointDef, WorldDef } from './simulation.ts';
export { PhysicsWorld, physics } from './simulation.ts';
export type { StatesOptions } from './states.ts';
export { states } from './states.ts';
export { tailwindTheme } from './tailwind-theme.ts';
export type { RangeShape, TextAnimatorOptions } from './text-effects.ts';
export { counter, graphemeCount, scramble, textAnimator } from './text-effects.ts';
export type { TransitionInfo } from './transitions.ts';
export { listTransitions } from './transitions.ts';
export { tw } from './tw.ts';
export type { WorkerFactory } from './worker.ts';
export { CompositionWorker, serveComposition } from './worker.ts';
