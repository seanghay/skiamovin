// 19 — Film gallery: photos as cards in 3D, a focus pull between them, a slow camera move with handheld drift, a
// film grade, grain and a touch of lens distortion.
import {
  box,
  Composition,
  cameraMove,
  chromaticAberration,
  grain,
  handheld,
  image,
  interpolate,
  looks,
  space3d,
  vignette,
} from 'skiamovin/scene';
import { image as asset } from './shared.ts';

const PHOTOS = ['photo1.jpg', 'photo2.jpg', 'photo3.jpg'].map(asset);
const CARD = { width: 760, height: 500 };
const PLACES = [
  { x: -640, z: -320, rotateY: 24 },
  { x: 0, z: 0, rotateY: 0 },
  { x: 640, z: -320, rotateY: -24 },
];
// The default camera is about 1484 px from z = 0 at 1080 px tall.
const NEAR = 1484,
  FAR = NEAR + 320;

export default new Composition({
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 8,
  background: '#0c0a09',
  render: ({ timestamp: t }) => {
    const move = cameraMove(
      [
        { time: 0, camera: { x: -200, y: 0, zoom: 1 } },
        { time: 8, camera: { x: 200, y: 0, zoom: 1 } },
      ],
      t,
    );
    const shake = handheld({ x: 0, y: 0 }, t, { amount: 0.6, seed: 'gallery' });
    const focus = interpolate(t, [0, 2.5, 4.5, 8], [FAR, FAR, NEAR, NEAR]);
    return box(
      {
        size: { width: '100%', height: '100%' },
        grade: looks.film(),
        effects: [chromaticAberration({ amount: 1.5 }), vignette({ amount: 0.4 }), grain({ amount: 0.04 })],
      },
      [
        space3d(
          { width: 1920, height: 1080 },
          { pan: move.x / 40 + shake.x * 0.1, tilt: 4 + shake.y * 0.1, roll: shake.rotate, focus, aperture: 26 },
          PLACES.map((p, i) => ({
            node: image(PHOTOS[i]!, { size: CARD, fit: 'cover', borderRadius: 14 }),
            ...p,
          })),
        ),
      ],
    );
  },
});
