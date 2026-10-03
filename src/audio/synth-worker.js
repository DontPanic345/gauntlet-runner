// Renders bank sounds off the main thread (piece `audio`), so warming the SFX cache never
// stalls a frame or the music scheduler. Message in: {id, layers, sr}. Out: {id, data}.
import { renderLayers } from './synth.js';

self.onmessage = (e) => {
  const { id, layers, sr } = e.data;
  const data = renderLayers(layers, sr);
  self.postMessage({ id, data }, [data.buffer]);
};
