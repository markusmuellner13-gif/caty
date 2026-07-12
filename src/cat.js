// Percy: fully procedural cat model + code-driven animation rig.
// No external assets — fur texture is painted on a canvas at runtime.
import * as THREE from 'three';
import { clamp, damp, lerp, TAU } from './util.js';

export const CAT_PALETTES = {
  // The real Percy: gray-brown mackerel tabby, black stripes, amber eyes,
  // creamy chin/chest, pink nose, dark paws.
  percy: { base: '#8d7f68', stripe: '#3b352a', belly: '#eadfc6', nose: '#d98f92', eye: '#c9a43f', paw: '#403a2e', warm: '#b99a6f', name: 'Percy' },
  tabby: { base: '#e8873c', stripe: '#b45c1d', belly: '#ffedd6', nose: '#e07a7a', eye: '#66d06a', name: 'Orange Tabby' },
  shadow: { base: '#32323c', stripe: '#232329', belly: '#4d4d58', nose: '#8a6a6a', eye: '#f2c14e', name: 'Shadow Black' },
  smoke: { base: '#8d93a1', stripe: '#5b6070', belly: '#e8e8ee', nose: '#c98a8a', eye: '#f0a94a', name: 'Smoke Gray' },
  cloud: { base: '#f1eee6', stripe: '#ddd6c6', belly: '#ffffff', nose: '#efa0a0', eye: '#7ab8f5', name: 'Cloud White' },
};

