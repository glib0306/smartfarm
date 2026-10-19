// Three.js 3D growth simulation of a rice or wheat plot. Plants are generated procedurally from the growth state
// predicted by MES: leaf number, tiller number, plant height, ripeness and growth stage.
import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

const GREEN = new THREE.Color('#3f8f2f');
const GOLD = new THREE.Color('#d9b23a');

function leafGeometry(length, width) {
  // a curved strap-shaped leaf as a thin bent plane
  const g = new THREE.PlaneGeometry(width, length, 1, 8);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) + length / 2;
    const t = y / length;
    pos.setY(i, y);
    pos.setZ(i, t * t * length * 0.45); // bend outward
    pos.setX(i, pos.getX(i) * (1 - t * 0.85)); // taper
  }
  g.computeVertexNormals();
  return g;
}

function buildPlant(state, crop, rnd) {
  const group = new THREE.Group();
  const height = Math.max(0.05, state.height_cm / 100);
  const tillers = Math.max(1, Math.round(crop === 'rice' ? state.tiller : state.tiller * 1.2));
  const leaves = Math.max(1, Math.round(state.leaf));
  const color = GREEN.clone().lerp(GOLD, state.ripeness);
  const stemMat = new THREE.MeshLambertMaterial({ color: color.clone().multiplyScalar(0.9) });
  const leafMat = new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide });
  const headMat = new THREE.MeshLambertMaterial({ color: GOLD.clone().lerp(new THREE.Color('#8fae4c'), 1 - state.ripeness) });
  const heading = ['Heading', 'Grain filling', 'Maturity'].indexOf(state.stage) >= 0;
  const visibleLeaves = Math.min(5, leaves);
  for (let t = 0; t < Math.min(tillers, 24); t++) {
    const tiller = new THREE.Group();
    const lean = (t === 0 ? 0 : 0.12 + rnd() * 0.22);
    tiller.rotation.z = lean;
    tiller.rotation.y = (t / Math.min(tillers, 24)) * Math.PI * 2 + rnd();
    const h = height * (0.85 + rnd() * 0.2);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.007, h, 5), stemMat);
    stem.position.y = h / 2;
    tiller.add(stem);
    for (let l = 0; l < visibleLeaves; l++) {
      const len = h * (0.45 + 0.35 * (l / visibleLeaves));
      const leaf = new THREE.Mesh(leafGeometry(len, 0.018), leafMat);
      leaf.position.y = h * (0.15 + 0.7 * (l / visibleLeaves));
      leaf.rotation.y = l * 2.4 + rnd();
      leaf.rotation.x = -0.25;
      tiller.add(leaf);
    }
    if (heading) {
      if (crop === 'rice') {
        // drooping panicle: chain of small grains along a bent curve
        const n = 10;
        for (let k = 0; k < n; k++) {
          const s = k / n;
          const grain = new THREE.Mesh(new THREE.SphereGeometry(0.009, 5, 4), headMat);
          grain.position.set(Math.sin(s * 1.6) * 0.08, h + Math.cos(s * 1.6) * 0.06 - 0.02 - s * 0.05 * state.ripeness * 2, 0);
          tiller.add(grain);
        }
      } else {
        const spike = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.01, 0.09, 6), headMat);
        spike.position.y = h + 0.045;
        tiller.add(spike);
      }
    }
    group.add(tiller);
  }
  return group;
}

export default function CropScene({ state, crop, height = 360 }) {
  const mount = useRef(null);
  const ctx = useRef(null);

  // one-time scene setup
  useEffect(() => {
    const el = mount.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(crop === 'rice' ? '#dceefa' : '#eef1fa');
    const camera = new THREE.PerspectiveCamera(40, el.clientWidth / height, 0.01, 50);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(el.clientWidth, height);
    el.appendChild(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x556644, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 0.7);
    sun.position.set(2, 4, 3);
    scene.add(sun);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(3, 3),
      new THREE.MeshLambertMaterial({ color: crop === 'rice' ? '#6b8fa8' : '#8a6d4f' }));
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);
    const plot = new THREE.Group();
    scene.add(plot);
    let yaw = 0.6;
    let pitch = 0.45;
    let dist = 2.2;
    const place = () => {
      camera.position.set(Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist + 0.2, Math.cos(yaw) * Math.cos(pitch) * dist);
      camera.lookAt(0, 0.35, 0);
    };
    place();
    let drag = null;
    const down = (e) => { drag = { x: e.clientX, y: e.clientY }; };
    const move = (e) => {
      if (!drag) return;
      yaw -= (e.clientX - drag.x) * 0.01;
      pitch = Math.max(0.05, Math.min(1.3, pitch + (e.clientY - drag.y) * 0.01));
      drag = { x: e.clientX, y: e.clientY };
      place();
    };
    const up = () => { drag = null; };
    const wheel = (e) => { e.preventDefault(); dist = Math.max(0.8, Math.min(5, dist * (e.deltaY > 0 ? 1.1 : 0.9))); place(); };
    renderer.domElement.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    renderer.domElement.addEventListener('wheel', wheel, { passive: false });
    let raf;
    let auto = true;
    renderer.domElement.addEventListener('pointerdown', () => { auto = false; });
    const loop = () => {
      if (auto) { yaw += 0.002; place(); }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();
    const resize = () => {
      camera.aspect = el.clientWidth / height;
      camera.updateProjectionMatrix();
      renderer.setSize(el.clientWidth, height);
    };
    window.addEventListener('resize', resize);
    ctx.current = { scene, plot };
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, [crop, height]);

  // rebuild plants whenever the simulated growth state changes
  useEffect(() => {
    if (!ctx.current || !state) return;
    const { plot } = ctx.current;
    while (plot.children.length) {
      const c = plot.children.pop();
      c.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const n = crop === 'rice' ? 4 : 6; // hills per side (rice transplanted in hills, wheat drilled densely)
    const spacing = crop === 'rice' ? 0.3 : 0.2;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const p = buildPlant(crop === 'wheat' ? { ...state, tiller: Math.max(1, state.tiller / 2) } : state, crop, rnd);
        p.position.set((i - (n - 1) / 2) * spacing + (rnd() - 0.5) * 0.03, 0, (j - (n - 1) / 2) * spacing + (rnd() - 0.5) * 0.03);
        plot.add(p);
      }
    }
  }, [state, crop]);

  return <div ref={mount} style={{ width: '100%', height, borderRadius: 6, overflow: 'hidden', cursor: 'grab' }} aria-label={`3D ${crop} growth simulation`} />;
}
