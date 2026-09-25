// The frame: WebGL renderer at a low internal resolution, integer nearest-neighbour upscale
// (CSS image-rendering: pixelated), a 2D UI canvas on the same pixel grid, and the fixed
// orthographic three-quarter camera with texel-snapped motion.
//
// The `look` piece owns the render look (post, palette quantise, outlines, lights). It plugs
// in through display.pipeline and display.lights rather than replacing this module.
// The `movement` piece's camera.js drives display.setCameraTarget().
//
//   display.width / display.height   internal resolution in pixels (about 360 tall)
//   display.scale                    integer upscale factor
//   display.ui                       CanvasRenderingContext2D at internal resolution, cleared each frame
//   display.PPU                      internal pixels per world unit (1 world unit = 8 voxels)

import * as THREE from 'three';
import { hex, css } from '../render/palette.js';
import { feedback } from './feedback.js';

export const TARGET_H = 360;           // aim for ~360 internal px tall (GAME.md: 320-400)
export const PPU = 32;                 // internal pixels per world unit
export const CAMERA_PITCH = THREE.MathUtils.degToRad(50); // down from horizontal
export const CAMERA_DIST = 60;

const tmp = new THREE.Vector3();
const ray = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

export const display = {
  PPU,
  width: 640,
  height: 360,
  scale: 2,
  renderer: null,
  scene: null,
  camera: null,
  ui: null,
  uiCanvas: null,
  lights: null,
  cameraTarget: new THREE.Vector3(),
  /** Sub-texel remainder after snapping, world units (for optional smoothing by `look`). */
  snapRemainder: new THREE.Vector2(),
  /** Replaceable render step: (renderer, scene, camera) => void. `look` installs post here. */
  pipeline: null,

  init(container) {
    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(1);
    renderer.domElement.id = 'gl';
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const ui = document.createElement('canvas');
    ui.id = 'ui2d';
    container.appendChild(ui);
    this.uiCanvas = ui;
    this.ui = ui.getContext('2d');

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(hex('night'));

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    // Default light rig (cool ambient against a warm key). `look` retunes or replaces it.
    const hemi = new THREE.HemisphereLight(hex('frost'), hex('dusk'), 1.6);
    const key = new THREE.DirectionalLight(hex('torch'), 2.4);
    key.position.set(-4, 10, 6);
    const rim = new THREE.DirectionalLight(hex('blue'), 0.9);
    rim.position.set(6, 4, -8);
    this.scene.add(hemi, key, rim);
    this.lights = { hemi, key, rim };

    this.pipeline = (r, s, c) => r.render(s, c);
    this.resize();
    addEventListener('resize', () => this.resize());
    this.setCameraTarget(0, 0, 0);
  },

  resize() {
    const k = Math.max(1, Math.round(innerHeight / TARGET_H));
    const w = Math.ceil(innerWidth / k);
    const h = Math.ceil(innerHeight / k);
    this.scale = k; this.width = w; this.height = h;
    this.renderer.setSize(w, h, false);
    this.uiCanvas.width = w; this.uiCanvas.height = h;
    for (const el of [this.renderer.domElement, this.uiCanvas]) {
      el.style.width = `${w * k}px`;
      el.style.height = `${h * k}px`;
    }
    this.ui.imageSmoothingEnabled = false;
    const c = this.camera;
    c.left = -w / 2 / PPU; c.right = w / 2 / PPU;
    c.top = h / 2 / PPU; c.bottom = -h / 2 / PPU;
    c.updateProjectionMatrix();
    this.setCameraTarget(this.cameraTarget.x, this.cameraTarget.y, this.cameraTarget.z);
  },

  /**
   * Point the camera at a world position. The result is snapped so the view moves in whole
   * internal pixels: static geometry never swims. Call every render frame with the smoothed target.
   */
  setCameraTarget(x, y, z) {
    this.cameraTarget.set(x, y, z);
    this._placeCamera(0, 0);
  },

  /** Integer camera zoom (1 = game scale). Showcases use 2 for close-ups. */
  setZoom(z) {
    this.camera.zoom = Math.max(1, Math.round(z));
    this.camera.updateProjectionMatrix();
    this._placeCamera(0, 0);
  },
  get zoom() { return this.camera.zoom; },

  _placeCamera(shakeX, shakeY) {
    const c = this.camera;
    const P = PPU * c.zoom;
    const t = this.cameraTarget;
    const cp = Math.cos(CAMERA_PITCH), sp = Math.sin(CAMERA_PITCH);
    // camera basis: right = +x, up = (0, cp, -sp), back (toward camera) = (0, sp, cp)
    const r = t.x;
    const u = t.y * cp - t.z * sp;
    const b = t.y * sp + t.z * cp;
    const rs = Math.round(r * P) / P + shakeX / P;
    const us = Math.round(u * P) / P - shakeY / P;
    this.snapRemainder.set(r - Math.round(r * P) / P, u - Math.round(u * P) / P);
    // reconstruct the snapped look-at point, then back off along the view axis
    const lx = rs, ly = us * cp + b * sp, lz = -us * sp + b * cp;
    c.position.set(lx, ly + sp * CAMERA_DIST, lz + cp * CAMERA_DIST);
    c.up.set(0, 1, 0);
    c.lookAt(lx, ly, lz);
    c.updateMatrixWorld();
  },

  /** CSS pixel coords -> point on the horizontal plane y = groundY, or null. */
  screenToGround(cssX, cssY, groundY = 0) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const nx = ((cssX - rect.left) / rect.width) * 2 - 1;
    const ny = -((cssY - rect.top) / rect.height) * 2 + 1;
    ray.setFromCamera({ x: nx, y: ny }, this.camera);
    plane.constant = -groundY;
    return ray.ray.intersectPlane(plane, tmp) ? { x: tmp.x, z: tmp.z } : null;
  },

  /** World position -> internal pixel coords {x, y} (for UI labels over 3D things). */
  worldToScreen(x, y, z) {
    tmp.set(x, y, z).project(this.camera);
    return { x: Math.round((tmp.x + 1) / 2 * this.width), y: Math.round((1 - tmp.y) / 2 * this.height) };
  },

  /** Draw the 3D frame, apply the feedback channel (shake, flash), and clear the UI canvas. */
  render(realDt) {
    feedback.update(realDt);
    const o = feedback.offset();
    this._placeCamera(o.x, o.y);
    this.pipeline(this.renderer, this.scene, this.camera);
    this._placeCamera(0, 0);
    const g = this.ui;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.clearRect(0, 0, this.width, this.height);
    const f = feedback.flashState();
    if (f) {
      g.globalAlpha = f.alpha;
      g.fillStyle = f.color.startsWith('#') ? f.color : css(f.color);
      g.fillRect(0, 0, this.width, this.height);
      g.globalAlpha = 1;
    }
  },
};
