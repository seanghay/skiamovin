// Renders the composition off the main thread, for both the live preview and exports.
import { serveComposition } from 'skiamovin/scene';
import { promo } from './promo.ts';

serveComposition(promo);
