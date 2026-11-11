// Shared fonts and assets for the samples.
import { ALL_FORMATS, FilePathSource, Input } from 'mediabunny';
import { FontAsset, ImageAsset } from 'skiamovin/scene';

const SYS = '/System/Library/Fonts/Supplemental/';
const font = (file: string, family: string) => new FontAsset(new FilePathSource(SYS + file), { family });

export const fonts = {
  arial: font('Arial.ttf', 'Arial'),
  arialBold: font('Arial Bold.ttf', 'Arial'),
  arialBlack: font('Arial Black.ttf', 'Arial Black'),
  georgia: font('Georgia.ttf', 'Georgia'),
  georgiaItalic: font('Georgia Italic.ttf', 'Georgia'),
  din: font('DIN Alternate Bold.ttf', 'DIN Alternate'),
  courier: font('Courier New Bold.ttf', 'Courier New'),
  khmer: font('Khmer Sangam MN.ttf', 'Khmer Sangam MN'),
  /** San Francisco, a variable font with weight and width axes. */
  sf: new FontAsset(new FilePathSource('/System/Library/Fonts/SFNS.ttf'), { family: 'SF Pro' }),
  menlo: new FontAsset(new FilePathSource('/System/Library/Fonts/Menlo.ttc'), { family: 'Menlo' }),
};

export const asset = (name: string) => new URL(`./assets/${name}`, import.meta.url).pathname;
export const input = (name: string) => new Input({ formats: ALL_FORMATS, source: new FilePathSource(asset(name)) });
export const image = (name: string) => new ImageAsset(new FilePathSource(asset(name)));
