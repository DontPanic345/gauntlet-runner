// Bootstrap placeholder written during project setup (run 1).
// The build wave replaces this; see hurdles/pieces.json for which piece owns what.
// It exists only to prove the toolchain and debug-hook contract work end to end.
import * as THREE from 'three';

const params = new URLSearchParams(location.search);

const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d0b14);
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.1, 200);
camera.position.set(8, 10, 12);
camera.lookAt(0, 0, 0);

scene.add(new THREE.HemisphereLight(0xb8c4ff, 0x2a1d33, 1.2));
const sun = new THREE.DirectionalLight(0xffe2b0, 2.0);
sun.position.set(5, 10, 3);
scene.add(sun);

const cube = new THREE.Mesh(
  new THREE.BoxGeometry(2, 2, 2),
  new THREE.MeshStandardMaterial({ color: 0xe0564a, flatShading: true }),
);
scene.add(cube);

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

let frame = 0;
renderer.setAnimationLoop((t) => {
  cube.rotation.y = t / 1000;
  renderer.render(scene, camera);
  frame++;
});

// Debug-hook contract (see hurdles/PROTOCOL.md, "Game contract").
window.__GR = {
  get frame() { return frame; },
  scene: params.get('scene') ?? 'title',
  seed: Number(params.get('seed') ?? 1),
  ready: true,
};
