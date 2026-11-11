import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  Codec,
  Color,
  ContourMeasureIter,
  colorFilters,
  EncodedImageFormat,
  Font,
  FontMgr,
  gpu,
  Image,
  ImageInfo,
  imageFilters,
  init,
  liveObjectCount,
  M44,
  Paint,
  Path,
  PathOp,
  Picture,
  PictureRecorder,
  pathEffects,
  pdf,
  Rect,
  RRect,
  RuntimeEffect,
  Shader,
  SkiaError,
  surfaces,
  svg,
  TileMode,
  textlayout,
  version,
} from 'skiamovin';

const OUT = new URL('../../../test-output/', import.meta.url);
mkdirSync(OUT, { recursive: true });

function px(s: { readPixels(x: number, y: number, info?: ImageInfo): Uint8Array }, x: number, y: number): number[] {
  return [...s.readPixels(x, y, new ImageInfo(1, 1, 0, 3))];
}

test('init and version', async () => {
  await init({ registerNativeCodecs: false });
  const v = version();
  assert.equal(v.runtime, 'node');
  assert.match(v.skia, /Skia m\d+/);
});

test('raster drawing, colors and pixels', () => {
  using s = surfaces.rasterN32Premul([100, 100])!;
  const c = s.canvas();
  c.clear('#000000');
  using p = new Paint('rgb(255, 0, 0)');
  c.drawRect(Rect.fromXYWH(10, 10, 30, 30), p);
  p.setColor(Color.BLUE).setAntiAlias(true);
  c.drawCircle([70, 70], 20, p);
  p.setColor([0, 1, 0, 1]);
  c.drawRRect(RRect.newRectXY(Rect.fromXYWH(60, 5, 30, 20), 5, 5), p);
  assert.deepEqual(px(s, 20, 20), [255, 0, 0, 255]);
  assert.deepEqual(px(s, 70, 70), [0, 0, 255, 255]);
  assert.deepEqual(px(s, 75, 15), [0, 255, 0, 255]);
  assert.deepEqual(px(s, 5, 95), [0, 0, 0, 255]);
  const png = s.encodeToData();
  assert.deepEqual([...png.slice(1, 4)], [0x50, 0x4e, 0x47]);
  writeFileSync(new URL('core-shapes.png', OUT), png);
});

test('transforms, save/restore and layers', () => {
  using s = surfaces.rasterN32Premul([100, 100])!;
  const c = s.canvas();
  c.clear(Color.WHITE);
  using p = new Paint(Color.BLACK);
  c.save();
  c.translate([50, 50]);
  c.rotate(45);
  c.drawRect(Rect.fromXYWH(-10, -10, 20, 20), p);
  c.restore();
  assert.equal(c.saveCount(), 1);
  using half = new Paint().setAlphaf(0.5);
  c.saveLayer({ paint: half });
  c.drawRect(Rect.fromXYWH(0, 0, 20, 20), p);
  c.drawRect(Rect.fromXYWH(10, 10, 20, 20), p); // overlap must not double-darken inside a layer
  c.restore();
  const a = px(s, 5, 5)[0]!;
  const b = px(s, 15, 15)[0]!;
  assert.ok(Math.abs(a - b) <= 1, `layer opacity should be uniform: ${a} vs ${b}`);
  assert.deepEqual(px(s, 50, 50), [0, 0, 0, 255]);
  c.concat44(M44.translate(1, 0, 0));
});

