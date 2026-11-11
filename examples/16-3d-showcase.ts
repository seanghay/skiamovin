// 16 — 3D showcase: a ray-marched studio scene with an orbiting camera, then lit meshes with an extruded logo.
import { box, Composition, meshes, meshScene, sdfScene, series, text } from 'skiamovin/scene';
import { fonts } from './shared.ts';

const STAR = 'M0 -100 L29 -40 L95 -31 L47 15 L59 81 L0 50 L-59 81 L-47 15 L-95 -31 L-29 -40 Z';
const STAR_MESH = meshes.extrude(STAR, 50);
const TORUS = meshes.torus(110, 36);
const SPHERE = meshes.sphere(70, 48);
const VIEW = { width: 1920, height: 1080 };

const label = (s: string) =>
  box({ position: 'absolute', inset: { left: 90, bottom: 80 } }, [
    text(s, { fontFamily: 'SF Pro', fontSize: 44, fontWeight: 700, color: '#f8fafc' }),
  ]);

export default new Composition({
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 10,
  background: '#0b1120',
  fonts: [fonts.sf],
  render: (ctx) =>
    series(ctx, [
      {
        duration: 5,
        render: ({ timestamp: t }) =>
          box({ size: { width: '100%', height: '100%' } }, [
            sdfScene(
              VIEW,
              { tilt: 16, pan: -20 + t * 12, distance: 1700, target: [0, 20, 0] },
              [
                { shape: { kind: 'floor' }, y: 160, color: '#cbd5e1' },
                { shape: { kind: 'sphere', radius: 110 }, x: -330, y: 50, color: '#f472b6' },
                {
                  shape: { kind: 'box', width: 200, height: 200, depth: 200, radius: 24 },
                  y: 60,
                  rotateY: 25 + t * 25,
                  color: '#38bdf8',
                },
                {
                  shape: { kind: 'torus', radius: 110, tube: 40 },
                  x: 340,
                  y: 10,
                  rotateX: 70 + t * 20,
                  color: '#facc15',
                },
              ],
              { background: '#0b1120', fog: 5000 },
            ),
            label('Ray-marched, with soft shadows'),
          ]),
        transition: { name: 'dissolve', duration: 0.8 },
      },
      {
        duration: 5,
        render: ({ timestamp: t }) =>
          box({ size: { width: '100%', height: '100%' }, background: '#0b1120' }, [
            meshScene(VIEW, { tilt: 12 }, [
              { mesh: TORUS, color: '#facc15', x: -420, rotateX: 60 + t * 40, rotateY: t * 20 },
              { mesh: STAR_MESH, color: '#a78bfa', rotateY: t * 72, scale: 1.6, shine: 0.5 },
              { mesh: SPHERE, color: '#34d399', x: 420, y: Math.sin(t * 3) * 40 },
            ]),
            label('Meshes, lit and extruded'),
          ]),
      },
    ]),
});
