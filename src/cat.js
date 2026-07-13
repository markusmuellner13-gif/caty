// Percy v2: procedural cat with real feline proportions and a lively
// code-driven animation rig. No external assets — fur is painted at runtime.
import * as THREE from 'three';
import { clamp, damp, TAU } from './util.js';

export const CAT_PALETTES = {
  // The real Percy: gray-brown mackerel tabby, black stripes, amber eyes,
  // creamy chin/chest, pink nose, dark paws.
  percy: { base: '#8d7f68', stripe: '#3b352a', belly: '#eadfc6', nose: '#d98f92', eye: '#c9a43f', paw: '#403a2e', warm: '#b99a6f', name: 'Percy' },
  tabby: { base: '#e8873c', stripe: '#b45c1d', belly: '#ffedd6', nose: '#e07a7a', eye: '#66d06a', warm: '#f2a869', name: 'Orange Tabby' },
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
  // warm ticked agouti patches, like the real Percy
  if (warm) {
    g.globalAlpha = 0.22;
    g.fillStyle = warm;
    for (let i = 0; i < 46; i++) {
      const r = 8 + Math.random() * 24;
      g.beginPath();
      g.arc(Math.random() * 256, Math.random() * 256, r, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
  }
  g.strokeStyle = stripe;
  g.lineCap = 'round';
  if (vertical) {
    // meridian stripes for the head — radiate back from the forehead "M"
    for (let i = 0; i < 16; i++) {
      const x = 4 + i * 16 + Math.random() * 8;
      g.lineWidth = 3.5 + Math.random() * 5;
      g.globalAlpha = 0.42 + Math.random() * 0.24;
      g.beginPath();
      g.moveTo(x, -10);
      g.quadraticCurveTo(x + (Math.random() * 16 - 8), 128, x + (Math.random() * 20 - 10), 270);
      g.stroke();
    }
  } else {
    // mackerel rings around the body
    for (let i = 0; i < 13; i++) {
      const y = 4 + i * 20 + Math.random() * 10;
      g.lineWidth = 4 + Math.random() * 7;
      g.globalAlpha = 0.46 + Math.random() * 0.26;
      g.beginPath();
      g.moveTo(-10, y);
      g.quadraticCurveTo(128, y + (Math.random() * 26 - 13), 270, y + (Math.random() * 34 - 17));
      g.stroke();
      if (Math.random() < 0.6) {
        g.globalAlpha = 0.26;
        g.lineWidth = 3 + Math.random() * 4;
        g.beginPath();
        g.moveTo(40 + Math.random() * 60, y + 10);
        g.lineTo(150 + Math.random() * 80, y + 10 + (Math.random() * 14 - 7));
        g.stroke();
      }
    }
  }
  // fur grain
  g.globalAlpha = 0.11;
  for (let i = 0; i < 650; i++) {
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
  const fur = new THREE.MeshStandardMaterial({ map: furTexture(P.base, P.stripe, P.warm), roughness: 0.92 });
  const headFur = new THREE.MeshStandardMaterial({ map: furTexture(P.base, P.stripe, P.warm, true), roughness: 0.92 });
  const furPlain = new THREE.MeshStandardMaterial({ color: P.base, roughness: 0.92 });
  const belly = new THREE.MeshStandardMaterial({ color: P.belly, roughness: 0.95 });
  const pawMat = new THREE.MeshStandardMaterial({ color: P.paw || P.belly, roughness: 0.95 });
  const tipMat = new THREE.MeshStandardMaterial({ color: P.stripe, roughness: 0.9 });
  const noseMat = new THREE.MeshStandardMaterial({ color: P.nose, roughness: 0.4 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: P.eye, roughness: 0.12, emissive: P.eye, emissiveIntensity: 0.3 });
  const pupilMat = new THREE.MeshStandardMaterial({ color: '#0c0c0e', roughness: 0.15 });
  const shineMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  const innerEar = new THREE.MeshStandardMaterial({ color: '#dfa0a4', roughness: 0.85 });

  const root = new THREE.Group();   // stands at ground level
  const body = new THREE.Group();   // bob / roll / squash
  root.add(body);

  // ---------------- torso: chest + hindquarters + haunches ----------------
  const chestG = new THREE.Mesh(new THREE.CapsuleGeometry(0.185, 0.3, 6, 14), fur);
  chestG.rotation.x = Math.PI / 2;
  chestG.position.set(0, 0.37, 0.1);
  chestG.scale.set(1, 1.02, 1);
  body.add(chestG);

  const hind = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 12), fur);
  hind.position.set(0, 0.36, -0.2);
  hind.scale.set(1, 1.02, 1.25);
  body.add(hind);

  // haunches (thigh domes)
  for (const s of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.115, 10, 9), fur);
    h.position.set(0.13 * s, 0.31, -0.21);
    h.scale.set(0.7, 1.1, 1.15);
    body.add(h);
  }

  // cream chest ruff / bib
  const ruff = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), belly);
  ruff.position.set(0, 0.33, 0.26);
  ruff.scale.set(0.85, 1.0, 0.75);
  body.add(ruff);

  // ---------------- head ----------------
  const neck = new THREE.Group();
  neck.position.set(0, 0.47, 0.28);
  body.add(neck);
  const head = new THREE.Group();
  head.position.set(0, 0.1, 0.13);
  neck.add(head);

  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.15, 18, 15), headFur);
  skull.scale.set(1.06, 0.94, 0.98);
  head.add(skull);

  // cheeks + muzzle + chin
  for (const s of [-1, 1]) {
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.062, 10, 8), belly);
    cheek.position.set(0.052 * s, -0.055, 0.105);
    cheek.scale.set(1.1, 0.85, 0.9);
    head.add(cheek);
  }
  const chin = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 7), belly);
  chin.position.set(0, -0.095, 0.1);
  head.add(chin);
  const bridge = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 7), furPlain);
  bridge.position.set(0, -0.015, 0.125);
  bridge.scale.set(0.85, 0.8, 1);
  head.add(bridge);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.024, 0.026, 4), noseMat);
  nose.rotation.x = Math.PI;
  nose.position.set(0, -0.035, 0.165);
  head.add(nose);

  // ears: tall, mobile, pink inside
  const ears = [];
  for (const s of [-1, 1]) {
    const ear = new THREE.Group();
    ear.position.set(0.082 * s, 0.118, -0.01);
    const outer = new THREE.Mesh(new THREE.ConeGeometry(0.068, 0.14, 5), furPlain);
    outer.position.y = 0.025;
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.095, 5), innerEar);
    inner.position.set(0, 0.02, 0.02);
    ear.add(outer, inner);
    ear.rotation.z = -0.24 * s;
    head.add(ear);
    ears.push(ear);
  }

  // eyes: big, amber, slit pupils, light catch
  const eyes = [];
  for (const s of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(0.062 * s, 0.022, 0.115);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.041, 12, 10), eyeMat);
    ball.scale.set(1, 1.06, 0.75);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.021, 8, 7), pupilMat);
    pupil.scale.set(0.55, 1.05, 0.5);
    pupil.position.z = 0.024;
    const shine = new THREE.Mesh(new THREE.SphereGeometry(0.009, 6, 5), shineMat);
    shine.position.set(-0.012, 0.014, 0.036);
    eye.add(ball, pupil, shine);
    eye.rotation.y = 0.18 * s;
    head.add(eye);
    eyes.push(eye);
  }

  // whiskers
  const whiskerMat = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55 });
  const wPts = [];
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const y = -0.045 - i * 0.016;
      wPts.push(new THREE.Vector3(0.055 * s, y, 0.135), new THREE.Vector3(0.26 * s, y + (i - 1) * 0.035, 0.09));
    }
  }
  head.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(wPts), whiskerMat));

  // ---------------- legs ----------------
  const upperGeo = new THREE.CapsuleGeometry(0.052, 0.17, 4, 8);
  const pawGeo = new THREE.SphereGeometry(0.052, 8, 6);
  const legs = [];
  const legDefs = [
    { x: 0.105, z: 0.245, front: true },
    { x: -0.105, z: 0.245, front: true },
    { x: 0.125, z: -0.21, front: false },
    { x: -0.125, z: -0.21, front: false },
  ];
  for (const d of legDefs) {
    const pivot = new THREE.Group();
    pivot.position.set(d.x, 0.33, d.z);
    const upper = new THREE.Mesh(upperGeo, d.front ? fur : furPlain);
    upper.position.y = -0.13;
    const paw = new THREE.Mesh(pawGeo, pawMat);
    paw.position.y = -0.28;
    paw.scale.set(1, 0.65, 1.25);
    pivot.add(upper, paw);
    body.add(pivot);
    legs.push({ pivot, front: d.front, side: Math.sign(d.x) });
  }

  // ---------------- tail: 7 segments, dark tip ----------------
  const tailSegs = [];
  let parent = body;
  let segPos = new THREE.Vector3(0, 0.42, -0.36);
  for (let i = 0; i < 7; i++) {
    const seg = new THREE.Group();
    seg.position.copy(segPos);
    const r = 0.047 - i * 0.0045;
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, 0.085, 4, 8), i >= 5 ? tipMat : fur);
    m.rotation.x = Math.PI / 2 + 0.3;
    m.position.z = -0.05;
    seg.add(m);
    parent.add(seg);
    parent = seg;
    segPos = new THREE.Vector3(0, 0.012, -0.1);
    tailSegs.push(seg);
  }

  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });

  // ================= animation =================
  let t = 0;
  let blink = 0, nextBlink = 2;
  let prevGrounded = true, squash = 0;
  let groomClock = 0, grooming = 0;
  let earTwitch = 0;

  const S = { mode: 'idle', speed: 0, grounded: true, lean: 0 };

  function update(dt, state) {
    Object.assign(S, state);
    t += dt;
    const run = clamp(S.speed / 6.5, 0, 1);
    const ph = t * (5 + run * 8);

    // blink (with occasional slow, content blink)
    nextBlink -= dt;
    if (nextBlink <= 0) { blink = Math.random() < 0.25 ? 0.35 : 0.12; nextBlink = 1.5 + Math.random() * 4.5; }
    blink = Math.max(0, blink - dt);
    for (const e of eyes) e.scale.y = blink > 0 ? 0.12 : 1;

    // landing squash
    if (S.grounded && !prevGrounded) squash = 0.14;
    prevGrounded = S.grounded;
    squash = Math.max(0, squash - dt);
    const sq = squash > 0 ? 1 - Math.sin((squash / 0.14) * Math.PI) * 0.18 : 1;
    body.scale.y = damp(body.scale.y, sq, 20, dt);
    body.scale.x = damp(body.scale.x, 2 - sq > 1 ? 1 + (1 - sq) * 0.6 : 1, 20, dt);

    if (S.mode === 'death') {
      root.rotation.z = damp(root.rotation.z, Math.PI / 2 * 0.96, 8, dt);
      body.position.y = damp(body.position.y, -0.12, 8, dt);
      for (const l of legs) l.pivot.rotation.x = damp(l.pivot.rotation.x, 0.5, 6, dt);
      neck.rotation.x = damp(neck.rotation.x, 0.4, 6, dt);
      for (const e of eyes) e.scale.y = 0.08;
      for (const seg of tailSegs) {
        seg.rotation.x = damp(seg.rotation.x, 0.08, 4, dt);
        seg.rotation.y = damp(seg.rotation.y, 0, 4, dt);
      }
      return;
    }
    root.rotation.z = damp(root.rotation.z, 0, 12, dt);

    let bodyY = 0, bodyPitch = 0, bodyRoll = clamp(S.lean || 0, -0.35, 0.35);
    let neckPitch = 0, headYaw = null, headPitch = 0;
    let earFlat = 0;
    const legT = [0, 0, 0, 0];
    let tailLift = 0.35, tailSway = 0.28, tailFreq = 1.6, tailCurl = 0.12;

    switch (S.mode) {
      case 'sit': {
        bodyY = -0.085;
        bodyPitch = -0.5;
        neckPitch = 0.48;
        legT[0] = legT[1] = 0.42;
        legT[2] = legT[3] = -1.55;
        // tail wraps around the front
        tailLift = -0.35; tailSway = 0.12; tailFreq = 0.8; tailCurl = 0.5;
        headYaw = Math.sin(t * 0.3) * 0.3;
        break;
      }
      case 'idle': {
        bodyY = Math.sin(t * 2.1) * 0.008;
        chestG.scale.x = 1 + Math.sin(t * 2.1) * 0.015;
        neckPitch = Math.sin(t * 0.5) * 0.05;
        headYaw = Math.sin(t * 0.33) * 0.35;
        // grooming: after a few idle seconds, wash the face with a paw
        groomClock += dt;
        if (grooming <= 0 && groomClock > 5.5) { grooming = 2.6; groomClock = 0; }
        if (grooming > 0) {
          grooming -= dt;
          const gph = Math.sin(t * 9);
          legT[0] = -1.5 + gph * 0.35;      // left front paw up, circular wipe
          neckPitch = 0.55;
          headYaw = 0.25 + gph * 0.12;
          headPitch = 0.15;
        }
        // radar ears
        earTwitch -= dt;
        if (earTwitch <= 0) { earTwitch = 1.2 + Math.random() * 3; }
        ears[0].rotation.y = damp(ears[0].rotation.y, earTwitch < 0.25 ? 0.5 : 0, 8, dt);
        ears[1].rotation.y = damp(ears[1].rotation.y, earTwitch < 0.12 ? -0.4 : 0, 8, dt);
        tailSway = 0.45; tailFreq = 1.25;
        break;
      }
      case 'walk':
      case 'run': {
        groomClock = 0; grooming = 0;
        const amp = 0.5 + run * 0.55;
        legT[0] = Math.sin(ph) * amp;
        legT[3] = Math.sin(ph) * amp;
        legT[1] = Math.sin(ph + Math.PI) * amp;
        legT[2] = Math.sin(ph + Math.PI) * amp;
        bodyY = Math.abs(Math.sin(ph)) * (0.018 + run * 0.055);
        bodyPitch = Math.sin(ph * 2) * 0.035 * run;
        bodyRoll += Math.sin(ph) * 0.045 * run;
        neckPitch = -0.05 * run + Math.sin(ph * 2) * 0.03 * run; // head counter-bob
        headYaw = 0;
        earFlat = run * 0.55;
        tailLift = 0.45 + run * 0.35; tailFreq = 2 + run * 3.2; tailSway = 0.2; tailCurl = 0.05;
        break;
      }
      case 'jump': {
        legT[0] = legT[1] = -1.0;
        legT[2] = legT[3] = 1.15;
        bodyPitch = 0.3;
        neckPitch = -0.2;
        tailLift = 0.05; tailCurl = 0;
        earFlat = 0.3;
        break;
      }
      case 'fall': {
        legT[0] = legT[1] = -0.55;
        legT[2] = legT[3] = 0.45;
        bodyPitch = -0.22;
        neckPitch = 0.28;
        tailLift = 0.75; tailFreq = 6.5; tailSway = 0.55;
        break;
      }
      case 'climb': {
        const cph = t * 7.5;
        legT[0] = -1.45 + Math.sin(cph) * 0.5;
        legT[1] = -1.45 + Math.sin(cph + Math.PI) * 0.5;
        legT[2] = -0.65 + Math.sin(cph + Math.PI) * 0.4;
        legT[3] = -0.65 + Math.sin(cph) * 0.4;
        bodyPitch = -1.18;
        neckPitch = 1.05;
        tailLift = -0.35; tailCurl = 0.3;
        break;
      }
      case 'pounce': {
        legT[0] = legT[1] = -1.25;
        legT[2] = legT[3] = 1.25;
        bodyPitch = 0.4;
        earFlat = 0.6;
        break;
      }
      case 'swim': {
        const sph = t * 6;
        legT[0] = Math.sin(sph) * 0.75;
        legT[1] = Math.sin(sph + Math.PI) * 0.75;
        legT[2] = Math.sin(sph + 1) * 0.75;
        legT[3] = Math.sin(sph + Math.PI + 1) * 0.75;
        bodyPitch = -0.28;
        neckPitch = 0.55;
        bodyY = Math.sin(t * 4) * 0.02;
        earFlat = 0.5;
        break;
      }
    }

    body.position.y = damp(body.position.y, bodyY, 10, dt);
    body.rotation.x = damp(body.rotation.x, bodyPitch, 10, dt);
    body.rotation.z = damp(body.rotation.z, bodyRoll, 8, dt);
    neck.rotation.x = damp(neck.rotation.x, neckPitch, 8, dt);
    head.rotation.x = damp(head.rotation.x, headPitch, 8, dt);
    if (headYaw !== null) head.rotation.y = damp(head.rotation.y, headYaw, 3, dt);
    for (const ear of ears) ear.rotation.x = damp(ear.rotation.x, -earFlat * 0.6, 9, dt);
    for (let i = 0; i < 4; i++) legs[i].pivot.rotation.x = damp(legs[i].pivot.rotation.x, legT[i], 14, dt);

    for (let i = 0; i < tailSegs.length; i++) {
      const seg = tailSegs[i];
      const base = i === 0 ? -tailLift : -tailLift * 0.22 + tailCurl * (i / tailSegs.length);
      seg.rotation.x = damp(seg.rotation.x, base, 6, dt);
      seg.rotation.y = damp(seg.rotation.y,
        Math.sin(t * tailFreq * Math.PI + i * 0.75) * tailSway * (0.25 + i * 0.16), 8, dt);
    }
  }

  return { group: root, update, head, palette: P };
}