test('paths: build, svg, bounds, measure, ops, trim', () => {
  using path = new Path().moveTo([0, 0]).lineTo([100, 0]).lineTo([100, 100]).close();
  assert.deepEqual(path.bounds().toArray(), [0, 0, 100, 100]);
  assert.ok(path.contains([90, 10]));
  assert.ok(!path.contains([10, 90]));
  const svgP = Path.fromSVG('M0 0 L10 0 L10 10 Z')!;
  assert.equal(svgP.countPoints(), 3);
  assert.match(svgP.toSVGString(), /M0 0/);
  using line = new Path().moveTo([0, 0]).lineTo([300, 400]);
  assert.ok(Math.abs(line.length() - 500) < 0.01);
  using it = new ContourMeasureIter(line);
  const m = it.next()!;
  const [x, y] = m.getPosTan(250)!;
  assert.ok(Math.abs(x - 150) < 0.01 && Math.abs(y - 200) < 0.01);
  assert.equal(Path.fromSVG('invalid!'), null);
  const a = new Path().addRect(Rect.fromWH(10, 10));
  const b = new Path().addRect(Rect.fromXYWH(5, 5, 10, 10));
  const u = Path.op(a, b, PathOp.Union)!;
  assert.deepEqual(u.bounds().toArray(), [0, 0, 15, 15]);
  const morph = Path.interpolate(a, new Path().addRect(Rect.fromXYWH(10, 10, 10, 10)), 0.5)!;
  assert.deepEqual(morph.bounds().toArray(), [5, 5, 15, 15]);
  assert.ok(pathEffects.trim(0, 0.5));
  assert.ok(pathEffects.dash([4, 2]));
});

test('gradients, runtime effects and filters', () => {
  using s = surfaces.rasterN32Premul([100, 10])!;
  const c = s.canvas();
  using g = Shader.linearGradient(
    [
      [0, 0],
      [100, 0],
    ],
    ['#ff0000', '#0000ff'],
    null,
    TileMode.Clamp,
  )!;
  using p = new Paint().setShader(g);
  c.drawPaint(p);
  assert.ok(px(s, 1, 5)[0]! > 240 && px(s, 98, 5)[2]! > 240);

  const effect = RuntimeEffect.makeForShader(`
    uniform float2 iResolution; uniform float4 color;
    half4 main(float2 p) { return p.x < iResolution.x * 0.5 ? half4(color) : half4(0, 0, 0, 1); }`);
  assert.deepEqual(
    effect.uniforms().map((u) => u.name),
    ['iResolution', 'color'],
  );
  using sh = effect.makeShader({ iResolution: [100, 10], color: [0, 1, 0, 1] });
  p.setShader(sh);
  c.drawPaint(p);
  assert.deepEqual(px(s, 10, 5), [0, 255, 0, 255]);
  assert.deepEqual(px(s, 90, 5), [0, 0, 0, 255]);
  assert.throws(() => RuntimeEffect.makeForShader('half4 main(float2 p) { return nope; }'), SkiaError);

  const child = RuntimeEffect.makeForShader(
    `uniform shader content; half4 main(float2 p) { return content.eval(p).bgra; }`,
  );
  using red = Shader.linearGradient(
    [
      [0, 0],
      [1, 0],
    ],
    ['#ff0000', '#ff0000'],
    null,
  )!;
  p.setShader(child.makeShader({}, { content: red }));
  c.drawPaint(p);
  assert.deepEqual(px(s, 50, 5), [0, 0, 255, 255]);

  assert.ok(imageFilters.blur([4, 4]));
  assert.ok(imageFilters.dropShadow([0, 4], [8, 8], '#00000080'));
  assert.ok(colorFilters.saturation(0));
});

test('image encode/decode round trip', () => {
  using s = surfaces.rasterN32Premul([16, 16])!;
  s.canvas().clear('#336699');
  const bytes = s.encodeToData(EncodedImageFormat.PNG);
  using img = Image.fromEncoded(bytes);
  assert.deepEqual(img.dimensions(), [16, 16]);
  assert.deepEqual([...img.readPixels(0, 0, new ImageInfo(1, 1, 0, 3))], [0x33, 0x66, 0x99, 255]);
  assert.ok(img.encodeToData(EncodedImageFormat.JPEG, 90)!.length > 100);
  assert.ok(img.encodeToData(EncodedImageFormat.WEBP, 90)!.length > 10);
  assert.throws(() => Image.fromEncoded(new Uint8Array([1, 2, 3])), SkiaError);
  assert.equal(Codec.fromData(new Uint8Array([1, 2, 3])), null);
});