function furTexture(base, stripe, warm, vertical = false) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  // warm ticked patches (agouti fur look, like the real Percy)
  if (warm) {
    g.globalAlpha = 0.25;
    for (let i = 0; i < 40; i++) {
      g.fillStyle = warm;
      const r = 8 + Math.random() * 22;
      g.beginPath();
      g.arc(Math.random() * 256, Math.random() * 256, r, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  }
  g.strokeStyle = stripe;
  g.lineCap = 'round';
  // Vertical stripes in UV = meridians on a sphere (head: stripes radiate
  // back from the forehead, the classic tabby "M")
  if (vertical) {
    for (let i = 0; i < 16; i++) {
      const x = 4 + i * 16 + Math.random() * 8;
      g.lineWidth = 3.5 + Math.random() * 5;
      g.globalAlpha = 0.45 + Math.random() * 0.25;
      g.beginPath();
      g.moveTo(x, -10);
      g.quadraticCurveTo(x + (Math.random() * 16 - 8), 128, x + (Math.random() * 20 - 10), 270);
      g.stroke();
    }
    g.globalAlpha = 1;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }
  // Mackerel tiger stripes — horizontal in UV space so they wrap the body
  // as rings (vertical stripes down the flanks, like a real tabby)
  for (let i = 0; i < 13; i++) {
    const y = 4 + i * 20 + Math.random() * 10;
    g.lineWidth = 4 + Math.random() * 7;
    g.globalAlpha = 0.5 + Math.random() * 0.28;
    g.beginPath();
    g.moveTo(-10, y);
    g.quadraticCurveTo(128, y + (Math.random() * 26 - 13), 270, y + (Math.random() * 34 - 17));
    g.stroke();
    // broken secondary bars between the main stripes
    if (Math.random() < 0.6) {
      g.globalAlpha = 0.3;
      g.lineWidth = 3 + Math.random() * 4;
      const y2 = y + 10;
      g.beginPath();
      g.moveTo(40 + Math.random() * 60, y2);
      g.lineTo(150 + Math.random() * 80, y2 + (Math.random() * 14 - 7));
      g.stroke();
    }
  }
  // Speckle / fur grain
  g.globalAlpha = 0.12;
  for (let i = 0; i < 600; i++) {
    g.fillStyle = Math.random() < 0.5 ? stripe : '#fff6e0';
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function createCat(paletteKey = 'percy') {
  const P = CAT_PALETTES[paletteKey] || CAT_PALETTES.percy;
  const tex = furTexture(P.base, P.stripe, P.warm);
  const fur = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, metalness: 0 });
  const headFur = new THREE.MeshStandardMaterial({ map: furTexture(P.base, P.stripe, P.warm, true), roughness: 0.9 });
  const furPlain = new THREE.MeshStandardMaterial({ color: P.base, roughness: 0.9 });
  const belly = new THREE.MeshStandardMaterial({ color: P.belly, roughness: 0.95 });
  const pawMat = new THREE.MeshStandardMaterial({ color: P.paw || P.belly, roughness: 0.95 });
  const tipMat = new THREE.MeshStandardMaterial({ color: P.stripe, roughness: 0.9 });
  const noseMat = new THREE.MeshStandardMaterial({ color: P.nose, roughness: 0.5 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: P.eye, roughness: 0.15, emissive: P.eye, emissiveIntensity: 0.25 });
  const pupilMat = new THREE.MeshStandardMaterial({ color: '#111111', roughness: 0.2 });
  const innerEar = new THREE.MeshStandardMaterial({ color: '#e8a0a0', roughness: 0.8 });

  const root = new THREE.Group();       // placed at ground level
  const body = new THREE.Group();       // bobs up/down
  root.add(body);

  // ---- Torso (capsule lying along +Z = forward) ----
  const torsoGeo = new THREE.CapsuleGeometry(0.21, 0.44, 6, 14);
  const torso = new THREE.Mesh(torsoGeo, fur);
  torso.rotation.x = Math.PI / 2;
  torso.position.y = 0.34;
  torso.scale.set(1, 1.06, 0.92);
  body.add(torso);

  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), belly);
  chest.position.set(0, 0.28, 0.18);
  chest.scale.set(0.9, 0.9, 1.15);
  body.add(chest);

  // ---- Head ----
  const neck = new THREE.Group();
  neck.position.set(0, 0.42, 0.34);
  body.add(neck);
  const head = new THREE.Group();
  head.position.set(0, 0.14, 0.16);
  neck.add(head);

  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.165, 16, 14), headFur);
  skull.scale.set(1.05, 0.95, 1);
  head.add(skull);

  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 10), belly);
  muzzle.position.set(0, -0.045, 0.115);
  muzzle.scale.set(1.15, 0.75, 1);
  head.add(muzzle);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.03, 4), noseMat);
  nose.rotation.x = Math.PI;
  nose.position.set(0, -0.02, 0.205);
  head.add(nose);

  // Ears
  const earGeo = new THREE.ConeGeometry(0.08, 0.17, 4);
  const ears = [];
  for (const s of [-1, 1]) {
    const ear = new THREE.Group();
    ear.position.set(0.09 * s, 0.165, -0.01);
    const outer = new THREE.Mesh(earGeo, furPlain);
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 4), innerEar);
    inner.position.z = 0.018;
    inner.position.y = -0.01;
    ear.add(outer, inner);
    ear.rotation.z = -0.25 * s;
    head.add(ear);
    ears.push(ear);
  }

  // Eyes with slit pupils
  const eyes = [];
  for (const s of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(0.062 * s, 0.02, 0.128);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.034, 10, 8), eyeMat);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.017, 8, 6), pupilMat);
    pupil.scale.set(0.5, 1.1, 0.6);
    pupil.position.z = 0.022;
    eye.add(ball, pupil);
    head.add(eye);
    eyes.push(eye);
  }

  // Whiskers
  const whiskerMat = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6 });
  const wPts = [];
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const y = -0.03 - i * 0.018;
      wPts.push(new THREE.Vector3(0.05 * s, y, 0.16), new THREE.Vector3(0.24 * s, y + (i - 1) * 0.03, 0.12));
    }
  }
  const whiskers = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(wPts), whiskerMat);
  head.add(whiskers);

  // ---- Legs (pivot at hip/shoulder) ----
  const legGeo = new THREE.CapsuleGeometry(0.05, 0.2, 4, 8);
  const pawGeo = new THREE.SphereGeometry(0.055, 8, 6);
  const legs = [];
  const legDefs = [
    { x: 0.13, z: 0.26, front: true },  // FL
    { x: -0.13, z: 0.26, front: true }, // FR
    { x: 0.14, z: -0.22, front: false },// BL
    { x: -0.14, z: -0.22, front: false } // BR
  ];
  for (const d of legDefs) {
    const pivot = new THREE.Group();
    pivot.position.set(d.x, 0.32, d.z);
    const upper = new THREE.Mesh(legGeo, fur);
    upper.position.y = -0.14;
    const paw = new THREE.Mesh(pawGeo, pawMat);
    paw.position.y = -0.29;
    paw.scale.set(1, 0.7, 1.2);
    pivot.add(upper, paw);
    body.add(pivot);
    legs.push({ pivot, front: d.front, side: Math.sign(d.x) });
  }

  // ---- Tail (chain) ----
  const tailSegs = [];
  let parent = body;
  let pos = new THREE.Vector3(0, 0.4, -0.32);
  for (let i = 0; i < 5; i++) {
    const seg = new THREE.Group();
    seg.position.copy(pos);
    const r = 0.05 - i * 0.006;
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, 0.1, 4, 8), i === 4 ? tipMat : fur);
    m.rotation.x = Math.PI / 2 + 0.3;
    m.position.z = -0.06;
    seg.add(m);
    parent.add(seg);
    parent = seg;
    pos = new THREE.Vector3(0, 0.02, -0.12);
    tailSegs.push(seg);
  }

  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });

  // ---------------- Animation ----------------
  let t = 0;
  let blink = 0;
  let nextBlink = 2;
  let deathT = -1;

  const S = {
    mode: 'idle',      // idle|walk|run|jump|fall|climb|sit|death|pounce|swim
    speed: 0,          // horizontal speed (m/s)
    grounded: true,
  };

  function update(dt, state) {
    Object.assign(S, state);
    t += dt;
    const run = clamp(S.speed / 6.5, 0, 1);
    const freq = 4 + run * 8;
    const ph = t * freq;

    // Blink
    nextBlink -= dt;
    if (nextBlink <= 0) { blink = 0.12; nextBlink = 1.5 + Math.random() * 4; }
    blink = Math.max(0, blink - dt);
    for (const e of eyes) e.scale.y = blink > 0 ? 0.1 : 1;

    if (S.mode === 'death') {
      if (deathT < 0) deathT = 0;
      deathT += dt;
      const k = clamp(deathT / 0.6, 0, 1);
      root.rotation.z = damp(root.rotation.z, Math.PI / 2 * 0.96, 8, dt);
      body.position.y = damp(body.position.y, -0.12, 8, dt);
      for (const l of legs) l.pivot.rotation.x = damp(l.pivot.rotation.x, 0.5, 6, dt);
      neck.rotation.x = damp(neck.rotation.x, 0.4, 6, dt);
      for (const e of eyes) e.scale.y = lerp(1, 0.06, k);
      for (const seg of tailSegs) seg.rotation.x = damp(seg.rotation.x, 0.1, 4, dt);
      return;
    }
    deathT = -1;
    root.rotation.z = damp(root.rotation.z, 0, 12, dt);

    let bodyY = 0, bodyPitch = 0, neckPitch = 0;
    const legTargets = [0, 0, 0, 0];
    let tailLift = 0.35, tailSway = 0.25, tailFreq = 1.6;

    switch (S.mode) {
      case 'sit': {
        bodyY = -0.09;
        bodyPitch = -0.45;
        neckPitch = 0.42;
        legTargets[0] = legTargets[1] = 0.35;
        legTargets[2] = legTargets[3] = -1.5;
        tailLift = -0.2; tailSway = 0.5; tailFreq = 1.1;
        break;
      }
      case 'idle': {
        bodyY = Math.sin(t * 2.2) * 0.008; // breathing
        neckPitch = Math.sin(t * 0.5) * 0.06;
        head.rotation.y = damp(head.rotation.y, Math.sin(t * 0.35) * 0.35, 2, dt);
        // occasional ear twitch
        ears[0].rotation.x = Math.sin(t * 7) > 0.985 ? -0.4 : damp(ears[0].rotation.x, 0, 8, dt);
        tailSway = 0.45; tailFreq = 1.3;
        break;
      }
      case 'walk':
      case 'run': {
        const amp = 0.45 + run * 0.5;
        legTargets[0] = Math.sin(ph) * amp;
        legTargets[3] = Math.sin(ph) * amp;          // diagonal pair
        legTargets[1] = Math.sin(ph + Math.PI) * amp;
        legTargets[2] = Math.sin(ph + Math.PI) * amp;
        bodyY = Math.abs(Math.sin(ph)) * (0.02 + run * 0.05);
        bodyPitch = Math.sin(ph * 2) * 0.03 * run;
        head.rotation.y = damp(head.rotation.y, 0, 6, dt);
        tailLift = 0.5 + run * 0.3; tailFreq = 2 + run * 3; tailSway = 0.2;
        break;
      }
      case 'jump': {
        legTargets[0] = legTargets[1] = -0.9; // front legs forward
        legTargets[2] = legTargets[3] = 1.0;  // back legs extended
        bodyPitch = 0.25;
        neckPitch = -0.15;
        tailLift = 0.1;
        break;
      }
      case 'fall': {
        legTargets[0] = legTargets[1] = -0.5;
        legTargets[2] = legTargets[3] = 0.4;
        bodyPitch = -0.2;
        neckPitch = 0.25;
        tailLift = 0.7; tailFreq = 6; tailSway = 0.5;
        break;
      }
      case 'climb': {
        const cph = t * 7;
        legTargets[0] = -1.4 + Math.sin(cph) * 0.5;
        legTargets[1] = -1.4 + Math.sin(cph + Math.PI) * 0.5;
        legTargets[2] = -0.6 + Math.sin(cph + Math.PI) * 0.4;
        legTargets[3] = -0.6 + Math.sin(cph) * 0.4;
        bodyPitch = -1.15;
        neckPitch = 1.0;
        tailLift = -0.3;
        break;
      }
      case 'pounce': {
        legTargets[0] = legTargets[1] = -1.2;
        legTargets[2] = legTargets[3] = 1.2;
        bodyPitch = 0.35;
        break;
      }
      case 'swim': {
        const sph = t * 6;
        legTargets[0] = Math.sin(sph) * 0.7;
        legTargets[1] = Math.sin(sph + Math.PI) * 0.7;
        legTargets[2] = Math.sin(sph + 1) * 0.7;
        legTargets[3] = Math.sin(sph + Math.PI + 1) * 0.7;
        bodyPitch = -0.25;
        neckPitch = 0.5;
        bodyY = Math.sin(t * 4) * 0.02;
        break;
      }
    }

    body.position.y = damp(body.position.y, bodyY, 10, dt);
    body.rotation.x = damp(body.rotation.x, bodyPitch, 10, dt);
    neck.rotation.x = damp(neck.rotation.x, neckPitch, 8, dt);
    for (let i = 0; i < 4; i++) {
      legs[i].pivot.rotation.x = damp(legs[i].pivot.rotation.x, legTargets[i], 14, dt);
    }
    // Tail
    for (let i = 0; i < tailSegs.length; i++) {
      const seg = tailSegs[i];
      seg.rotation.x = damp(seg.rotation.x, (i === 0 ? -tailLift : -tailLift * 0.25), 6, dt);
      seg.rotation.y = damp(seg.rotation.y, Math.sin(t * tailFreq * TAU * 0.5 + i * 0.7) * tailSway * (0.3 + i * 0.2), 8, dt);
    }
  }

  return { group: root, update, head, palette: P };
}
