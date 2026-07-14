// World builder: terrain, the row house, gardens, street, fields, stream,
// barn, forest and the lake — plus all colliders, hazards and pickups.
import * as THREE from 'three';
import { clamp, lerp, smoothstep, rand, randInt, pick, TAU } from './util.js';
import * as TX from './textures.js';

// ---------------------------------------------------------------- terrain --
export function groundHeight(x, z) {
  let h = 0;
  // Rolling fields between the street and the forest
  const fieldMask =
    smoothstep(103, 122, z) * (1 - smoothstep(238, 258, z)) *
    (1 - Math.exp(-((z - 150) * (z - 150)) / 90)); // flatten near the stream
  h += fieldMask * (Math.sin(x * 0.16) * Math.cos(z * 0.09) * 0.7 + Math.sin(z * 0.055 + x * 0.035) * 0.45 + 0.55);
  // Stream cut
  const sd = z - 150;
  h -= 1.35 * Math.exp(-(sd * sd) / 4.2);
  // Lake bowl
  const ld = Math.hypot(x, z - 295);
  h -= 5.0 * (1 - smoothstep(9, 29, ld));
  // Duck pond east of the fields
  const pd = Math.hypot(x - 34, z - 178);
  h -= 2.3 * (1 - smoothstep(4, 7.8, pd));
  return h;
}

export const STREAM_WATER_Y = -0.62;
export const LAKE_WATER_Y = -0.85;
export const POND_WATER_Y = -0.55;

export function waterLevelAt(x, z) {
  if (Math.abs(z - 150) < 3.4 && groundHeight(x, z) < STREAM_WATER_Y - 0.1) return STREAM_WATER_Y;
  if (Math.hypot(x, z - 295) < 26.5 && groundHeight(x, z) < LAKE_WATER_Y - 0.1) return LAKE_WATER_Y;
  if (Math.hypot(x - 34, z - 178) < 8 && groundHeight(x, z) < POND_WATER_Y - 0.1) return POND_WATER_Y;
  return null;
}

// ------------------------------------------------------------- primitives --
const M = {}; // shared materials
function mats() {
  if (M.done) return M;
  const std = (color, rough = 0.9, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, ...extra });
  // painted material: procedural texture as color + bump for surface relief
  const tex = (map, rough = 0.9, bump = 0.02, extra = {}) => {
    const t = typeof map === 'function' ? map() : map;
    return new THREE.MeshStandardMaterial({ map: t, bumpMap: t, bumpScale: bump, roughness: rough, ...extra });
  };
  const rep = (mat, x, y) => { mat.map.repeat.set(x, y); return mat; };

  M.brick = rep(tex(TX.brick('#c96f4a', '#b45f3d')), 3, 2);
  M.brick2 = rep(tex(TX.brick('#b3593a', '#9c4c32')), 3, 2);
  M.brick3 = rep(tex(TX.brick('#d8a06a', '#c48c55')), 3, 2);
  M.plaster = rep(tex(TX.stucco, 0.95, 0.012), 2, 2);
  M.roof = rep(tex(TX.shingles('#7a4a3a', '#5c352a'), 0.9, 0.03), 3, 3);
  M.roof2 = rep(tex(TX.shingles('#5d6570', '#454c58'), 0.9, 0.03), 3, 3);
  M.wood = rep(tex(TX.planks('#8a6242')), 1.5, 1.5);
  M.woodDark = rep(tex(TX.planks('#5f4630')), 1.5, 1.5);
  M.woodLight = rep(tex(TX.planks('#c9a36e')), 1.5, 1.5);
  M.fence = rep(tex(TX.planks('#9a7b52')), 4, 1);
  M.hedge = std('#3f7d3a');
  M.hedgeDark = std('#356b31');
  M.leaf = std('#4f9143');
  M.leafDark = std('#3c7a38');
  M.pine = std('#2f6b3c');
  M.trunk = rep(tex(TX.bark, 0.95, 0.03), 1.5, 1.5);
  M.stone = rep(tex(TX.stone, 0.95, 0.025), 1.5, 1.5);
  M.road = rep(tex(TX.asphalt, 0.96, 0.02), 26, 2);
  M.sidewalk = rep(tex(TX.pavement, 0.95, 0.025), 30, 1);
  M.line = std('#e8e4d8', 0.8);
  M.metal = std('#7d8590', 0.4, { metalness: 0.6 });
  M.white = std('#f5f2ea');
  M.hay = rep(tex(TX.straw('#d9b45c', 'rgba(140,100,40,0.6)'), 0.95, 0.02), 2, 2);
  M.hayDark = rep(tex(TX.straw('#c29c44', 'rgba(120,84,30,0.6)'), 0.95, 0.02), 2, 2);
  M.glass = new THREE.MeshStandardMaterial({ color: '#a8d4e8', roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.5 });
  M.done = true;
  return M;
}

// Shared time uniform driving all wind / water shaders.
const WIND_T = { value: 0 };