test('fonts and SkParagraph', () => {
  const fm = FontMgr.default();
  assert.ok(fm.countFamilies() > 0);
  const tf = fm.matchFamilyStyle('Helvetica') ?? fm.legacyMakeTypeface(null)!;
  using font = new Font(tf, 32);
  const [adv] = font.measureStr('Hello');
  assert.ok(adv > 40 && adv < 120, `advance ${adv}`);

  const fc = new textlayout.FontCollection();
  fc.setDefaultFontManager(fm);
  const ts = new textlayout.TextStyle().setFontFamilies(['Helvetica']).setFontSize(40).setColor('#ffffff');
  const ps = new textlayout.ParagraphStyle().setTextStyle(ts).setTextAlign(textlayout.TextAlign.Center);
  const text = 'Héllo wörld — programmatic video ✨';
  const para = new textlayout.ParagraphBuilder(ps, fc).addText(text).build();
  para.layout(300);
  assert.ok(para.lineNumber() >= 2, 'wraps to multiple lines');
  assert.ok(para.height() > 80);
  const idx = text.indexOf('wörld');
  const [box] = para.getRectsForRange([idx, idx + 5]);
  assert.ok(box && box.rect.width() > 50, 'range rect for UTF-16 indices');
  const lm = para.getLineMetrics();
  assert.equal(lm[0]!.startIndex, 0);
  let glyphs = 0;
  para.visit((_, run) => {
    glyphs += run.glyphs.length;
    run.font.delete();
  });
  assert.ok(glyphs > 20);

  using s = surfaces.rasterN32Premul([300, 200])!;
  s.canvas().clear('#111827');
  para.paint(s.canvas(), [0, 0]);
  writeFileSync(new URL('core-paragraph.png', OUT), s.encodeToData());
});

test('svg, pictures and pdf', () => {
  const dom = svg.Dom.fromString(
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#ff0000"/></svg>',
  );
  assert.equal(dom.intrinsicSize().width, 40);
  using s = surfaces.rasterN32Premul([40, 20])!;
  dom.render(s.canvas());
  assert.deepEqual(px(s, 20, 10), [255, 0, 0, 255]);

  const rec = new PictureRecorder();
  const rc = rec.beginRecording(Rect.fromWH(40, 20));
  rc.drawRect(Rect.fromWH(40, 20), new Paint('#00ff00'));
  const pic = rec.finishRecordingAsPicture()!;
  const again = Picture.fromData(pic.serialize())!;
  s.canvas().drawPicture(again);
  assert.deepEqual(px(s, 20, 10), [0, 255, 0, 255]);

  const doc = pdf.newDocument({ title: 'test' });
  const pc = doc.beginPage(200, 100);
  pc.drawCircle([100, 50], 30, new Paint('#ff00ff'));
  const bytes = doc.close();
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
});

test('metal gpu surface', () => {
  const info = gpu.info();
  assert.equal(info.backend, 'metal');
  const ctx = gpu.directContexts.makeDefault()!;
  assert.ok(ctx);
  const s = gpu.surfaces.renderTarget(ctx, gpu.Budgeted.Yes, ImageInfo.newN32Premul([64, 64]), { sampleCount: 4 })!;
  assert.ok(s.isGpu());
  const c = s.canvas();
  c.clear('#ff8800');
  c.drawCircle([32, 32], 10, new Paint('#0000ff').setAntiAlias(true));
  assert.deepEqual(px(s, 2, 2), [255, 136, 0, 255]);
  assert.deepEqual(px(s, 32, 32), [0, 0, 255, 255]);
  const snap = s.imageSnapshot();
  assert.ok(snap.isTextureBacked());
  assert.ok(snap.encodeToData()!.length > 50, 'encode a texture-backed image');
  s.delete();
  ctx.delete();
});

test('objects are released', () => {
  const before = liveObjectCount();
  for (let i = 0; i < 100; i++) {
    using _p = new Paint();
    using _path = new Path().lineTo([1, 1]);
  }
  assert.equal(liveObjectCount(), before);
  const p = new Paint();
  p.delete();
  assert.throws(() => p.setColor(0), /deleted/);
});
