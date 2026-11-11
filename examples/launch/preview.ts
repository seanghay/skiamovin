// Renders a still from the middle of every cut into output/launch-stills.png for a quick look.
import { writeFileSync } from 'node:fs';
import { Paint, Rect, surfaces } from 'skiamovin';
import { CompositionSink } from 'skiamovin/scene';
import film from './launch.ts';
import { CUTS } from './timing.ts';

const times = Object.entries(CUTS)
  .filter(([k]) => k !== 'silence')
  .map(([, [a, b]]) => a + (b - a) * 0.66);
const sink = new CompositionSink(film, { width: 640 });
const sheet = surfaces.rasterN32Premul([640 * 2 + 10, 360 * 6 + 50])!;
sheet.canvas().clear('#222');
for (let i = 0; i < times.length; i++) {
  const { image } = (await sink.getImage(times[i]!))!;
  sheet
    .canvas()
    .drawImageRect(image, null, Rect.fromXYWH((i % 2) * 650, Math.floor(i / 2) * 370, 640, 360), new Paint());
  image.delete();
}
writeFileSync(new URL('../output/launch-stills.png', import.meta.url), sheet.encodeToData());
console.log('stills at', times.map((t) => t.toFixed(2)).join(', '));