// Inject vertex wind sway into a standard material (works with instancing).
// Blades bend from the root up, with a slow gust cycle rolling across the map.
function windify(mat, strength = 1, freq = 1) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWindT = WIND_T;
    shader.vertexShader = 'uniform float uWindT;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      {
        #ifdef USE_INSTANCING
          vec3 wroot = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        #else
          vec3 wroot = vec3(0.0);
        #endif
        float wphase = wroot.x * 0.35 + wroot.z * 0.28;
        float wamt = smoothstep(0.03, 0.6, position.y) * ${strength.toFixed(3)};
        float gust = 0.55 + 0.45 * sin(uWindT * 0.37 + wroot.x * 0.02 + wroot.z * 0.015);
        transformed.x += (sin(uWindT * ${(1.8 * freq).toFixed(2)} + wphase) * 0.1
                        + sin(uWindT * ${(3.1 * freq).toFixed(2)} + wphase * 1.7) * 0.035) * wamt * gust;
        transformed.z += cos(uWindT * ${(1.4 * freq).toFixed(2)} + wphase * 1.3) * 0.06 * wamt * gust;
      }`
    );
  };
  // the injected GLSL differs per strength/freq — keep shader programs distinct
  mat.customProgramCacheKey = () => `wind:${strength}:${freq}`;
  return mat;
}

// Water material with layered vertex waves + a moving brightness shimmer.
function makeWaterMat(color, opacity) {
  const m = new THREE.MeshStandardMaterial({
    color, transparent: true, opacity, roughness: 0.12, metalness: 0.08,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uWindT = WIND_T;
    shader.vertexShader = 'uniform float uWindT;\nvarying float vWave;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      {
        vec2 wp = position.xy;
        float w = sin(uWindT * 1.35 + wp.x * 0.55 + wp.y * 0.7)
                + sin(uWindT * 2.1 - wp.x * 0.9 + wp.y * 0.45) * 0.6
                + sin(uWindT * 0.8 + (wp.x + wp.y) * 0.22) * 0.9;
        vWave = w / 2.5;
        transformed.z += w * 0.038;
      }`
    );
    shader.fragmentShader = 'varying float vWave;\n' + shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      diffuseColor.rgb += vWave * vec3(0.05, 0.08, 0.095);`
    );
  };
  m.customProgramCacheKey = () => 'water';
  return m;
}

export function buildWorld(scene) {
  mats();
  const colliders = [];
  const pickups = [];
  const statics = new THREE.Group();
  scene.add(statics);

  // helper: visual box + optional collider
  function box(cx, cy, cz, w, h, d, mat, opts = {}) {
    if (!opts.noMesh) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(cx, cy, cz);
      if (opts.rotY) m.rotation.y = opts.rotY;
      m.castShadow = opts.shadow !== false;
      m.receiveShadow = true;
      statics.add(m);
      opts.mesh = m;
    }
    if (!opts.noCollide) {
      colliders.push({
        minX: cx - w / 2, maxX: cx + w / 2,
        minY: cy - h / 2, maxY: cy + h / 2,
        minZ: cz - d / 2, maxZ: cz + d / 2,
        climb: !!opts.climb, name: opts.name || '',
      });
    }
    return opts.mesh;
  }
  function cylinderCollider(x, z, r, y0, y1, climb = false) {
    // approximated as a small AABB — good enough for trunks/posts
    colliders.push({ minX: x - r, maxX: x + r, minY: y0, maxY: y1, minZ: z - r, maxZ: z + r, climb, cyl: true });
  }

  // ------------------------------------------------------------ terrain mesh
  {
    const W = 230, D = 440, SX = 200, SZ = 400;
    const geo = new THREE.PlaneGeometry(W, D, SX, SZ);
    geo.rotateX(-Math.PI / 2);
    const posA = geo.attributes.position;
    const colors = new Float32Array(posA.count * 3);
    const c = new THREE.Color();
    const lawn = new THREE.Color('#63b04a');
    const lawn2 = new THREE.Color('#7bbf55');
    const meadow = new THREE.Color('#96b84f');
    const meadow2 = new THREE.Color('#c2c258');
    const forest = new THREE.Color('#4c8f42');
    const forest2 = new THREE.Color('#3d7a38');
    const sand = new THREE.Color('#e2ce96');
    const dirt = new THREE.Color('#a8865a');
    const mud = new THREE.Color('#6f5b3e');
    for (let i = 0; i < posA.count; i++) {
      const x = posA.getX(i);
      let z = posA.getZ(i) + 180; // shift: plane covers z -40..400
      posA.setZ(i, z);
      const h = groundHeight(x, z);
      posA.setY(i, h);
      // base color by zone (soft blends between zones)
      if (z < 100) c.copy(lawn).lerp(lawn2, Math.abs(Math.sin(x * 0.35 + z * 0.3)) * 0.6);
      else if (z < 218) c.copy(meadow).lerp(meadow2, Math.abs(Math.sin(x * 0.18 + z * 0.11)) * 0.8);
      else if (z < 262) c.copy(forest).lerp(forest2, Math.abs(Math.sin(x * 0.5 + z * 0.4)) * 0.7);
      else c.copy(meadow).lerp(lawn2, 0.4);
      // golden height tint on the rolling hills
      if (h > 0.5) c.lerp(meadow2, smoothstep(0.5, 1.6, h) * 0.5);
      // beach + underwater
      const ld = Math.hypot(x, z - 295);
      if (ld < 30) c.lerp(sand, smoothstep(30, 24, ld));
      if (h < LAKE_WATER_Y + 0.1 && ld < 30) c.copy(mud);
      // stream banks
      const sd = Math.abs(z - 150);
      if (sd < 4.5) c.lerp(mud, smoothstep(4.5, 1.5, sd));
      // pond banks
      const pdd = Math.hypot(x - 34, z - 178);
      if (pdd < 9.5) c.lerp(mud, smoothstep(9.5, 5.5, pdd));
      // dirt path along the route through the fields
      if (z > 100 && z < 270) {
        const px = Math.sin(z * 0.06) * 2.2;
        c.lerp(dirt, smoothstep(2.4, 0.9, Math.abs(x - px)) * 0.85);
      }
      // subtle noise
      const n = (Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
      c.offsetHSL(0, 0, (n - 0.5) * 0.045);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    // grass detail texture multiplies over the vertex colors — kills the flat look
    const detail = TX.grassDetail();
    detail.repeat.set(110, 200);
    const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.95, map: detail, bumpMap: detail, bumpScale: 0.06,
    }));
    ground.receiveShadow = true;
    statics.add(ground);
  }

  // --------------------------------------------------------------- water
  {
    // dense geometry so the wave shader has vertices to move
    const lake = new THREE.Mesh(new THREE.RingGeometry(0.02, 26.5, 64, 22), makeWaterMat('#4098c8', 0.78));
    lake.rotation.x = -Math.PI / 2;
    lake.position.set(0, LAKE_WATER_Y, 295);
    statics.add(lake);
    const stream = new THREE.Mesh(new THREE.PlaneGeometry(160, 6.6, 110, 10), makeWaterMat('#4098c8', 0.7));
    stream.rotation.x = -Math.PI / 2;
    stream.position.set(0, STREAM_WATER_Y, 150);
    statics.add(stream);
    // duck pond in the eastern fields
    const pond = new THREE.Mesh(new THREE.RingGeometry(0.02, 8, 36, 8), makeWaterMat('#4aa2c4', 0.75));
    pond.rotation.x = -Math.PI / 2;
    pond.position.set(34, POND_WATER_Y, 178);
    statics.add(pond);
    // pond reeds + lily pads
    for (let i = 0; i < 26; i++) {
      const a = rand(TAU), rr = rand(7.2, 9.5);
      const x = 34 + Math.sin(a) * rr, z = 178 + Math.cos(a) * rr;
      const gy = groundHeight(x, z);
      if (gy < POND_WATER_Y) continue;
      const reed = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, rand(0.8, 1.4)), M.hedgeDark);
      reed.position.set(x, gy + 0.5, z);
      reed.rotation.z = rand(-0.14, 0.14);
      statics.add(reed);
    }
    for (let i = 0; i < 6; i++) {
      const a = rand(TAU), rr = rand(1, 5.5);
      const pad = new THREE.Mesh(new THREE.CircleGeometry(rand(0.3, 0.5), 9, 0.5, 5.6),
        new THREE.MeshStandardMaterial({ color: '#4f9143', roughness: 0.8, side: THREE.DoubleSide }));
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(34 + Math.sin(a) * rr, POND_WATER_Y + 0.02, 178 + Math.cos(a) * rr);
      statics.add(pad);
    }
  }

  // ------------------------------------------------------------ row houses
  function rowHouse(x0, x1, colorMat, roofMat) {
    const w = x1 - x0, cx = (x0 + x1) / 2;
    box(cx, 3.1, -4, w, 6.2, 12, colorMat, { name: 'house' });
    // pitched roof (visual)
    const roof = new THREE.Mesh(new THREE.ConeGeometry(w * 0.74, 2.6, 4), roofMat);
    roof.rotation.y = Math.PI / 4;
    roof.scale.z = 12 / (w * 1.05);
    roof.position.set(cx, 7.5, -4);
    roof.castShadow = true;
    statics.add(roof);
    colliders.push({ minX: x0, maxX: x1, minY: 6.2, maxY: 8.4, minZ: -9, maxZ: 1, climb: false });
    // windows with white trim + door decor on garden side
    for (const wy of [1.6, 4.4]) {
      for (const wx of [cx - w / 4, cx + w / 4]) {
        const trim = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.7, 0.08), M.white);
        trim.position.set(wx, wy, 2.05);
        const win = new THREE.Mesh(new THREE.BoxGeometry(1.35, 1.45, 0.1), M.glass);
        win.position.set(wx, wy, 2.09);
        const sill = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.1, 0.24), M.white);
        sill.position.set(wx, wy - 0.88, 2.12);
        statics.add(trim, win, sill);
      }
    }
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.2, 0.12), M.woodDark);
    door.position.set(cx, 1.1, 2.06);
    statics.add(door);
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.1, 0.7), roofMat);
    canopy.position.set(cx, 2.35, 2.3);
    canopy.rotation.x = 0.15;
    statics.add(canopy);
    const step = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.16, 0.6), M.stone);
    step.position.set(cx, 0.08, 2.3);
    statics.add(step);
    // chimney
    box(cx + w / 3, 8.3, -6, 0.8, 1.6, 0.8, M.brick2, { noCollide: true });
  }
  rowHouse(-23, -8.6, M.brick2, M.roof2);
  rowHouse(8.6, 23, M.brick3, M.roof);

  // ----- Percy's house (with a real bedroom interior, upstairs) -----
  {
    const FLOOR = 3.0;
    // downstairs solid block (we never go there)
    box(0, 1.5, -4, 14.4, 3.0, 12, M.brick, { name: 'houseBase' });
    // upstairs floor slab
    box(0, FLOOR - 0.1, -4, 14.4, 0.2, 12, M.woodLight, { name: 'bedroomFloor' });
    // ceiling
    box(0, 6.3, -4, 14.4, 0.3, 12, M.plaster);
    // perimeter walls (y 3..6.2), garden-side wall has the window hole
    const WH = 3.25, WY = 3.0 + WH / 2 + 0.05;
    box(0, WY, -9.8, 14.4, WH + 0.2, 0.5, M.plaster);                 // north
    box(-7, WY, -4, 0.5, WH + 0.2, 12, M.plaster);                    // west
    box(7, WY, -4, 0.5, WH + 0.2, 12, M.plaster);                     // east
    // south wall pieces around window hole x 1.0..3.2, y 3.7..5.5
    box(-3.1, WY, 1.75, 8.2, WH + 0.2, 0.5, M.brick);                 // left of window
    box(5.1, WY, 1.75, 3.8, WH + 0.2, 0.5, M.brick);                  // right of window
    box(2.1, 5.9, 1.75, 2.2, 0.85, 0.5, M.brick);                     // above hole
    box(2.1, 3.35, 1.75, 2.2, 0.7, 0.5, M.brick, { name: 'sill' });   // below hole → the sill
    // sill ledge outside
    box(2.1, 3.62, 2.15, 2.4, 0.16, 0.5, M.woodLight, { name: 'ledge' });
    // open window: a real frame around the hole so the garden and sky show through
    {
      const top = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.16, 0.56), M.white);
      top.position.set(2.1, 5.42, 1.75);
      const left = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.68, 0.56), M.white);
      left.position.set(1.08, 4.6, 1.75);
      const right = left.clone();
      right.position.x = 3.12;
      // interior sill board sticks into the room — a step up for Percy
      const sillIn = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.12, 0.8), M.woodLight);
      sillIn.position.set(2.1, 3.76, 1.7);
      statics.add(top, left, right, sillIn);
      // swung-open casement pane: white frame + glass, hinged on the right
      const pane = new THREE.Group();
      pane.position.set(3.12, 4.6, 2.05);
      pane.rotation.y = -1.15;
      const pFrame = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.68, 0.06), M.white);
      pFrame.position.x = -0.5;
      const pGlass = new THREE.Mesh(new THREE.BoxGeometry(0.84, 1.5, 0.07), M.glass);
      pGlass.position.x = -0.5;
      pane.add(pFrame, pGlass);
      statics.add(pane);
    }
    // roof
    const roof = new THREE.Mesh(new THREE.ConeGeometry(10.6, 2.8, 4), M.roof);
    roof.rotation.y = Math.PI / 4;
    roof.scale.z = 12 / 15;
    roof.position.set(0, 7.8, -4);
    roof.castShadow = true;
    statics.add(roof);
    colliders.push({ minX: -7.2, maxX: 7.2, minY: 6.4, maxY: 8.6, minZ: -9, maxZ: 1, climb: false });
    box(3.2, 8.6, -6.5, 1.0, 2.0, 1.0, M.brick2, { noCollide: true }); // chimney

    // --- bedroom furniture ---
    box(-4.4, FLOOR + 0.28, -7.6, 2.6, 0.55, 3.6, new THREE.MeshStandardMaterial({ color: '#7f5da8', roughness: 0.9 }), { name: 'bed' });
    box(-4.4, FLOOR + 0.5, -9.2, 2.6, 1.0, 0.3, M.woodDark);          // headboard
    box(-4.4, FLOOR + 0.62, -8.6, 1.6, 0.22, 0.9, M.white, { noCollide: true }); // pillow
    box(5.2, FLOOR + 0.5, -3.0, 2.2, 1.0, 1.1, M.wood, { name: 'desk' });
    box(5.6, FLOOR + 1.28, -3.1, 0.7, 0.55, 0.5, M.metal, { noCollide: true }); // monitor
    box(4.9, FLOOR + 0.95, 0.4, 1.8, 1.9, 1.0, M.woodDark, { name: 'dresser' });
    box(-6.2, FLOOR + 1.1, -2, 0.9, 2.2, 2.6, M.wood, { name: 'shelf' });
    // rug
    const rug = new THREE.Mesh(new THREE.CircleGeometry(1.8, 24), new THREE.MeshStandardMaterial({ color: '#c25b6e', roughness: 1 }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0, FLOOR + 0.012, -4);
    rug.receiveShadow = true;
    statics.add(rug);
    // poster
    const poster = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.8), new THREE.MeshStandardMaterial({ color: '#3a7bd5' }));
    poster.position.set(-2, 4.9, -9.5); statics.add(poster);
    const poster2 = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.4), new THREE.MeshStandardMaterial({ color: '#d55f3a' }));
    poster2.position.set(-6.73, 4.7, -5); poster2.rotation.y = Math.PI / 2; statics.add(poster2);
    // curtains framing the open window
    const curtainMat = new THREE.MeshStandardMaterial({ color: '#d98a4a', roughness: 1 });
    for (const cx of [0.8, 3.4]) {
      const cur = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.1, 0.1), curtainMat);
      cur.position.set(cx, 4.55, 1.42);
      cur.rotation.x = 0.04;
      statics.add(cur);
    }
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 3.2, 6), M.metal);
    rod.rotation.z = Math.PI / 2;
    rod.position.set(2.1, 5.65, 1.42);
    statics.add(rod);
    // books on the shelf
    for (let bi = 0; bi < 9; bi++) {
      const bh = 0.28 + Math.random() * 0.14;
      const book = new THREE.Mesh(new THREE.BoxGeometry(0.09, bh, 0.5),
        new THREE.MeshStandardMaterial({ color: pick(['#c94f3f', '#3a7bd5', '#e8b23c', '#59b06a', '#9b6bd9', '#e8e4dc']) }));
      book.position.set(-6.15, FLOOR + (bi < 5 ? 1.55 : 0.85) + bh / 2, -3.1 + (bi % 5) * 0.14);
      statics.add(book);
    }
    // Percy's cat bed by the window
    const bedRing = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.14, 8, 18),
      new THREE.MeshStandardMaterial({ color: '#7a9ec9', roughness: 1 }));
    bedRing.rotation.x = Math.PI / 2;
    bedRing.position.set(-1.5, FLOOR + 0.14, 0.6);
    const bedCushion = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.1, 16),
      new THREE.MeshStandardMaterial({ color: '#e8dfc9', roughness: 1 }));
    bedCushion.position.set(-1.5, FLOOR + 0.1, 0.6);
    statics.add(bedRing, bedCushion);
    // white trim around the open window (outside face)
    const trimMat = new THREE.MeshStandardMaterial({ color: '#f5f2ea', roughness: 0.7 });
    for (const [tx, ty, tw, th] of [[2.1, 5.55, 2.5, 0.14], [2.1, 3.62, 2.5, 0.14], [0.95, 4.6, 0.14, 2.0], [3.25, 4.6, 0.14, 2.0]]) {
      const trim = new THREE.Mesh(new THREE.BoxGeometry(tw, th, 0.12), trimMat);
      trim.position.set(tx, ty, 2.06);
      statics.add(trim);
    }
  }

  // shed under the window (landing platform)
  box(2.4, 1.2, 4.2, 4.6, 2.4, 4.0, M.wood, { name: 'shed', climb: true });
  box(2.4, 2.5, 4.2, 5.0, 0.2, 4.4, M.woodDark, { name: 'shedRoof' });

  // ------------------------------------------------------------ gardens
  // hedges: corridor x=±14 from house to street
  function hedgeLine(x, z0, z1, h = 2.4) {
    const d = z1 - z0;
    box(x, h / 2, z0 + d / 2, 1.6, h, d, M.hedge, { name: 'hedge' });
  }
  hedgeLine(-14, 2, 80);
  hedgeLine(14, 2, 80);

  // patio + props
  box(-2.5, 0.05, 4.5, 5, 0.1, 4, M.stone, { name: 'patio' });
  // stone path from the patio to the back gate
  for (let pz = 7.5; pz < 37; pz += 1.7) {
    const slab = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, 0.08, 7), M.stone);
    slab.position.set(-1.5 + Math.sin(pz * 0.5) * 0.7, 0.04, pz);
    slab.rotation.y = pz;
    slab.receiveShadow = true;
    statics.add(slab);
  }
  // bird bath
  {
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 0.9, 8), M.stone);
    stand.position.set(7.5, 0.45, 16);
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.32, 0.18, 12), M.stone);
    basin.position.set(7.5, 0.95, 16);
    const bathWater = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.05, 12),
      new THREE.MeshStandardMaterial({ color: '#5ab0d8', roughness: 0.15 }));
    bathWater.position.set(7.5, 1.02, 16);
    stand.castShadow = basin.castShadow = true;
    statics.add(stand, basin, bathWater);
    cylinderCollider(7.5, 16, 0.3, 0, 1.0);
  }
  // garden back fence (climbable) with gate
  function fence(x0, z, x1, h = 1.9, climb = true) {
    const w = x1 - x0;
    const base = Math.max(groundHeight((x0 + x1) / 2, z), 0);
    box((x0 + x1) / 2, base + h / 2, z, w, h, 0.18, M.fence, { climb, name: 'fence' });
    for (let x = x0; x <= x1 + 0.01; x += 2.2) {
      box(x, Math.max(groundHeight(x, z), 0) + h / 2 + 0.06, z, 0.22, h + 0.12, 0.3, M.woodDark, { noCollide: true });
    }
  }
  fence(-13.2, 38, 13.2, 1.9);
  fence(-13.2, 76, 13.2, 1.9);

  // flower beds
  function flowerBed(x, z, w, d) {
    box(x, 0.14, z, w, 0.3, d, M.woodDark, { name: 'bed' });
    for (let i = 0; i < Math.floor(w * d * 1.2); i++) {
      const fx = x + rand(-w / 2 + 0.2, w / 2 - 0.2), fz = z + rand(-d / 2 + 0.2, d / 2 - 0.2);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.35), M.hedgeDark);
      stem.position.set(fx, 0.45, fz);
      const bloom = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5),
        new THREE.MeshStandardMaterial({ color: pick(['#e85d75', '#f2b134', '#c86bd9', '#ffffff', '#ff8552']) }));
      bloom.position.set(fx, 0.66, fz);
      statics.add(stem, bloom);
    }
  }
  flowerBed(-10, 10, 4, 2.4);
  flowerBed(10, 24, 4, 2.4);
  flowerBed(-10, 30, 4, 2.4);

  // foliage that sways gently in the wind (positions nudged each frame)
  const swayers = [];
  function sway(mesh, amt = 1) {
    swayers.push({ mesh, bx: mesh.position.x, bz: mesh.position.z, ph: rand(TAU), amt });
  }

  // garden tree (climbable trunk, canopy)
  function tree(x, z, scale = 1, kind = 'oak') {
    const gy = groundHeight(x, z);
    if (kind === 'oak') {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.28 * scale, 0.4 * scale, 3.2 * scale, 8), M.trunk);
      trunk.position.set(x, gy + 1.6 * scale, z);
      trunk.castShadow = true;
      statics.add(trunk);
      cylinderCollider(x, z, 0.36 * scale, gy, gy + 3.2 * scale, true);
      for (let i = 0; i < 4; i++) {
        const blob = new THREE.Mesh(new THREE.SphereGeometry((1.5 + rand(0.6)) * scale, 10, 8), i % 2 ? M.leaf : M.leafDark);
        blob.position.set(x + rand(-1.2, 1.2) * scale, gy + (3.6 + rand(1.4)) * scale, z + rand(-1.2, 1.2) * scale);
        blob.castShadow = true;
        statics.add(blob);
        sway(blob, scale);
      }
    } else {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * scale, 0.26 * scale, 1.6 * scale, 7), M.trunk);
      trunk.position.set(x, gy + 0.8 * scale, z);
      trunk.castShadow = true;
      statics.add(trunk);
      cylinderCollider(x, z, 0.24 * scale, gy, gy + 1.4 * scale, false);
      for (let i = 0; i < 3; i++) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry((1.5 - i * 0.36) * scale, 1.5 * scale, 8), M.pine);
        cone.position.set(x, gy + (1.7 + i * 0.95) * scale, z);
        cone.castShadow = true;
        statics.add(cone);
        sway(cone, 0.35 * (i + 1) * scale);
      }
    }
  }
  tree(-9, 20, 1.15);
  tree(10.5, 33, 0.9);

  // ------------------------------------------------------- neighbour yard (dog!)
  // clothesline
  box(-8, 1.1, 46, 0.16, 2.2, 0.16, M.metal, { name: 'pole' });
  box(-2, 1.1, 46, 0.16, 2.2, 0.16, M.metal, { name: 'pole' });
  const sheets = [];
  {
    const line = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 6), M.white);
    line.rotation.z = Math.PI / 2;
    line.position.set(-5, 2.05, 46);
    statics.add(line);
    for (let i = 0; i < 3; i++) {
      // hinge at the top edge so the sheet swings from the line in the breeze
      const sheetGeo = new THREE.PlaneGeometry(1.2, 1.3);
      sheetGeo.translate(0, -0.65, 0);
      const sheet = new THREE.Mesh(sheetGeo, new THREE.MeshStandardMaterial({ color: pick(['#fff', '#cfe3f5', '#f5d5cf']), side: THREE.DoubleSide }));
      sheet.position.set(-7 + i * 1.8, 2.05, 46);
      statics.add(sheet);
      sheets.push({ mesh: sheet, ph: i * 1.7 });
    }
  }
  // dog house
  box(9, 0.8, 50, 2.2, 1.6, 2.4, M.woodDark, { name: 'doghouse', climb: true });
  // sandbox + toys
  box(-9, 0.15, 62, 3, 0.3, 3, M.woodLight, { name: 'sandbox' });
  // trampoline (bounce!)
  const trampolines = [];
  {
    const legs = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 0.24, 20, 1, true), M.metal);
    legs.position.set(7, 0.85, 66);
    statics.add(legs);
    const mat = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.75, 0.1, 20), new THREE.MeshStandardMaterial({ color: '#2b3f66', roughness: 0.7 }));
    mat.position.set(7, 0.9, 66);
    statics.add(mat);
    const pad = new THREE.Mesh(new THREE.TorusGeometry(1.85, 0.14, 8, 20), new THREE.MeshStandardMaterial({ color: '#4a68a8' }));
    pad.rotation.x = Math.PI / 2;
    pad.position.set(7, 0.92, 66);
    statics.add(pad);
    trampolines.push({ x: 7, z: 66, r: 1.9, y: 0.95 });
  }
  // crates stacked near the exit fence (an easy way over)
  box(-6, 0.45, 74.6, 1.6, 0.9, 1.6, M.wood, { name: 'crate', climb: true });
  box(-6.3, 1.3, 74.9, 1.3, 0.8, 1.3, M.woodLight, { name: 'crate', climb: true });

  // ------------------------------------------------------------- street
  {
    box(0, -0.06, 82, 156, 0.24, 4.4, M.sidewalk, { name: 'sidewalk', shadow: false });
    box(0, -0.06, 98, 156, 0.24, 4.4, M.sidewalk, { name: 'sidewalk', shadow: false });
    const road = new THREE.Mesh(new THREE.PlaneGeometry(156, 11.6), M.road);
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0.02, 90);
    road.receiveShadow = true;
    statics.add(road);
    for (let x = -76; x < 78; x += 4) {
      if (Math.abs(x) < 4) continue; // gap at the zebra crossing
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(2, 0.3), M.line);
      dash.rotation.x = -Math.PI / 2;
      dash.rotation.z = Math.PI / 2;
      dash.position.set(x, 0.03, 90);
      statics.add(dash);
    }
    // zebra crossing right on the route
    for (let zz = 84.9; zz < 95.5; zz += 1.5) {
      const stripe = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.75), M.line);
      stripe.rotation.x = -Math.PI / 2;
      stripe.position.set(0, 0.035, zz);
      stripe.receiveShadow = true;
      statics.add(stripe);
    }
    // crossing sign
    {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 6), M.metal);
      pole.position.set(-3, 1.2, 81.5);
      const signBox = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.08),
        new THREE.MeshStandardMaterial({ color: '#2a6bd9', roughness: 0.5 }));
      signBox.position.set(-3, 2.6, 81.5);
      signBox.rotation.z = Math.PI / 4;
      pole.castShadow = true;
      statics.add(pole, signBox);
      cylinderCollider(-3, 81.5, 0.1, 0, 2.4);
    }
    // lamp posts
    for (const [lx, lz] of [[-12, 84.5], [12, 95.5], [-36, 95.5], [36, 84.5], [-60, 84.5], [60, 95.5]]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 4.6, 8), M.metal);
      post.position.set(lx, 2.3, lz);
      post.castShadow = true;
      statics.add(post);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshStandardMaterial({ color: '#fff2c0', emissive: '#ffdf8a', emissiveIntensity: 0.7 }));
      lamp.position.set(lx, 4.6, lz);
      statics.add(lamp);
      cylinderCollider(lx, lz, 0.14, 0, 4.4);
    }
    // parked cars (parallel to the street)
    box(-20, 0.62, 97.6, 4.2, 1.1, 1.9, new THREE.MeshStandardMaterial({ color: '#7d4a8f', roughness: 0.4, metalness: 0.4 }), { name: 'parked' });
    box(-20.4, 1.35, 97.6, 2.2, 0.6, 1.7, M.glass, { noCollide: true });
    box(18, 0.62, 82.4, 4.2, 1.1, 1.9, new THREE.MeshStandardMaterial({ color: '#3f7a5c', roughness: 0.4, metalness: 0.4 }), { name: 'parked' });
    box(18.4, 1.35, 82.4, 2.2, 0.6, 1.7, M.glass, { noCollide: true });
  }

  // ------------------------------------------------------------- fields
  // sunflower patches
  for (let i = 0; i < 44; i++) {
    const x = i < 26 ? rand(-30, -12) : rand(28, 46), z = i < 26 ? rand(108, 130) : rand(110, 126);
    const gy = groundHeight(x, z);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 1.7), M.hedgeDark);
    stem.position.set(x, gy + 0.85, z);
    const headM = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.08, 10), new THREE.MeshStandardMaterial({ color: '#5c4318' }));
    headM.rotation.x = Math.PI / 2.4;
    headM.position.set(x, gy + 1.75, z + 0.06);
    const petals = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.09, 6, 10), new THREE.MeshStandardMaterial({ color: '#f2b134' }));
    petals.rotation.x = Math.PI / 2.4;
    petals.position.copy(headM.position);
    statics.add(stem, headM, petals);
  }
  // golden wheat patches (instanced)
  {
    const stalk = new THREE.ConeGeometry(0.05, 0.9, 4);
    stalk.translate(0, 0.45, 0);
    const wmat = windify(new THREE.MeshStandardMaterial({ color: '#d9b45c', roughness: 1 }), 1.3, 0.85);
    const WN = 1050;
    const winst = new THREE.InstancedMesh(stalk, wmat, WN);
    const wm4 = new THREE.Matrix4();
    const wq = new THREE.Quaternion();
    const weu = new THREE.Euler();
    const wcol = new THREE.Color();
    let wn = 0, wguard = 0;
    const patches = [[22, 118, 9], [30, 138, 8], [-28, 160, 9], [24, 172, 10], [-46, 142, 9], [52, 146, 10]];
    while (wn < WN && wguard++ < 8000) {
      const [px, pz, pr] = patches[wn % patches.length];
      const a = rand(TAU), rr = Math.sqrt(Math.random()) * pr;
      const x = px + Math.sin(a) * rr, z = pz + Math.cos(a) * rr;
      if (waterLevelAt(x, z) !== null) continue;
      weu.set(rand(-0.12, 0.12), rand(TAU), rand(-0.12, 0.12));
      wq.setFromEuler(weu);
      wm4.compose(new THREE.Vector3(x, groundHeight(x, z), z), wq, new THREE.Vector3(1, rand(0.8, 1.3), 1));
      winst.setMatrixAt(wn, wm4);
      wcol.set(pick(['#d9b45c', '#e3c26a', '#c9a24a']));
      winst.setColorAt(wn, wcol);
      wn++;
    }
    winst.count = wn;
    winst.instanceMatrix.needsUpdate = true;
    if (winst.instanceColor) winst.instanceColor.needsUpdate = true;
    statics.add(winst);
  }
  // pumpkins near the barn
  for (const [px, pz] of [[9, 198], [10.5, 199.5], [8.2, 200.8]]) {
    const gy = groundHeight(px, pz);
    const pump = new THREE.Mesh(new THREE.SphereGeometry(rand(0.28, 0.42), 10, 8),
      new THREE.MeshStandardMaterial({ color: '#e07a2e', roughness: 0.8 }));
    pump.scale.y = 0.75;
    pump.position.set(px, gy + 0.22, pz);
    pump.castShadow = true;
    const stemP = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.15, 6), M.hedgeDark);
    stemP.position.set(px, gy + 0.5, pz);
    statics.add(pump, stemP);
  }
  // hay bales (climbable fun)
  function hayBale(x, z, ry = 0) {
    const gy = groundHeight(x, z);
    const bale = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.5, 12), M.hay);
    bale.rotation.z = Math.PI / 2;
    bale.rotation.y = ry;
    bale.position.set(x, gy + 0.9, z);
    bale.castShadow = true;
    statics.add(bale);
    colliders.push({ minX: x - 1, maxX: x + 1, minY: gy, maxY: gy + 1.8, minZ: z - 1, maxZ: z + 1, climb: true, name: 'hay' });
    return gy;
  }
  hayBale(9, 118, 0.4);
  const hbY = hayBale(11, 132, 1.2);
  hayBale(-8, 140, 2.2);
  // scarecrow
  {
    const gy = groundHeight(-16, 136);
    box(-16, gy + 1.1, 136, 0.16, 2.2, 0.16, M.woodDark, { name: 'scarecrowPole' });
    box(-16, gy + 1.75, 136, 1.5, 0.14, 0.14, M.woodDark, { noCollide: true });
    const headS = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 8), M.hay);
    headS.position.set(-16, gy + 2.35, 136);
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.4, 8), M.wood);
    hat.position.set(-16, gy + 2.7, 136);
    const shirt = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.4), new THREE.MeshStandardMaterial({ color: '#a84a4a' }));
    shirt.position.set(-16, gy + 1.6, 136);
    statics.add(headS, hat, shirt);
  }
  // low field fences to hop across the route
  fence(-4, 122, 6, 1.05);
  fence(-6, 200, 5, 1.15);

  // stream crossing: stepping stones + log bridge
  const stones = [[1.9, 147.9], [2.7, 149.4], [1.9, 150.9], [2.7, 152.4]];
  for (const [sx, sz] of stones) {
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.0, 0.5, 8), M.stone);
    st.position.set(sx, -0.26, sz);
    st.castShadow = true;
    statics.add(st);
    colliders.push({ minX: sx - 0.8, maxX: sx + 0.8, minY: -1, maxY: -0.01, minZ: sz - 0.8, maxZ: sz + 0.8, climb: false, name: 'stone' });
  }
  {
    // fallen log bridge further west
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 8.4, 10), M.trunk);
    log.rotation.x = Math.PI / 2;
    log.position.set(-13, 0.05, 150);
    log.castShadow = true;
    statics.add(log);
    colliders.push({ minX: -13.45, maxX: -12.55, minY: -1, maxY: 0.42, minZ: 145.8, maxZ: 154.2, climb: false, name: 'log' });
  }
  // cattails + rocks along the stream banks
  for (let i = 0; i < 64; i++) {
    const x = rand(-72, 72);
    if (x > -1 && x < 6) continue; // keep the crossing clear
    const z = 150 + pick([-1, 1]) * rand(3.2, 5);
    const gy = groundHeight(x, z);
    if (gy < STREAM_WATER_Y) continue;
    const reed = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, rand(0.9, 1.5)), M.hedgeDark);
    reed.position.set(x, gy + 0.55, z);
    reed.rotation.z = rand(-0.12, 0.12);
    const tip = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.22, 4, 6),
      new THREE.MeshStandardMaterial({ color: '#6f4a2c', roughness: 1 }));
    tip.position.set(x, gy + 1.15, z);
    statics.add(reed, tip);
  }
  for (let i = 0; i < 14; i++) {
    const x = rand(-45, 45), z = 150 + pick([-1, 1]) * rand(2.8, 4.5);
    const gy = groundHeight(x, z);
    const br = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(0.2, 0.45), 0), M.stone);
    br.position.set(x, gy + 0.12, z);
    br.rotation.set(rand(TAU), rand(TAU), 0);
    statics.add(br);
  }

  // ------------------------------------------------------------- barn (optional loot)
  {
    const bx = 16, bz = 205, gy = groundHeight(bx, bz);
    // walls with door opening on west side
    box(bx, gy + 2.2, bz - 5.2, 12, 4.4, 0.5, new THREE.MeshStandardMaterial({ color: '#9c3a30', roughness: 0.9 }));
    box(bx, gy + 2.2, bz + 5.2, 12, 4.4, 0.5, new THREE.MeshStandardMaterial({ color: '#9c3a30', roughness: 0.9 }));
    box(bx + 6, gy + 2.2, bz, 0.5, 4.4, 10.9, new THREE.MeshStandardMaterial({ color: '#8f342b', roughness: 0.9 }));
    // west wall: two pieces leaving a door
    box(bx - 6, gy + 2.2, bz - 3.6, 0.5, 4.4, 3.6, new THREE.MeshStandardMaterial({ color: '#8f342b', roughness: 0.9 }));
    box(bx - 6, gy + 2.2, bz + 3.6, 0.5, 4.4, 3.6, new THREE.MeshStandardMaterial({ color: '#8f342b', roughness: 0.9 }));
    box(bx - 6, gy + 3.9, bz, 0.5, 1.0, 3.0, new THREE.MeshStandardMaterial({ color: '#8f342b', roughness: 0.9 }));
    // roof
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 4.4, 12.4, 3, 1), M.roof2);
    roof.rotation.z = Math.PI / 2;
    roof.rotation.x = Math.PI;
    roof.scale.y = 1.02;
    roof.position.set(bx, gy + 5.2, bz);
    roof.castShadow = true;
    statics.add(roof);
    colliders.push({ minX: bx - 6, maxX: bx + 6, minY: gy + 4.4, maxY: gy + 6.6, minZ: bz - 5.4, maxZ: bz + 5.4 });
    // hay inside (stairs of bales) + loft
    hayBale(bx - 2, bz + 2.5);
    colliders.push({ minX: bx + 0.4, maxX: bx + 3.4, minY: gy, maxY: gy + 2.6, minZ: bz + 1, maxZ: bz + 4.4, climb: true, name: 'haystack' });
    const stack = new THREE.Mesh(new THREE.BoxGeometry(3, 2.6, 3.4), M.hayDark);
    stack.position.set(bx + 1.9, gy + 1.3, bz + 2.7);
    stack.castShadow = true;
    statics.add(stack);
    box(bx + 2.5, gy + 3.5, bz - 1.5, 6.5, 0.24, 7, M.woodDark, { name: 'loft' });
  }

  // windmill (far decor, spins)
  const spinners = [];
  {
    const wx = -34, wz = 190, gy = groundHeight(wx, wz);
    const towerM = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2, 9, 8), M.plaster);
    towerM.position.set(wx, gy + 4.5, wz);
    towerM.castShadow = true;
    statics.add(towerM);
    cylinderCollider(wx, wz, 1.6, gy, gy + 9);
    const hub = new THREE.Group();
    hub.position.set(wx, gy + 8.6, wz + 1.9);
    for (let i = 0; i < 4; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.5, 4.4, 0.08), M.woodLight);
      blade.position.y = 2.2;
      const arm = new THREE.Group();
      arm.rotation.z = (i * Math.PI) / 2;
      arm.add(blade);
      hub.add(arm);
    }
    statics.add(hub);
    spinners.push(hub);
  }

  // ------------------------------------------------------------- forest
  const forestTrees = [
    [-6, 224], [7, 228], [-9, 236], [10, 240], [-4, 246], [8, 252], [-11, 254], [3, 258],
    [-18, 228], [18, 232], [-22, 244], [20, 250], [-15, 260], [14, 262], [24, 240], [-26, 234],
  ];
  for (const [tx, tz] of forestTrees) tree(tx + rand(-1, 1), tz + rand(-1, 1), rand(1.1, 1.7), 'pine');
  // birches for variety
  function birch(x, z, s = 1) {
    const gy = groundHeight(x, z);
    const trunkB = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * s, 0.16 * s, 3.6 * s, 7),
      new THREE.MeshStandardMaterial({ color: '#e8e4dc', roughness: 0.9 }));
    trunkB.position.set(x, gy + 1.8 * s, z);
    trunkB.castShadow = true;
    statics.add(trunkB);
    // dark bark marks
    for (let i = 0; i < 4; i++) {
      const mark = new THREE.Mesh(new THREE.BoxGeometry(0.16 * s, 0.08, 0.05), tipDark());
      mark.position.set(x + rand(-0.06, 0.06) * s, gy + rand(0.5, 3) * s, z + 0.13 * s);
      mark.rotation.y = rand(TAU);
      statics.add(mark);
    }
    cylinderCollider(x, z, 0.15 * s, gy, gy + 3.4 * s, true);
    for (let i = 0; i < 3; i++) {
      const blob = new THREE.Mesh(new THREE.SphereGeometry((1.0 + rand(0.5)) * s, 9, 7),
        new THREE.MeshStandardMaterial({ color: pick(['#b8c94a', '#a4bf55']), roughness: 1 }));
      blob.position.set(x + rand(-0.8, 0.8) * s, gy + (3.6 + rand(1.2)) * s, z + rand(-0.8, 0.8) * s);
      blob.castShadow = true;
      statics.add(blob);
      sway(blob, s);
    }
  }
  function tipDark() { return new THREE.MeshStandardMaterial({ color: '#3b352a', roughness: 1 }); }
  birch(6, 220, 1.1);
  birch(-13, 244, 1.25);
  birch(12, 256, 1.0);
  tree(-20, 130, 1.4, 'oak');
  tree(24, 145, 1.2, 'oak');
  tree(-24, 170, 1.3, 'oak');
  tree(26, 178, 1.5, 'oak');
  tree(-12, 282, 1.2, 'oak');
  tree(15, 286, 1.0, 'oak');
  // fallen log obstacle across the forest path
  {
    const gy = groundHeight(0, 234);
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, 9, 10), M.trunk);
    log.rotation.z = Math.PI / 2;
    log.rotation.y = 0.2;
    log.position.set(0.5, gy + 0.5, 234);
    log.castShadow = true;
    statics.add(log);
    colliders.push({ minX: -4, maxX: 5, minY: gy - 0.2, maxY: gy + 1.05, minZ: 233.4, maxZ: 234.6, climb: false, name: 'forestLog' });
  }
  // rocks
  function rock(x, z, s) {
    const gy = groundHeight(x, z);
    const r = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), M.stone);
    r.position.set(x, gy + s * 0.55, z);
    r.rotation.set(rand(TAU), rand(TAU), 0);
    r.castShadow = true;
    statics.add(r);
    colliders.push({ minX: x - s * 0.8, maxX: x + s * 0.8, minY: gy, maxY: gy + s * 1.05, minZ: z - s * 0.8, maxZ: z + s * 0.8, climb: s > 0.8, name: 'rock' });
  }
  rock(-2.5, 247, 1.1);
  rock(-0.5, 248.5, 0.7);
  rock(3, 210, 0.9);
  rock(-14, 156, 0.8);
  rock(8, 300, 0.9);
  rock(-9, 297, 0.7);
  // mushrooms
  for (let i = 0; i < 14; i++) {
    const x = rand(-20, 20), z = rand(222, 260);
    const gy = groundHeight(x, z);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.22), M.white);
    stem.position.set(x, gy + 0.11, z);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 5, 0, TAU, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: pick(['#c94f3f', '#d9823b']) }));
    cap.position.set(x, gy + 0.2, z);
    statics.add(stem, cap);
  }

  // ------------------------------------------------------------- lake & pier
  const PIER_END = new THREE.Vector3(0, 0.42, 288);
  {
    // deck planks from shore into the lake
    for (let z = 269; z <= 288; z += 1.9) {
      box(0, 0.3, z, 2.6, 0.14, 1.8, M.woodLight, { name: 'pier', shadow: false });
    }
    // posts
    for (const z of [270, 276, 282, 288]) {
      for (const s of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.6, 8), M.woodDark);
        post.position.set(1.25 * s, -0.6, z);
        statics.add(post);
      }
    }
    // reeds around shore
    for (let i = 0; i < 60; i++) {
      const a = rand(TAU), rr = rand(24.5, 28.5);
      const x = Math.sin(a) * rr, z = 295 + Math.cos(a) * rr;
      if (groundHeight(x, z) > 0.2 || Math.abs(x) < 2 && z < 295) continue;
      const reed = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, rand(0.8, 1.5)), M.hedgeDark);
      const gy = Math.max(groundHeight(x, z), LAKE_WATER_Y - 0.3);
      reed.position.set(x, gy + 0.5, z);
      const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.3), new THREE.MeshStandardMaterial({ color: '#7a5b38' }));
      tip.position.set(x, gy + 1.1, z);
      statics.add(reed, tip);
    }
    // rowboat decor
    const boat = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.5, 3.2, 8, 1), M.wood);
    boat.rotation.z = Math.PI / 2;
    boat.rotation.y = 0.5;
    boat.scale.y = 0.55;
    boat.position.set(-12, LAKE_WATER_Y + 0.25, 283);
    statics.add(boat);
    // lily pads (a few with pink blooms)
    for (let i = 0; i < 12; i++) {
      const a = rand(TAU), rr = rand(6, 20);
      const x = Math.sin(a) * rr, z = 295 + Math.cos(a) * rr;
      if (Math.abs(x) < 3 && z < 292) continue; // keep the fishing ring clear
      const pad = new THREE.Mesh(new THREE.CircleGeometry(rand(0.35, 0.6), 9, 0.5, 5.6),
        new THREE.MeshStandardMaterial({ color: pick(['#4f9143', '#3f8a4a']), roughness: 0.8, side: THREE.DoubleSide }));
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(x, LAKE_WATER_Y + 0.02, z);
      statics.add(pad);
      if (Math.random() < 0.4) {
        const bloom = new THREE.Mesh(new THREE.SphereGeometry(0.12, 7, 6),
          new THREE.MeshStandardMaterial({ color: '#f0a0c0', roughness: 0.7 }));
        bloom.scale.y = 0.7;
        bloom.position.set(x, LAKE_WATER_Y + 0.1, z);
        statics.add(bloom);
      }
    }
    // lantern at the pier end — warm glow for the finale
    {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.6, 6), M.woodDark);
      post.position.set(-1.05, 1.1, 288.3);
      const cage = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 0.26), M.metal);
      cage.position.set(-1.05, 2.0, 288.3);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6),
        new THREE.MeshStandardMaterial({ color: '#ffe9b0', emissive: '#ffce70', emissiveIntensity: 2.2 }));
      bulb.position.set(-1.05, 2.0, 288.3);
      post.castShadow = true;
      statics.add(post, cage, bulb);
      const glow = new THREE.PointLight(0xffc76e, 6, 12, 1.9);
      glow.position.set(-1.05, 2.1, 288.3);
      scene.add(glow);
    }
    // sunset reflection streak on the water
    const streak = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 34),
      new THREE.MeshBasicMaterial({ color: '#ffb45e', transparent: true, opacity: 0.32, depthWrite: false }));
    streak.rotation.x = -Math.PI / 2;
    streak.rotation.z = -0.5;
    streak.position.set(6, LAKE_WATER_Y + 0.03, 296);
    statics.add(streak);
  }

  // ------------------------------------------------------------- grass (instanced)
  {
    const blade = new THREE.ConeGeometry(0.06, 0.55, 4);
    blade.translate(0, 0.24, 0);
    const gmat = windify(new THREE.MeshStandardMaterial({ color: '#79a83f', roughness: 1 }), 1, 1.15);
    const COUNT = 4200;
    const inst = new THREE.InstancedMesh(blade, gmat, COUNT);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const eu = new THREE.Euler();
    const col = new THREE.Color();
    let n = 0, guard = 0;
    while (n < COUNT && guard++ < 20000) {
      const x = rand(-74, 74), z = rand(100, 274);
      if (Math.abs(z - 150) < 4) continue;
      if (waterLevelAt(x, z) !== null) continue;
      const gy = groundHeight(x, z);
      eu.set(rand(-0.15, 0.15), rand(TAU), rand(-0.15, 0.15));
      q.setFromEuler(eu);
      m4.compose(new THREE.Vector3(x, gy, z), q, new THREE.Vector3(rand(0.7, 1.6), rand(0.7, 1.8), rand(0.7, 1.6)));
      inst.setMatrixAt(n, m4);
      col.set(pick(['#79a83f', '#8fb455', '#a4bf5b', '#6a9a3a']));
      inst.setColorAt(n, col);
      n++;
    }
    inst.count = n;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    statics.add(inst);
  }

  // world bounds (invisible)
  box(0, 4, -19, 170, 12, 1, M.hedge, { noMesh: true });
  box(0, 4, 385, 170, 12, 1, M.hedge, { noMesh: true });
  box(-78, 4, 183, 1, 12, 410, M.hedge, { noMesh: true });
  box(78, 4, 183, 1, 12, 410, M.hedge, { noMesh: true });
  // visible bushes along field bounds
  for (let z = -6; z < 380; z += rand(7, 12)) {
    for (const s of [-1, 1]) {
      const x = 76.5 * s + rand(-1.5, 1.5);
      const b = new THREE.Mesh(new THREE.SphereGeometry(rand(1.6, 3), 8, 6), Math.random() < 0.5 ? M.hedge : M.hedgeDark);
      b.position.set(x, groundHeight(x, z) + 0.6, z);
      b.castShadow = true;
      statics.add(b);
    }
  }

  // ---------------------------------------------- bigger world: side content
  // neighbour gardens either side of the hedged corridor
  for (const [tx, tz, ts] of [[-24, 12, 1.2], [26, 18, 1.0], [-38, 30, 1.4], [40, 42, 1.1],
    [-30, 55, 1.0], [34, 62, 1.3], [-48, 48, 1.2], [50, 26, 1.2], [-44, 70, 1.0], [46, 74, 1.1]]) {
    tree(tx + rand(-2, 2), tz + rand(-2, 2), ts, 'oak');
  }
  for (const [fx, fz] of [[-26, 24], [30, 36], [-40, 58], [42, 12]]) flowerBed(fx, fz, 3.4, 2);
  // apple orchard west of the fields
  for (let i = 0; i < 6; i++) {
    const ox = -46 + (i % 3) * 8 + rand(-1, 1), oz = 118 + Math.floor(i / 3) * 10 + rand(-1, 1);
    tree(ox, oz, 1.0, 'oak');
    const gy = groundHeight(ox, oz);
    for (let a = 0; a < 5; a++) {
      const apple = new THREE.Mesh(new THREE.SphereGeometry(0.09, 7, 6),
        new THREE.MeshStandardMaterial({ color: pick(['#d93b2f', '#e8642f']), roughness: 0.5 }));
      apple.position.set(ox + rand(-1.3, 1.3), gy + rand(3, 4.6), oz + rand(-1.3, 1.3));
      statics.add(apple);
    }
  }
  // old tractor by the barn
  {
    const tx2 = 27, tz2 = 196, gy = groundHeight(tx2, tz2);
    const red = new THREE.MeshStandardMaterial({ color: '#b8402e', roughness: 0.6, metalness: 0.2 });
    box(tx2, gy + 1.0, tz2, 1.7, 1.1, 3.0, red, { name: 'tractor' });
    box(tx2, gy + 1.95, tz2 - 0.7, 1.5, 0.9, 1.3, red, { noCollide: true });      // cab
    box(tx2, gy + 2.0, tz2 - 0.7, 1.2, 0.62, 1.0, M.glass, { noCollide: true });  // cab glass
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.9, 6), M.metal);
    pipe.position.set(tx2 + 0.5, gy + 1.9, tz2 + 1.1);
    statics.add(pipe);
    const wheelM = new THREE.MeshStandardMaterial({ color: '#1c1e22', roughness: 0.9 });
    for (const [wx, wz, wr] of [[-1, -0.9, 0.85], [1, -0.9, 0.85], [-0.9, 1.15, 0.45], [0.9, 1.15, 0.45]]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(wr, wr, 0.4, 14), wheelM);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(tx2 + wx, gy + wr, tz2 + wz);
      wheel.castShadow = true;
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(wr * 0.4, wr * 0.4, 0.42, 8),
        new THREE.MeshStandardMaterial({ color: '#d8b13c', roughness: 0.5 }));
      hub.rotation.z = Math.PI / 2;
      hub.position.copy(wheel.position);
      statics.add(wheel, hub);
    }
    colliders.push({ minX: tx2 - 2, maxX: tx2 + 2, minY: gy, maxY: gy + 1.7, minZ: tz2 - 1.6, maxZ: tz2 + 1.6, climb: true, name: 'tractor' });
  }
  // extra hay bales + pumpkins across the wider fields
  hayBale(32, 148, 0.8);
  hayBale(-30, 196, 1.9);
  hayBale(44, 168, 0.3);
  for (const [px2, pz2] of [[12.4, 197], [7, 202.4]]) {
    const gy = groundHeight(px2, pz2);
    const pump = new THREE.Mesh(new THREE.SphereGeometry(rand(0.3, 0.4), 10, 8),
      new THREE.MeshStandardMaterial({ color: '#e07a2e', roughness: 0.8 }));
    pump.scale.y = 0.75;
    pump.position.set(px2, gy + 0.22, pz2);
    pump.castShadow = true;
    statics.add(pump);
  }
  // deeper forest + wooded backdrop behind the lake
  const extraPines = [
    [-32, 224], [34, 230], [-38, 246], [38, 252], [-30, 262], [30, 266], [-44, 236], [44, 244],
    [-24, 270], [26, 272], [-52, 252], [52, 232], [-60, 240], [60, 258], [-36, 216], [40, 220],
  ];
  for (const [tx, tz] of extraPines) tree(tx + rand(-2, 2), tz + rand(-2, 2), rand(1.0, 1.7), 'pine');
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI - Math.PI / 2;
    const x = Math.sin(a) * rand(34, 62), z = 322 + Math.abs(Math.cos(a)) * rand(20, 48);
    tree(x, z, rand(1.2, 1.9), Math.random() < 0.6 ? 'pine' : 'oak');
  }

  // ================================================================ pickups
  const pickupGroup = new THREE.Group();
  scene.add(pickupGroup);
  function addPickup(type, x, z, yOverride = null) {
    const y = yOverride !== null ? yOverride : Math.max(groundHeight(x, z), 0) + 0;
    const g = new THREE.Group();
    g.position.set(x, y, z);
    let label = '';
    if (type === 'snack') {
      const fishB = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshStandardMaterial({ color: '#e8944a', roughness: 0.6 }));
      fishB.scale.set(1.5, 0.7, 0.7);
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.2, 4), new THREE.MeshStandardMaterial({ color: '#d97f35' }));
      tail.rotation.z = Math.PI / 2;
      tail.position.x = -0.3;
      g.add(fishB, tail);
      label = 'Fish snack +20 HP';
    } else if (type === 'milk') {
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.2, 0.16, 12), new THREE.MeshStandardMaterial({ color: '#4a90d9', roughness: 0.4 }));
      const milk = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.06, 12), new THREE.MeshStandardMaterial({ color: '#fffdf5', roughness: 0.3 }));
      milk.position.y = 0.07;
      g.add(bowl, milk);
      label = 'Milk — full heal';
    } else if (type === 'yarn') {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshStandardMaterial({ color: pick(['#e85d75', '#5da8e8', '#9b6bd9']), roughness: 0.8 }));
      const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.03, 6, 14), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8, transparent: true, opacity: 0.5 }));
      wrap.rotation.x = 1.1;
      g.add(ball, wrap);
      label = 'Yarn ball +30 XP';
    }
    // glow ring
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.03, 6, 20),
      new THREE.MeshBasicMaterial({ color: type === 'yarn' ? '#d9a8ff' : '#ffe9a8', transparent: true, opacity: 0.8 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.06;
    g.add(ring);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    pickupGroup.add(g);
    pickups.push({ type, x, y, z, mesh: g, ring, taken: false, label, baseY: y + 0.28 });
  }
  addPickup('yarn', 5.2, -1.9, 4.05);       // bedroom desk... actually dresser side
  addPickup('milk', -3, 4.6, 0.12);         // patio
  addPickup('snack', 8, 30);
  addPickup('yarn', -9.5, 33);
  addPickup('snack', -4, 55);
  addPickup('yarn', 0, 58);                 // risky — dog yard center
  addPickup('snack', 4, 70);
  addPickup('snack', -22, 112);
  addPickup('yarn', 11, 132, hbY + 1.95);   // on the hay bale
  addPickup('snack', 6, 168);
  addPickup('milk', 17.9, 205 + 2.7, groundHeight(16, 205) + 2.75); // barn haystack top
  addPickup('yarn', 13.5, 203.5, groundHeight(16, 205) + 3.75);     // barn loft
  addPickup('snack', -8, 230);
  addPickup('yarn', -2.6, 247.5, groundHeight(-2.5, 247) + 1.35);   // on the big rock
  addPickup('snack', 12, 270);

  // ============================================================ checkpoints
  const checkpoints = [];
  const cpGroup = new THREE.Group();
  scene.add(cpGroup);
  function pawTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.clearRect(0, 0, 128, 128);
    g.fillStyle = '#ffffff';
    const pad = (x, y, rx, ry) => { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); g.fill(); };
    pad(64, 78, 26, 22);
    pad(34, 44, 11, 14); pad(58, 34, 11, 14); pad(82, 36, 11, 14); pad(100, 52, 10, 12);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  const pawTex = pawTexture();
  function addCheckpoint(x, z, name) {
    const gy = Math.max(groundHeight(x, z), 0);
    const g = new THREE.Group();
    g.position.set(x, gy, z);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.3, 0.1, 24),
      new THREE.MeshStandardMaterial({ color: '#1f8a8a', emissive: '#25c2c2', emissiveIntensity: 0.6, roughness: 0.4 }));
    disc.position.y = 0.05;
    const paw = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5),
      new THREE.MeshBasicMaterial({ map: pawTex, transparent: true, opacity: 0.95 }));
    paw.rotation.x = -Math.PI / 2;
    paw.rotation.z = Math.PI;
    paw.position.y = 0.115;
    const ringCk = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.05, 8, 32),
      new THREE.MeshBasicMaterial({ color: '#35e0e0', transparent: true, opacity: 0.7 }));
    ringCk.rotation.x = Math.PI / 2;
    ringCk.position.y = 0.12;
    g.add(disc, paw, ringCk);
    cpGroup.add(g);
    checkpoints.push({ x, y: gy, z, name, mesh: g, disc, ring: ringCk, active: false });
  }
  addCheckpoint(0, 22, 'The Garden');
  addCheckpoint(0, 78.8, 'Front Gate');
  addCheckpoint(0, 103, 'Across the Street');
  addCheckpoint(1, 160, 'Over the Stream');
  addCheckpoint(0, 242, 'The Deep Forest');

  // objective beacon
  const beacon = new THREE.Group();
  {
    const col = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 0.7, 26, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })
    );
    col.position.y = 13;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.06, 8, 28),
      new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.85 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.3;
    beacon.add(col, ring);
    beacon.userData.ring = ring;
    scene.add(beacon);
  }

  // ================================================================== cars
  const carsGroup = new THREE.Group();
  scene.add(carsGroup);
  const carColors = ['#d94f4f', '#4f7dd9', '#e8b23c', '#59b06a', '#e8e4dc', '#333a45'];
  function makeCar() {
    const g = new THREE.Group();
    const color = pick(carColors);
    const bodyM = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.75, 4.2),
      new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.45 }));
    bodyM.position.y = 0.65;
    bodyM.castShadow = true;
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.62, 2.1),
      new THREE.MeshStandardMaterial({ color: '#20242c', roughness: 0.2, metalness: 0.3 }));
    cab.position.set(0, 1.28, -0.2);
    cab.castShadow = true;
    g.add(bodyM, cab);
    const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.26, 12);
    const hubGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.27, 8);
    const wheels = [];
    const tireMat = new THREE.MeshStandardMaterial({ color: '#16181c', roughness: 0.9 });
    const hubMat = new THREE.MeshStandardMaterial({ color: '#9aa2ad', roughness: 0.35, metalness: 0.6 });
    for (const [wx, wz] of [[-0.85, 1.3], [0.85, 1.3], [-0.85, -1.3], [0.85, -1.3]]) {
      const w = new THREE.Group();
      w.position.set(wx, 0.32, wz);
      const tire = new THREE.Mesh(wheelGeo, tireMat);
      const hub = new THREE.Mesh(hubGeo, hubMat);
      tire.rotation.z = hub.rotation.z = Math.PI / 2;
      w.add(tire, hub);
      g.add(w);
      wheels.push(w);
    }
    g.userData.wheels = wheels;
    g.userData.body = bodyM;
    g.userData.cab = cab;
    const lightM = new THREE.MeshStandardMaterial({ color: '#fff6d5', emissive: '#ffe9a0', emissiveIntensity: 1 });
    for (const s of [-1, 1]) {
      const hl = new THREE.Mesh(new THREE.SphereGeometry(0.11, 6, 5), lightM);
      hl.position.set(0.6 * s, 0.7, 2.1);
      g.add(hl);
    }
    return g;
  }
  const lanes = [
    { z: 87.2, dir: 1, next: rand(0.5, 2) },
    { z: 92.8, dir: -1, next: rand(1.5, 3.5) },
  ];
  const cars = [];

  // =================================================================== dog
  const dog = { group: new THREE.Group(), state: 'patrol', wpIdx: 0, biteCool: 0, barkCool: 0, legPhase: 0 };
  {
    const brown = new THREE.MeshStandardMaterial({ color: '#8a5a34', roughness: 0.9 });
    const dark = new THREE.MeshStandardMaterial({ color: '#5f3c20', roughness: 0.9 });
    const bodyD = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.6, 6, 10), brown);
    bodyD.rotation.x = Math.PI / 2;
    bodyD.position.y = 0.52;
    const headD = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), brown);
    headD.position.set(0, 0.72, 0.52);
    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.24), dark);
    snout.position.set(0, 0.66, 0.74);
    dog.legs = [];
    for (const [lx, lz] of [[0.16, 0.32], [-0.16, 0.32], [0.16, -0.3], [-0.16, -0.3]]) {
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.3, 4, 6), dark);
      leg.position.set(lx, 0.25, lz);
      dog.group.add(leg);
      dog.legs.push(leg);
    }
    const earD1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.05), dark);
    earD1.position.set(0.14, 0.9, 0.46);
    const earD2 = earD1.clone(); earD2.position.x = -0.14;
    const tailD = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.3, 4, 6), dark);
    tailD.rotation.x = -0.9;
    tailD.position.set(0, 0.62, -0.55);
    dog.tail = tailD;
    dog.body = bodyD;
    dog.head = headD;
    dog.snout = snout;
    dog.ears = [earD1, earD2];
    dog.group.add(bodyD, headD, snout, earD1, earD2, tailD);
    dog.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    dog.group.position.set(6, 0, 52);
    scene.add(dog.group);
    dog.waypoints = [[6, 48], [-8, 52], [-4, 66], [8, 60]];
    dog.yard = { minX: -12.5, maxX: 12.5, minZ: 40, maxZ: 74.5 };
    dog.sniffT = 0;
  }

  // ============================================================== fetch ball
  // Percy can throw a ball (F) — the dog can't resist chasing it.
  const ball = { mesh: new THREE.Group(), vel: new THREE.Vector3(), active: false, held: false };
  {
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10),
      new THREE.MeshStandardMaterial({ color: '#e8452f', roughness: 0.55 }));
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.022, 6, 18),
      new THREE.MeshStandardMaterial({ color: '#f5f2ea', roughness: 0.6 }));
    band.rotation.x = Math.PI / 2 + 0.5;
    ball.mesh.add(core, band);
    ball.mesh.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    ball.mesh.visible = false;
    scene.add(ball.mesh);
  }
  function throwBall(from, dirX, dirZ) {
    ball.active = true;
    ball.held = false;
    ball.mesh.visible = true;
    ball.mesh.position.set(from.x + dirX * 0.4, from.y + 0.55, from.z + dirZ * 0.4);
    ball.vel.set(dirX * 8.5, 4.8, dirZ * 8.5);
    // a fresh throw resets whatever game the dog was playing
    if (dog.state === 'fetch' || dog.state === 'sniff' || dog.state === 'carry') dog.state = 'patrol';
  }

  // ================================================================== fish
  const fishGroup = new THREE.Group();
  scene.add(fishGroup);
  const fishes = [];
  const FISH_CENTER = new THREE.Vector3(2.6, LAKE_WATER_Y - 0.12, 290.5);
  for (let i = 0; i < 3; i++) {
    const g = new THREE.Group();
    const bodyF = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6),
      new THREE.MeshStandardMaterial({ color: '#5a7d94', roughness: 0.5, transparent: true, opacity: 0.9 }));
    bodyF.scale.set(1, 0.6, 1.8);
    const tailF = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.28, 4),
      new THREE.MeshStandardMaterial({ color: '#4a6a80', transparent: true, opacity: 0.9 }));
    tailF.rotation.x = Math.PI / 2;
    tailF.position.z = -0.48;
    g.add(bodyF, tailF);
    fishGroup.add(g);
    fishes.push({ mesh: g, angle: (i / 3) * TAU, speed: rand(0.5, 0.8), r: rand(1.6, 2.6), caught: false, respawn: 0, tail: tailF });
  }
  // golden pounce ring in the water next to the pier
  const fishRing = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.07, 8, 32),
    new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.9 }));
  fishRing.rotation.x = Math.PI / 2;
  fishRing.position.set(FISH_CENTER.x, LAKE_WATER_Y + 0.06, FISH_CENTER.z);
  scene.add(fishRing);

  // ducks (two on the lake, one on the pond)
  const ducks = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.Group();
    const bodyDk = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), new THREE.MeshStandardMaterial({ color: '#e8e4d8', roughness: 0.8 }));
    bodyDk.scale.set(1, 0.75, 1.35);
    const headDk = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshStandardMaterial({ color: '#3a7d4a', roughness: 0.7 }));
    headDk.position.set(0, 0.3, 0.3);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 6), new THREE.MeshStandardMaterial({ color: '#e8a23c' }));
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 0.28, 0.45);
    g.add(bodyDk, headDk, beak);
    const onPond = i === 2;
    g.position.set(onPond ? 34 + rand(-2, 2) : rand(-8, 8), (onPond ? POND_WATER_Y : LAKE_WATER_Y) + 0.1, (onPond ? 178 : 295) + rand(-4, 4));
    scene.add(g);
    ducks.push({ mesh: g, angle: rand(TAU), t: rand(10), waterY: onPond ? POND_WATER_Y : LAKE_WATER_Y, home: onPond ? [34, 178, 5.5] : [0, 295, 20] });
  }

  // ============================================================ butterflies
  const butterflies = [];
  {
    // wings hinge at the body so they clap above the back like the real thing
    const wingG = new THREE.PlaneGeometry(0.16, 0.22);
    wingG.rotateX(-Math.PI / 2);
    wingG.translate(0.09, 0, 0);
    for (let i = 0; i < 18; i++) {
      const g = new THREE.Group();
      const matB = new THREE.MeshBasicMaterial({ color: pick(['#f2b134', '#e85d75', '#7ab8f5', '#c86bd9']), side: THREE.DoubleSide });
      const p1 = new THREE.Group(), p2 = new THREE.Group();
      p1.add(new THREE.Mesh(wingG, matB));
      const m2 = new THREE.Mesh(wingG, matB);
      m2.scale.x = -1;
      p2.add(m2);
      const bodyB = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.1, 3, 5),
        new THREE.MeshBasicMaterial({ color: '#2c2620' }));
      bodyB.rotation.x = Math.PI / 2;
      g.add(p1, p2, bodyB);
      const x = rand(-55, 55), z = rand(10, 270);
      g.position.set(x, Math.max(groundHeight(x, z), 0) + rand(0.6, 2), z);
      scene.add(g);
      butterflies.push({ g, p1, p2, base: g.position.clone(), t: rand(20), spd: rand(0.5, 1.2), flapPh: rand(TAU) });
    }
  }

  // fireflies (forest & lake, dusk vibes)
  let fireflies;
  {
    const N = 130;
    const posF = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const x = rand(-40, 40), z = rand(215, 330);
      posF[i * 3] = x;
      posF[i * 3 + 1] = Math.max(groundHeight(x, z), LAKE_WATER_Y) + rand(0.4, 2.6);
      posF[i * 3 + 2] = z;
    }
    const gF = new THREE.BufferGeometry();
    gF.setAttribute('position', new THREE.BufferAttribute(posF, 3));
    const mF = new THREE.PointsMaterial({ color: '#ffe98a', size: 0.14, transparent: true, opacity: 0.9, sizeAttenuation: true });
    fireflies = new THREE.Points(gF, mF);
    fireflies.userData.base = posF.slice();
    scene.add(fireflies);
  }

  // clouds — soft, flat-bottomed
  const clouds = [];
  for (let i = 0; i < 14; i++) {
    const g = new THREE.Group();
    const cm = new THREE.MeshStandardMaterial({ color: '#fff6ea', roughness: 1, transparent: true, opacity: 0.85 });
    for (let j = 0; j < randInt(4, 6); j++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(rand(3, 7), 8, 6), cm);
      s.position.set(rand(-7, 7), rand(0, 1.6), rand(-3.5, 3.5));
      s.scale.y = 0.45;
      g.add(s);
    }
    g.scale.setScalar(rand(0.8, 1.5));
    g.position.set(rand(-130, 130), rand(44, 74), rand(-20, 330));
    scene.add(g);
    clouds.push(g);
  }

  // distant hill silhouettes around the horizon
  {
    const hillMat = new THREE.MeshBasicMaterial({ color: '#7a9455', fog: true });
    const hillMat2 = new THREE.MeshBasicMaterial({ color: '#5f7d4a', fog: true });
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * TAU + rand(-0.1, 0.1);
      const rr = rand(240, 300);
      const hx = Math.sin(a) * rr, hz = 155 + Math.cos(a) * rr;
      const hill = new THREE.Mesh(new THREE.ConeGeometry(rand(40, 90), rand(18, 40), 7), i % 2 ? hillMat : hillMat2);
      hill.position.set(hx, -4, hz);
      hill.scale.y = rand(0.5, 1);
      statics.add(hill);
    }
  }

  // birds crossing the sky
  const birds = [];
  for (let i = 0; i < 7; i++) {
    const g = new THREE.Group();
    const mB = new THREE.MeshBasicMaterial({ color: '#2c3440', side: THREE.DoubleSide });
    const w1 = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.28), mB);
    const w2 = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.28), mB);
    w1.position.x = 0.45; w2.position.x = -0.45;
    g.add(w1, w2);
    g.position.set(rand(-80, 80), rand(24, 40), rand(0, 300));
    scene.add(g);
    birds.push({ g, w1, w2, dir: Math.random() < 0.5 ? 1 : -1, spd: rand(4, 7), t: rand(10) });
  }

  // ------------------------------------------------------------ dynamics
  const _v = new THREE.Vector3();
  let elapsed = 0;

  function update(dt, playerPos, cb) {
    elapsed += dt;
    WIND_T.value = elapsed;                 // drives grass, wheat and water shaders
    for (const s of spinners) s.rotation.z += dt * 0.8;

    // foliage sway
    for (const sw of swayers) {
      sw.mesh.position.x = sw.bx + Math.sin(elapsed * 0.9 + sw.ph) * 0.05 * sw.amt;
      sw.mesh.position.z = sw.bz + Math.cos(elapsed * 0.7 + sw.ph * 1.3) * 0.04 * sw.amt;
    }
    // laundry flapping on the line
    for (const sh of sheets) {
      sh.mesh.rotation.x = 0.08 + Math.sin(elapsed * 2.1 + sh.ph) * 0.22 + Math.sin(elapsed * 5.3 + sh.ph * 2) * 0.05;
    }

    // pickups: eased bob, spin, pulsing glow ring
    for (const p of pickups) {
      if (p.taken) continue;
      p.mesh.position.y = p.baseY + Math.sin(elapsed * 1.8 + p.x) * 0.07 + Math.sin(elapsed * 3.4 + p.z) * 0.02;
      p.mesh.rotation.y += dt * 1.6;
      const rs = 1 + Math.sin(elapsed * 2.6 + p.x) * 0.12;
      p.ring.scale.setScalar(rs);
      p.ring.material.opacity = 0.55 + Math.sin(elapsed * 2.6 + p.x) * 0.25;
    }
    // checkpoints: slow spin, breathing ring (calms down once activated)
    for (const cpt of checkpoints) {
      cpt.mesh.rotation.y += dt * (cpt.active ? 0.15 : 0.5);
      const s = cpt.active ? 1 : 1 + Math.sin(elapsed * 3) * 0.08;
      cpt.ring.scale.setScalar(s);
      cpt.ring.material.opacity = cpt.active ? 0.45 : 0.55 + Math.sin(elapsed * 3) * 0.25;
    }
    beacon.userData.ring.scale.setScalar(1 + Math.sin(elapsed * 4) * 0.15);
    beacon.rotation.y += dt * 0.5;

    // ---- cars ----
    for (const lane of lanes) {
      lane.next -= dt;
      if (lane.next <= 0 && cars.length < 8) {
        lane.next = rand(2.2, 5.2);
        const mesh = makeCar();
        mesh.position.set(-84 * lane.dir, 0.05, lane.z);
        // cars travel along X; the model faces +Z, so turn it into the lane
        mesh.rotation.y = lane.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
        carsGroup.add(mesh);
        cars.push({ mesh, dir: lane.dir, speed: rand(9.5, 13.5), z: lane.z, honked: false });
      }
    }
    let nearestCar = 999;
    for (let i = cars.length - 1; i >= 0; i--) {
      const car = cars[i];
      car.mesh.position.x += car.dir * car.speed * dt;
      // rolling wheels + a hint of suspension bounce
      const spin = (car.speed / 0.32) * dt;
      for (const w of car.mesh.userData.wheels) w.rotation.x += spin;
      car.mesh.userData.body.position.y = 0.65 + Math.sin(elapsed * 19 + i * 2.1) * 0.008;
      car.mesh.userData.cab.position.y = 1.28 + Math.sin(elapsed * 19 + i * 2.1 + 0.5) * 0.008;
      const dx = car.mesh.position.x - playerPos.x;
      const dz = car.z - playerPos.z;
      const dist = Math.hypot(dx, dz);
      nearestCar = Math.min(nearestCar, dist);
      // honk when the player is on the road ahead
      if (!car.honked && Math.abs(dz) < 2.2 && Math.abs(dx) < 14 && dx * car.dir < 0) {
        car.honked = true;
        cb.honk();
      }
      // hit check (AABB vs player circle)
      if (Math.abs(dz) < 1.55 && Math.abs(dx) < 2.45 && playerPos.y < 1.6) {
        cb.carHit();
      }
      if (Math.abs(car.mesh.position.x) > 86) {
        carsGroup.remove(car.mesh);
        cars.splice(i, 1);
      }
    }
    cb.carProximity(nearestCar);

    // ---- fetch ball physics ----
    if (ball.active && !ball.held) {
      const bp = ball.mesh.position;
      ball.vel.y -= 19 * dt;
      bp.x += ball.vel.x * dt;
      bp.y += ball.vel.y * dt;
      bp.z += ball.vel.z * dt;
      const water = waterLevelAt(bp.x, bp.z);
      const gy = Math.max(groundHeight(bp.x, bp.z), water === null ? -99 : water) + 0.13;
      if (bp.y <= gy) {
        bp.y = gy;
        if (ball.vel.y < -1.6) {          // bounce
          ball.vel.y = -ball.vel.y * 0.48;
          ball.vel.x *= 0.78;
          ball.vel.z *= 0.78;
        } else {                          // roll out
          ball.vel.y = 0;
          const f = Math.exp(-2.4 * dt);
          ball.vel.x *= f;
          ball.vel.z *= f;
        }
      }
      ball.mesh.rotation.x += Math.hypot(ball.vel.x, ball.vel.z) * dt / 0.13;
    }

    // ---- dog ----
    {
      const dp = dog.group.position;
      const pdx = playerPos.x - dp.x, pdz = playerPos.z - dp.z;
      const pdist = Math.hypot(pdx, pdz);
      const playerInYard = playerPos.x > dog.yard.minX && playerPos.x < dog.yard.maxX &&
        playerPos.z > dog.yard.minZ && playerPos.z < dog.yard.maxZ && playerPos.y < 2;
      dog.biteCool = Math.max(0, dog.biteCool - dt);
      dog.barkCool = Math.max(0, dog.barkCool - dt);

      const bp = ball.mesh.position;
      const ballInReach = ball.active && !ball.held &&
        bp.x > dog.yard.minX - 4 && bp.x < dog.yard.maxX + 4 &&
        bp.z > dog.yard.minZ - 4 && bp.z < dog.yard.maxZ + 4;

      let target, speed;
      if (dog.state === 'sniff') {
        // nose down over the prize
        dog.sniffT -= dt;
        target = [dp.x, dp.z];
        speed = 0;
        if (dog.sniffT <= 0) { dog.state = 'carry'; ball.held = true; }
      } else if (dog.state === 'carry') {
        // trot the ball back to the doghouse
        target = [9, 51.9];
        speed = 3.2;
        if (Math.hypot(9 - dp.x, 51.9 - dp.z) < 1.3) {
          ball.held = false;
          ball.active = false;
          ball.vel.set(0, 0, 0);
          ball.mesh.position.set(dp.x - Math.sin(dog.group.rotation.y) * 0.8,
            Math.max(groundHeight(dp.x, dp.z), 0) + 0.13,
            dp.z - Math.cos(dog.group.rotation.y) * 0.8);
          dog.state = 'patrol';
        }
      } else if (ballInReach) {
        // a thrown ball beats everything — even a cat
        if (dog.state !== 'fetch') { dog.state = 'fetch'; cb.bark(); dog.barkCool = 1.5; }
        target = [clamp(bp.x, dog.yard.minX, dog.yard.maxX), clamp(bp.z, dog.yard.minZ, dog.yard.maxZ)];
        speed = 6.2;
        if (Math.hypot(bp.x - dp.x, bp.z - dp.z) < 0.9) { dog.state = 'sniff'; dog.sniffT = 1.7; }
      } else if (playerInYard && pdist < 14) {
        if (dog.state !== 'chase' && dog.barkCool <= 0) { cb.bark(); dog.barkCool = 2.4; }
        dog.state = 'chase';
        target = [playerPos.x, playerPos.z];
        speed = 5.4;
        if (dog.barkCool <= 0) { cb.bark(); dog.barkCool = rand(2, 3.5); }
      } else {
        dog.state = 'patrol';
        target = dog.waypoints[dog.wpIdx];
        speed = 2.0;
        if (Math.hypot(target[0] - dp.x, target[1] - dp.z) < 1) dog.wpIdx = (dog.wpIdx + 1) % dog.waypoints.length;
      }
      // carried ball rides at the dog's snout
      if (ball.held) {
        ball.mesh.position.set(dp.x + Math.sin(dog.group.rotation.y) * 0.82, 0.62,
          dp.z + Math.cos(dog.group.rotation.y) * 0.82);
      }
      const tdx = target[0] - dp.x, tdz = target[1] - dp.z;
      const tdist = Math.hypot(tdx, tdz);
      let moving = false;
      if (tdist > 0.3) {
        moving = true;
        const vx = (tdx / tdist) * speed, vz = (tdz / tdist) * speed;
        dp.x = clamp(dp.x + vx * dt, dog.yard.minX, dog.yard.maxX);
        dp.z = clamp(dp.z + vz * dt, dog.yard.minZ, dog.yard.maxZ);
        // smooth turn toward travel direction instead of snapping
        const wantYaw = Math.atan2(vx, vz);
        let dy = (wantYaw - dog.group.rotation.y) % TAU;
        if (dy > Math.PI) dy -= TAU;
        if (dy < -Math.PI) dy += TAU;
        dog.group.rotation.y += dy * Math.min(1, dt * 7);
        dog.legPhase += dt * speed * 3;
      }
      // trot: diagonal leg pairs swing + lift, body and head bounce with the gait
      const excited = dog.state === 'chase' || dog.state === 'fetch' || dog.state === 'sniff' || dog.state === 'carry';
      const ph = dog.legPhase;
      const gaitAmp = speed > 4 ? 0.85 : 0.55;
      for (let li = 0; li < 4; li++) {
        // legs [FR, FL, HR, HL] → diagonal pairs (FR+HL, FL+HR)
        const legOff = (li === 0 || li === 3) ? 0 : Math.PI;
        const sw = Math.sin(ph + legOff);
        dog.legs[li].rotation.x = moving ? sw * gaitAmp : 0;
        dog.legs[li].position.y = 0.25 + (moving ? Math.max(0, Math.cos(ph + legOff)) * 0.06 : 0);
      }
      const bounce = moving ? Math.abs(Math.sin(ph)) * (speed > 4 ? 0.06 : 0.03) : Math.sin(elapsed * 2.2) * 0.012;
      dog.body.position.y = 0.52 + bounce;
      // sniffing: nose right down over the ball
      const headDrop = dog.state === 'sniff' ? 0.26 + Math.sin(elapsed * 7) * 0.03 : 0;
      dog.head.position.y = 0.72 + bounce * 0.7 + (moving ? Math.sin(ph * 2) * 0.015 : 0) - headDrop;
      dog.snout.position.y = dog.head.position.y - 0.06;
      // chase/fetch posture: head low and forward, ears pinned; patrol: perky
      dog.head.position.z = excited ? 0.58 : 0.52;
      dog.snout.position.z = dog.head.position.z + 0.22;
      for (let ei = 0; ei < 2; ei++) {
        const flop = moving ? Math.sin(ph + ei * 2) * 0.25 : Math.sin(elapsed * 1.5 + ei) * 0.06;
        dog.ears[ei].rotation.x = (excited ? -0.5 : -0.1) + flop;
        dog.ears[ei].position.y = 0.9 + bounce * 0.7 - headDrop;
      }
      // tail: high and whipping when excited, relaxed wag on patrol
      dog.tail.rotation.x = excited ? -0.35 : -0.9;
      dog.tail.rotation.y = Math.sin(elapsed * (excited ? 16 : 5)) * (excited ? 0.55 : 0.35);
      if (dog.state === 'chase' && pdist < 1.1 && dog.biteCool <= 0 && playerPos.y < 1.4) {
        dog.biteCool = 1.3;
        cb.dogBite(pdx, pdz);
      }
    }

    // ---- fish ----
    for (const f of fishes) {
      if (f.caught) {
        f.respawn -= dt;
        if (f.respawn <= 0) { f.caught = false; f.mesh.visible = true; }
        continue;
      }
      f.angle += f.speed * dt;
      const fx = FISH_CENTER.x + Math.cos(f.angle) * f.r;
      const fz = FISH_CENTER.z + Math.sin(f.angle) * f.r * 1.25;
      f.mesh.position.set(fx, FISH_CENTER.y + Math.sin(elapsed * 2 + f.angle) * 0.05, fz);
      f.mesh.rotation.y = -f.angle + Math.PI;
      f.tail.rotation.y = Math.sin(elapsed * 8 + f.angle) * 0.5;
    }
    fishRing.scale.setScalar(1 + Math.sin(elapsed * 5) * 0.08);

    // ---- ambient life ----
    for (const d of ducks) {
      d.t += dt;
      d.angle += dt * 0.15;
      const dvx = Math.sin(d.angle) * 0.5, dvz = Math.cos(d.angle * 0.7) * 0.4;
      d.mesh.position.x += dvx * dt;
      d.mesh.position.z += dvz * dt;
      // stay on their own water
      const hdx = d.mesh.position.x - d.home[0], hdz = d.mesh.position.z - d.home[1];
      const hd = Math.hypot(hdx, hdz);
      if (hd > d.home[2]) {
        d.mesh.position.x -= (hdx / hd) * (hd - d.home[2]);
        d.mesh.position.z -= (hdz / hd) * (hd - d.home[2]);
      }
      // ride the same swell the water shader draws, plus a paddling waddle
      d.mesh.position.y = d.waterY + 0.1 + Math.sin(elapsed * 1.35 + d.mesh.position.x * 0.55) * 0.035;
      d.mesh.rotation.z = Math.sin(d.t * 3.2) * 0.05;
      if (dvx * dvx + dvz * dvz > 1e-6) {
        const want = Math.atan2(dvx, dvz);
        let dy = (want - d.mesh.rotation.y) % TAU;
        if (dy > Math.PI) dy -= TAU;
        if (dy < -Math.PI) dy += TAU;
        d.mesh.rotation.y += dy * Math.min(1, dt * 2.5);
      }
    }
    for (const b of butterflies) {
      b.t += dt;
      // wings clap up over the back, quick down-stroke
      const flap = 0.25 + Math.sin(b.t * 19 + b.flapPh) * 1.05;
      b.p1.rotation.z = flap;
      b.p2.rotation.z = -flap;
      const px = b.g.position.x, pz = b.g.position.z;
      b.g.position.x = b.base.x + Math.sin(b.t * b.spd) * 1.6;
      b.g.position.z = b.base.z + Math.cos(b.t * b.spd * 0.8) * 1.6;
      // bob synced to the wingbeat + slow wander
      b.g.position.y = b.base.y + Math.sin(b.t * b.spd * 1.7) * 0.5 + Math.sin(b.t * 19 + b.flapPh + 1.2) * 0.03;
      // face the direction of travel
      const mdx = b.g.position.x - px, mdz = b.g.position.z - pz;
      if (mdx * mdx + mdz * mdz > 1e-8) {
        const want = Math.atan2(mdx, mdz);
        let dy = (want - b.g.rotation.y) % TAU;
        if (dy > Math.PI) dy -= TAU;
        if (dy < -Math.PI) dy += TAU;
        b.g.rotation.y += dy * Math.min(1, dt * 5);
      }
    }
    for (const bd of birds) {
      bd.t += dt;
      const flap = Math.sin(bd.t * 9) * 0.7;
      bd.w1.rotation.z = flap;
      bd.w2.rotation.z = -flap;
      bd.g.position.x += bd.dir * bd.spd * dt;
      if (Math.abs(bd.g.position.x) > 110) {
        bd.g.position.x = -110 * bd.dir;
        bd.g.position.z = rand(0, 300);
        bd.g.position.y = rand(24, 40);
      }
      bd.g.rotation.y = bd.dir > 0 ? -Math.PI / 2 : Math.PI / 2;
    }
    for (const cl of clouds) {
      cl.position.x += dt * 0.55;
      if (cl.position.x > 140) cl.position.x = -140;
    }
    if (fireflies) {
      fireflies.material.opacity = 0.55 + Math.sin(elapsed * 2.2) * 0.35;
      // lazy per-point drift so the swarm feels alive
      const arr = fireflies.geometry.attributes.position.array;
      const base = fireflies.userData.base;
      for (let i = 0; i < base.length; i += 3) {
        arr[i] = base[i] + Math.sin(elapsed * 0.6 + i * 1.7) * 0.5;
        arr[i + 1] = base[i + 1] + Math.sin(elapsed * 0.9 + i * 2.3) * 0.3;
        arr[i + 2] = base[i + 2] + Math.cos(elapsed * 0.5 + i * 1.1) * 0.5;
      }
      fireflies.geometry.attributes.position.needsUpdate = true;
    }
  }

  function setBeaconTarget(x, y, z) {
    beacon.position.set(x, y, z);
  }
  function setBeaconVisible(v) { beacon.visible = v; }

  return {
    colliders, pickups, checkpoints, trampolines,
    groundHeight, waterLevelAt, update,
    setBeaconTarget, setBeaconVisible, throwBall, ball,
    dog, cars, fishes, fishRing,
    FISH_CENTER, PIER_END,
    startPos: new THREE.Vector3(-4.4, 3.62, -7.6), // on the bed
    windowPos: new THREE.Vector3(2.1, 4.2, 2.1),
  };
}
