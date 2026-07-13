// Percy v3: procedural cat with real feline proportions and a modern
// code-driven animation rig — two-bone IK legs, real gait patterns
// (lateral-sequence walk → trot → rotary gallop), spine flex, head
// stabilization and a spring-lagged tail. No external assets.
import * as THREE from 'three';
import { clamp, lerp, damp, smoothstep, TAU } from './util.js';

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

// Gait phase offsets per leg [FR, FL, HR, HL] (fraction of a stride cycle).
const OFF_WALK = [0.75, 0.25, 0.5, 0.0];   // 4-beat lateral sequence walk
const OFF_TROT = [0.0, 0.5, 0.5, 0.0];     // diagonal pairs
const OFF_GALLOP = [0.5, 0.62, 0.12, 0.0]; // rotary gallop
const DUTY_WALK = 0.62, DUTY_TROT = 0.5, DUTY_GALLOP = 0.33;

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

  // Two spine groups so the back can flex during the gallop:
  const chest = new THREE.Group();  // front half (shoulders, neck, front legs)
  chest.position.set(0, 0.37, 0.12);
  const rear = new THREE.Group();   // hindquarters (pelvis, hind legs, tail)
  rear.position.set(0, 0.36, -0.2);
  body.add(chest, rear);

  // ---------------- torso ----------------
  const chestG = new THREE.Mesh(new THREE.CapsuleGeometry(0.185, 0.3, 6, 14), fur);
  chestG.rotation.x = Math.PI / 2;
  chestG.position.set(0, 0, -0.02);
  chestG.scale.set(1, 1.02, 1);
  chest.add(chestG);

  const hind = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 12), fur);
  hind.scale.set(1, 1.02, 1.25);
  rear.add(hind);

  // haunches (thigh domes)
  for (const s of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.115, 10, 9), fur);
    h.position.set(0.13 * s, -0.05, -0.01);
    h.scale.set(0.7, 1.1, 1.15);
    rear.add(h);
  }

  // cream chest ruff / bib
  const ruff = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), belly);
  ruff.position.set(0, -0.04, 0.14);
  ruff.scale.set(0.85, 1.0, 0.75);
  chest.add(ruff);

  // ---------------- head ----------------
  const neck = new THREE.Group();
  neck.position.set(0, 0.1, 0.16);
  chest.add(neck);
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

  // ---------------- legs: two bones + IK ----------------
  const L1 = 0.17, L2 = 0.16;               // upper / lower bone lengths
  const upperGeo = new THREE.CapsuleGeometry(0.05, 0.1, 4, 8);
  const lowerGeo = new THREE.CapsuleGeometry(0.037, 0.1, 4, 8);
  const pawGeo = new THREE.SphereGeometry(0.05, 8, 6);
  const legs = [];
  // order: FR, FL, HR, HL  (front legs on the chest group, hind on the rear)
  const legDefs = [
    { x: 0.105, front: true }, { x: -0.105, front: true },
    { x: 0.125, front: false }, { x: -0.125, front: false },
  ];
  for (const d of legDefs) {
    const pivot = new THREE.Group();          // hip / shoulder
    if (d.front) { pivot.position.set(d.x, -0.04, 0.125); chest.add(pivot); }
    else { pivot.position.set(d.x, -0.03, -0.01); rear.add(pivot); }
    const upper = new THREE.Mesh(upperGeo, d.front ? fur : furPlain);
    upper.position.y = -L1 / 2;
    pivot.add(upper);
    const knee = new THREE.Group();           // elbow (front) / stifle (hind)
    knee.position.y = -L1;
    pivot.add(knee);
    const lower = new THREE.Mesh(lowerGeo, d.front ? fur : furPlain);
    lower.position.y = -L2 / 2;
    knee.add(lower);
    const paw = new THREE.Mesh(pawGeo, pawMat);
    paw.position.set(0, -L2 + 0.015, 0.02);
    paw.scale.set(1, 0.6, 1.3);
    knee.add(paw);
    legs.push({
      pivot, knee, front: d.front, side: Math.sign(d.x),
      // current (damped) foot target, relative to the hip pivot
      tz: d.front ? 0.02 : -0.02, ty: d.front ? -0.31 : -0.3,
    });
  }

  // Two-bone IK: place the foot at (tz, ty) relative to the hip.
  // Front legs bend elbow-back, hind legs bend knee-forward.
  function solveLeg(leg) {
    const s = leg.front ? 1 : -1;
    let d = Math.hypot(leg.tz, leg.ty);
    d = clamp(d, 0.09, L1 + L2 - 0.004);
    const baseA = Math.atan2(leg.tz, -leg.ty);
    const cosH = clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1);
    const cosK = clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1);
    leg.pivot.rotation.x = -baseA + s * Math.acos(cosH);
    leg.knee.rotation.x = -s * (Math.PI - Math.acos(cosK));
  }

  // ---------------- tail: 7 segments, dark tip, spring-lagged ----------------
  const tailSegs = [];
  let parent = rear;
  let segPos = new THREE.Vector3(0, 0.06, -0.16);
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
  // spring state: pitch/yaw + angular velocity per segment
  const tp = new Float32Array(7), tvP = new Float32Array(7);
  const ty = new Float32Array(7), tvY = new Float32Array(7);
  for (let i = 0; i < 7; i++) tp[i] = -0.35;

  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });

  // ================= animation =================
  let t = 0;
  let blink = 0, nextBlink = 2;
  let prevGrounded = true, squash = 0;
  let groomClock = 0, grooming = 0, stretchT = 0, sinceStretch = 0;
  let earTwitch = 0, flickT = 0;
  let gaitT = 0;
  const off = OFF_WALK.slice();   // damped per-leg phase offsets
  let duty = DUTY_WALK;

  const S = { mode: 'idle', speed: 0, grounded: true, lean: 0 };

  function update(dt, state) {
    Object.assign(S, state);
    t += dt;
    const speed = S.speed || 0;

    // blink (with occasional slow, content blink)
    nextBlink -= dt;
    if (nextBlink <= 0) { blink = Math.random() < 0.25 ? 0.35 : 0.12; nextBlink = 1.5 + Math.random() * 4.5; }
    blink = Math.max(0, blink - dt);
    for (const e of eyes) e.scale.y = blink > 0 ? 0.12 : 1;

    // landing squash & recovery
    if (S.grounded && !prevGrounded) squash = 0.16;
    prevGrounded = S.grounded;
    squash = Math.max(0, squash - dt);
    const sq = squash > 0 ? 1 - Math.sin((squash / 0.16) * Math.PI) * 0.16 : 1;
    body.scale.y = damp(body.scale.y, sq, 20, dt);
    body.scale.x = damp(body.scale.x, 1 + (1 - sq) * 0.55, 20, dt);

    // tail helper — runs the spring chain toward a driven base pose
    function tailDynamics(basePitch, baseYaw, curl) {
      for (let i = 0; i < 7; i++) {
        const targP = (i === 0 ? basePitch : tp[i - 1] * 0.9) + curl * (i / 7);
        const targY = i === 0 ? baseYaw : ty[i - 1];
        const k = 85 - i * 7, c = 9.5;
        tvP[i] += (k * (targP - tp[i]) - c * tvP[i]) * dt;
        tvY[i] += ((k * 0.8) * (targY - ty[i]) - c * tvY[i]) * dt;
        tvP[i] = clamp(tvP[i], -22, 22);
        tvY[i] = clamp(tvY[i], -22, 22);
        tp[i] += tvP[i] * dt;
        ty[i] += tvY[i] * dt;
        tailSegs[i].rotation.x = tp[i];
        tailSegs[i].rotation.y = ty[i];
      }
    }

    if (S.mode === 'death') {
      root.rotation.z = damp(root.rotation.z, Math.PI / 2 * 0.96, 8, dt);
      body.position.y = damp(body.position.y, -0.12, 8, dt);
      for (const l of legs) {
        l.tz = damp(l.tz, l.front ? 0.1 : -0.12, 6, dt);
        l.ty = damp(l.ty, -0.16, 6, dt);
        solveLeg(l);
      }
      neck.rotation.x = damp(neck.rotation.x, 0.4, 6, dt);
      for (const e of eyes) e.scale.y = 0.08;
      tailDynamics(0.06, 0, 0);
      return;
    }
    root.rotation.z = damp(root.rotation.z, 0, 12, dt);

    let bodyY = 0, bodyPitch = 0, bodyRoll = clamp(S.lean || 0, -0.35, 0.35);
    let chestFlex = 0, rearFlex = 0;
    let neckPitch = 0, headYaw = null, headPitch = 0;
    let earFlat = 0;
    let tailLift = 0.35, tailSway = 0.28, tailFreq = 1.6, tailCurl = 0.12;
    // per-leg foot targets (relative to hips)
    const T = [
      { tz: 0.02, ty: -0.31 }, { tz: 0.02, ty: -0.31 },
      { tz: -0.02, ty: -0.3 }, { tz: -0.02, ty: -0.3 },
    ];

    const locomoting = S.mode === 'walk' || S.mode === 'run';
    if (S.mode !== 'idle') { groomClock = 0; grooming = 0; stretchT = 0; }

    switch (S.mode) {
      case 'sit': {
        bodyY = -0.1;
        bodyPitch = -0.55;
        neckPitch = 0.5;
        // front legs planted straight, hind legs folded under the haunches
        T[0].tz = T[1].tz = 0.1; T[0].ty = T[1].ty = -0.32;
        T[2].tz = T[3].tz = 0.08; T[2].ty = T[3].ty = -0.12;
        // tail wraps around the front, tip flicks now and then
        tailLift = -0.4; tailSway = 0; tailCurl = 0.55;
        flickT -= dt;
        if (flickT <= 0) { flickT = 2 + Math.random() * 4; tvY[4] += 9; tvY[5] += 12; }
        headYaw = Math.sin(t * 0.3) * 0.3;
        break;
      }
      case 'idle': {
        bodyY = Math.sin(t * 2.1) * 0.008;
        chestG.scale.x = 1 + Math.sin(t * 2.1) * 0.015;      // breathing
        bodyRoll += Math.sin(t * 0.42) * 0.025;              // slow weight shift
        neckPitch = Math.sin(t * 0.5) * 0.05;
        headYaw = Math.sin(t * 0.33) * 0.35;
        // weight shift moves the standing feet a touch
        const shift = Math.sin(t * 0.42) * 0.008;
        T[0].tz += shift; T[1].tz -= shift;

        groomClock += dt;
        sinceStretch += dt;
        // big cat stretch after a while idle: butt up, chest down, front paws forward
        if (stretchT <= 0 && sinceStretch > 9 && grooming <= 0) { stretchT = 2.4; sinceStretch = 0; }
        if (stretchT > 0) {
          stretchT -= dt;
          const e = Math.sin(clamp(1 - stretchT / 2.4, 0, 1) * Math.PI);  // ease in-out
          bodyPitch = 0.34 * e;
          bodyY = -0.045 * e;
          T[0].tz = T[1].tz = 0.02 + 0.17 * e;
          T[0].ty = T[1].ty = -0.31 + 0.035 * e;
          T[2].ty = T[3].ty = -0.3 - 0.02 * e;
          neckPitch = -0.3 * e;
          headYaw = 0;
          tailLift = 0.35 + 0.55 * e;
        } else if (grooming <= 0 && groomClock > 5.5) { grooming = 2.6; groomClock = 0; }
        if (grooming > 0) {
          grooming -= dt;
          const gph = Math.sin(t * 9);
          // right front paw up doing circular wipes, head tucked to meet it
          T[0].tz = 0.16 + gph * 0.025;
          T[0].ty = -0.1 + gph * 0.02;
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
        // --- gait engine ---
        const trotW = smoothstep(2.0, 3.4, speed);
        const gallopW = smoothstep(4.4, 5.7, speed);
        // blend phase offsets + duty factor between gaits
        for (let i = 0; i < 4; i++) {
          let o = lerp(OFF_WALK[i], OFF_TROT[i], trotW);
          o = lerp(o, OFF_GALLOP[i], gallopW);
          off[i] = damp(off[i], o, 5, dt);
        }
        duty = damp(duty, lerp(lerp(DUTY_WALK, DUTY_TROT, trotW), DUTY_GALLOP, gallopW), 5, dt);
        // stride clock — cadence rises with speed, stride length too
        const freq = clamp(speed / (0.55 + speed * 0.1), 1.4, 5.4);
        gaitT += dt * freq;

        const amp = 0.085 + trotW * 0.02 + gallopW * 0.1;    // half-stride reach
        const lift = 0.05 + gallopW * 0.085;                 // swing foot lift
        for (let i = 0; i < 4; i++) {
          const leg = legs[i];
          const p = (gaitT + off[i]) % 1;
          const lead = leg.front ? 0.03 : -0.04;
          let fz, fy;
          if (p < duty) {           // stance: foot drags back under the body
            const s = p / duty;
            fz = lerp(amp, -amp, s); fy = 0;
          } else {                  // swing: arc forward with lift
            const s = (p - duty) / (1 - duty);
            const e = s * s * (3 - 2 * s);
            fz = lerp(-amp, amp, e); fy = Math.sin(s * Math.PI) * lift;
          }
          T[i].tz = fz + lead;
          T[i].ty = (leg.front ? -0.31 : -0.3) + fy;
        }

        // body dynamics per gait
        const cyc = gaitT * TAU;
        bodyY = Math.sin(cyc * 2) * 0.012 * (1 - gallopW)          // walk/trot 2-beat bob
          + (Math.sin(cyc) * 0.038 + 0.02) * gallopW;              // gallop bound
        bodyPitch = Math.sin(cyc + 0.4) * 0.07 * gallopW;
        bodyRoll += Math.sin(cyc * 0.5 + 1) * 0.035 * (1 - trotW); // lazy walk sway
        // spine flexion/extension — the signature gallop whip
        chestFlex = Math.sin(cyc) * (0.03 + 0.17 * gallopW);
        rearFlex = Math.sin(cyc + Math.PI * 0.65) * (0.025 + 0.2 * gallopW);
        // cats keep their head level: counter the chest motion
        neckPitch = -chestFlex * 0.8 - 0.06 * gallopW;
        headYaw = 0;
        earFlat = gallopW * 0.55;
        tailLift = 0.4 + gallopW * 0.3;
        tailSway = 0.14; tailFreq = 1 + freq * 0.5; tailCurl = 0.05;
        break;
      }
      case 'jump': {
        // full launch extension: hind legs driving back, front tucked
        T[0].tz = T[1].tz = 0.06; T[0].ty = T[1].ty = -0.15;
        T[2].tz = T[3].tz = -0.17; T[2].ty = T[3].ty = -0.3;
        bodyPitch = 0.32;
        chestFlex = -0.12; rearFlex = 0.1;                   // spine extended
        neckPitch = -0.28;
        tailLift = 0.05; tailCurl = 0;
        earFlat = 0.3;
        break;
      }
      case 'fall': {
        // gather for landing: all four reaching down-forward
        T[0].tz = T[1].tz = 0.13; T[0].ty = T[1].ty = -0.26;
        T[2].tz = T[3].tz = 0.02; T[2].ty = T[3].ty = -0.22;
        bodyPitch = -0.18;
        chestFlex = 0.1; rearFlex = -0.08;                   // spine arched
        neckPitch = 0.32;
        tailLift = 0.7; tailSway = 0.5; tailFreq = 5.5;      // balancing tail
        break;
      }
      case 'climb': {
        // alternating diagonal reaches up the wall (body is pitched onto it)
        const cph = t * 7.5;
        for (let i = 0; i < 4; i++) {
          const ph = cph + (i === 0 || i === 3 ? 0 : Math.PI);
          const reach = Math.sin(ph);
          const leg = legs[i];
          T[i].tz = (leg.front ? 0.1 : 0.0) + reach * 0.09;
          T[i].ty = -0.2 - Math.max(0, -reach) * 0.06 + Math.max(0, reach) * 0.03;
        }
        bodyPitch = -1.18;
        neckPitch = 1.05;
        tailLift = -0.3; tailCurl = 0.3; tailSway = 0.18; tailFreq = 2.4;
        break;
      }
      case 'pounce': {
        // reaching strike — front paws out, claws first
        T[0].tz = T[1].tz = 0.2; T[0].ty = T[1].ty = -0.17;
        T[2].tz = T[3].tz = -0.16; T[2].ty = T[3].ty = -0.28;
        bodyPitch = 0.42;
        chestFlex = -0.1;
        neckPitch = -0.2;
        earFlat = 0.6;
        tailLift = 0.15;
        break;
      }
      case 'swim': {
        // doggy-paddle: diagonal pairs churning small circles
        const sph = t * 6.5;
        for (let i = 0; i < 4; i++) {
          const ph = sph + (i === 0 || i === 3 ? 0 : Math.PI) + (legs[i].front ? 0 : 1.2);
          T[i].tz = Math.cos(ph) * 0.09 + (legs[i].front ? 0.05 : -0.03);
          T[i].ty = -0.19 + Math.sin(ph) * 0.06;
        }
        bodyPitch = -0.26;
        neckPitch = 0.6;
        bodyY = Math.sin(t * 4) * 0.02;
        earFlat = 0.5;
        tailLift = 0.05; tailSway = 0.3; tailFreq = 2.2;     // tail streams behind
        break;
      }
    }

    // apply body + spine
    body.position.y = damp(body.position.y, bodyY, locomoting ? 16 : 10, dt);
    body.rotation.x = damp(body.rotation.x, bodyPitch, 10, dt);
    body.rotation.z = damp(body.rotation.z, bodyRoll, 8, dt);
    chest.rotation.x = damp(chest.rotation.x, chestFlex, 14, dt);
    rear.rotation.x = damp(rear.rotation.x, rearFlex, 14, dt);
    neck.rotation.x = damp(neck.rotation.x, neckPitch, 8, dt);
    head.rotation.x = damp(head.rotation.x, headPitch, 8, dt);
    if (headYaw !== null) head.rotation.y = damp(head.rotation.y, headYaw, 3, dt);
    for (const ear of ears) ear.rotation.x = damp(ear.rotation.x, -earFlat * 0.6, 9, dt);

    // apply legs: damp foot targets, then IK
    const legLambda = locomoting ? 30 : 14;
    for (let i = 0; i < 4; i++) {
      const leg = legs[i];
      leg.tz = damp(leg.tz, T[i].tz, legLambda, dt);
      leg.ty = damp(leg.ty, T[i].ty, legLambda, dt);
      solveLeg(leg);
    }

    // tail: driven base + spring-lag chain (whip follows through naturally)
    const baseYaw = Math.sin(t * tailFreq * Math.PI) * tailSway + clamp(S.lean || 0, -0.4, 0.4) * 1.4;
    tailDynamics(-tailLift, baseYaw, tailCurl);
  }

  return { group: root, update, head, palette: P };
}
