// Screen shake for the heavy enemy moments (a brute's crash, a body hitting the floor). It
// goes through foundation's settings-scaled feedback channel, like every other shake.
import { feedback } from '../core/feedback.js';
export const quake = (px, ms) => feedback.shake(px, ms);
export const kick = (dx, dz, px) => feedback.kick(dx, dz * 0.77, px);
