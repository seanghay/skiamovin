// Cut list for the launch film (seconds), on a 120 BPM grid (beat = 0.5 s, bar = 2 s).
// Shared by the picture and the score so every hit lands on a cut.
export const BPM = 120;
export const BEAT = 60 / BPM;

export const CUTS = {
  reveal: [0, 4], // hero object emerges from darkness
  introducing: [4, 6], // "Introducing"
  hero: [6, 10], // the drop: object + name
  words: [10, 14], // one word per beat
  device: [14, 20], // MacBook
  code: [20, 24], // code → result
  speed: [24, 28], // frames flying, 120 fps
  languages: [28, 32], // one script per beat
  shaders: [32, 36], // SkSL
  montage: [36, 40], // made with Skiamovin, one cut per beat
  silence: [40, 42], // black
  end: [42, 48], // lockup
} as const satisfies Record<string, readonly [number, number]>;

export const DURATION = 48;
