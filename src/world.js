// World builder: terrain, the row house, gardens, street, fields, stream,
// barn, forest and the lake — plus all colliders, hazards and pickups.
import * as THREE from 'three';
import { clamp, lerp, smoothstep, rand, randInt, pick, TAU } from './util.js';

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
  return h;
}

export const STREAM_WATER_Y = -0.62;
export const LAKE_WATER_Y = -0.85;

export function waterLevelAt(x, z) {
  if (Math.abs(z - 150) < 3.4 && groundHeight(x, z) < STREAM_WATER_Y - 0.1) return STREAM_WATER_Y;
  if (Math.hypot(x, z - 295) < 26.5 && groundHeight(x, z) < LAKE_WATER_Y - 0.1) return LAKE_WATER_Y;
  return null;
}

// ------------------------------------------------------------- primitives --
const M = {}; // shared materials
function mats() {
  if (M.done) return M;
  const std = (color, rough = 0.9, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, ...extra });
  M.brick = std('#c96f4a');
  M.brick2 = std('#b3593a');
  M.brick3 = std('#d8a06a');
  M.plaster = std('#efe3cf');
  M.roof = std('#7a4a3a');
  M.roof2 = std('#5d6570');
  M.wood = std('#8a6242');
  M.woodDark = std('#5f4630');
  M.woodLight = std('#c9a36e');
  M.fence = std('#9a7b52');
  M.hedge = std('#3f7d3a');
  M.hedgeDark = std('#356b31');
  M.leaf = std('#4f9143');
  M.leafDark = std('#3c7a38');
  M.pine = std('#2f6b3c');
  M.trunk = std('#6b4a2f');
  M.stone = std('#8d8d94');
  M.road = std('#3d4046', 0.95);
  M.sidewalk = std('#9a9aa0', 0.95);
  M.line = std('#e8e4d8', 0.8);
  M.metal = std('#7d8590', 0.4, { metalness: 0.6 });
  M.white = std('#f5f2ea');
  M.hay = std('#d9b45c');
  M.hayDark = std('#c29c44');
  M.glass = new THREE.MeshStandardMaterial({ color: '#a8d4e8', roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.5 });
  M.done = true;
  return M;
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
    const W = 170, D = 370, SX = 170, SZ = 370;
    const geo = new THREE.PlaneGeometry(W, D, SX, SZ);
    geo.rotateX(-Math.PI / 2);
    const posA = geo.attributes.position;
    const colors = new Float32Array(posA.count * 3);
    const c = new THREE.Color();
    const lawn = new THREE.Color('#5da548');
    const meadow = new THREE.Color('#8fb04e');
    const meadow2 = new THREE.Color('#a8bc55');
    const forest = new THREE.Color('#4a8340');
    const sand = new THREE.Color('#d8c48e');
    const dirt = new THREE.Color('#9c7c50');
    const mud = new THREE.Color('#6f5b3e');
    for (let i = 0; i < posA.count; i++) {
      const x = posA.getX(i);
      let z = posA.getZ(i) + 155; // shift: plane covers z -30..340
      posA.setZ(i, z);
      const h = groundHeight(x, z);
      posA.setY(i, h);
      // base color by zone
      if (z < 100) c.copy(lawn);
      else if (z < 218) c.copy(meadow).lerp(meadow2, Math.abs(Math.sin(x * 0.7 + z * 0.5)));
      else if (z < 262) c.copy(forest);
      else c.copy(meadow);
      // beach + underwater
      const ld = Math.hypot(x, z - 295);
      if (ld < 30) c.lerp(sand, smoothstep(30, 24, ld));
      if (h < LAKE_WATER_Y + 0.1 && ld < 30) c.copy(mud);
      // stream banks
      const sd = Math.abs(z - 150);
      if (sd < 4.5) c.lerp(mud, smoothstep(4.5, 1.5, sd));
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
    const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
    ground.receiveShadow = true;
    statics.add(ground);
  }

  // --------------------------------------------------------------- water
  const waterUpdate = [];
  {
    const waterMat = new THREE.MeshStandardMaterial({
      color: '#4098c8', transparent: true, opacity: 0.78, roughness: 0.15, metalness: 0.1,
    });
    const lake = new THREE.Mesh(new THREE.CircleGeometry(26.5, 48), waterMat);
    lake.rotation.x = -Math.PI / 2;
    lake.position.set(0, LAKE_WATER_Y, 295);
    statics.add(lake);
    const stream = new THREE.Mesh(new THREE.PlaneGeometry(124, 6.6), waterMat.clone());
    stream.material.opacity = 0.7;
    stream.rotation.x = -Math.PI / 2;
    stream.position.set(0, STREAM_WATER_Y, 150);
    statics.add(stream);
    waterUpdate.push((t) => {
      lake.position.y = LAKE_WATER_Y + Math.sin(t * 0.8) * 0.03;
      stream.position.y = STREAM_WATER_Y + Math.sin(t * 1.3 + 1) * 0.02;
    });
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
    // windows + door decor on garden side
    for (const wy of [1.6, 4.4]) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.5, 0.1), M.glass);
      win.position.set(cx - w / 4, wy, 2.06);
      statics.add(win);
      const win2 = win.clone(); win2.position.x = cx + w / 4; statics.add(win2);
    }
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.2, 0.12), M.woodDark);
    door.position.set(cx, 1.1, 2.06);
    statics.add(door);
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
    // open window frame + swung-open pane
    const frame = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.9, 0.12), M.white);
    frame.position.set(2.1, 4.6, 1.99);
    const holeCut = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.6, 0.2), new THREE.MeshBasicMaterial({ color: '#101418' }));
    holeCut.position.set(2.1, 4.6, 1.98);
    statics.add(holeCut, frame);
    const pane = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.7, 0.06), M.glass);
    pane.position.set(3.35, 4.6, 2.55);
    pane.rotation.y = -1.1;
    statics.add(pane);
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
      }
    }
  }
  tree(-9, 20, 1.15);
  tree(10.5, 33, 0.9);

  // ------------------------------------------------------- neighbour yard (dog!)
  // clothesline
  box(-8, 1.1, 46, 0.16, 2.2, 0.16, M.metal, { name: 'pole' });
  box(-2, 1.1, 46, 0.16, 2.2, 0.16, M.metal, { name: 'pole' });
  {
    const line = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 6), M.white);
    line.rotation.z = Math.PI / 2;
    line.position.set(-5, 2.05, 46);
    statics.add(line);
    for (let i = 0; i < 3; i++) {
      const sheet = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.3), new THREE.MeshStandardMaterial({ color: pick(['#fff', '#cfe3f5', '#f5d5cf']), side: THREE.DoubleSide }));
      sheet.position.set(-7 + i * 1.8, 1.4, 46);
      statics.add(sheet);
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
    box(0, -0.06, 82, 120, 0.24, 4.4, M.sidewalk, { name: 'sidewalk', shadow: false });
    box(0, -0.06, 98, 120, 0.24, 4.4, M.sidewalk, { name: 'sidewalk', shadow: false });
    const road = new THREE.Mesh(new THREE.PlaneGeometry(120, 11.6), M.road);
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0.02, 90);
    road.receiveShadow = true;
    statics.add(road);
    for (let x = -58; x < 60; x += 4) {
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(2, 0.3), M.line);
      dash.rotation.x = -Math.PI / 2;
      dash.rotation.z = Math.PI / 2;
      dash.position.set(x, 0.03, 90);
      statics.add(dash);
    }
    // lamp posts
    for (const [lx, lz] of [[-12, 84.5], [12, 95.5], [-36, 95.5], [36, 84.5]]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 4.6, 8), M.metal);
      post.position.set(lx, 2.3, lz);
      post.castShadow = true;
      statics.add(post);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshStandardMaterial({ color: '#fff2c0', emissive: '#ffdf8a', emissiveIntensity: 0.7 }));
      lamp.position.set(lx, 4.6, lz);
      statics.add(lamp);
      cylinderCollider(lx, lz, 0.14, 0, 4.4);
    }
    // parked car on the far side
    box(-20, 0.62, 97.6, 1.9, 1.1, 4.2, new THREE.MeshStandardMaterial({ color: '#7d4a8f', roughness: 0.4, metalness: 0.4 }), { name: 'parked' });
    box(-20, 1.35, 97.2, 1.7, 0.6, 2.2, M.glass, { noCollide: true });
  }

  // ------------------------------------------------------------- fields
  // sunflower patch
  for (let i = 0; i < 26; i++) {
    const x = rand(-30, -12), z = rand(108, 130);
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
  }

  // ------------------------------------------------------------- grass (instanced)
  {
    const blade = new THREE.ConeGeometry(0.06, 0.55, 4);
    blade.translate(0, 0.24, 0);
    const gmat = new THREE.MeshStandardMaterial({ color: '#79a83f', roughness: 1 });
    const COUNT = 2600;
    const inst = new THREE.InstancedMesh(blade, gmat, COUNT);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const eu = new THREE.Euler();
    const col = new THREE.Color();
    let n = 0, guard = 0;
    while (n < COUNT && guard++ < 20000) {
      const x = rand(-55, 55), z = rand(100, 268);
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
  box(0, 4, -19, 140, 12, 1, M.hedge, { noMesh: true });
  box(0, 4, 330, 140, 12, 1, M.hedge, { noMesh: true });
  box(-58, 4, 155, 1, 12, 360, M.hedge, { noMesh: true });
  box(58, 4, 155, 1, 12, 360, M.hedge, { noMesh: true });
  // visible bushes along field bounds
  for (let z = 104; z < 326; z += rand(7, 12)) {
    for (const s of [-1, 1]) {
      const x = 56.5 * s + rand(-1.5, 1.5);
      const b = new THREE.Mesh(new THREE.SphereGeometry(rand(1.6, 3), 8, 6), Math.random() < 0.5 ? M.hedge : M.hedgeDark);
      b.position.set(x, groundHeight(x, z) + 0.6, z);
      b.castShadow = true;
      statics.add(b);
    }
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
    for (const [wx, wz] of [[-0.85, 1.3], [0.85, 1.3], [-0.85, -1.3], [0.85, -1.3]]) {
      const w = new THREE.Mesh(wheelGeo, new THREE.MeshStandardMaterial({ color: '#16181c', roughness: 0.9 }));
      w.rotation.z = Math.PI / 2;
      w.position.set(wx, 0.32, wz);
      g.add(w);
    }
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
    dog.group.add(bodyD, headD, snout, earD1, earD2, tailD);
    dog.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    dog.group.position.set(6, 0, 52);
    scene.add(dog.group);
    dog.waypoints = [[6, 48], [-8, 52], [-4, 66], [8, 60]];
    dog.yard = { minX: -12.5, maxX: 12.5, minZ: 40, maxZ: 74.5 };
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

  // ducks
  const ducks = [];
  for (let i = 0; i < 2; i++) {
    const g = new THREE.Group();
    const bodyDk = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), new THREE.MeshStandardMaterial({ color: '#e8e4d8', roughness: 0.8 }));
    bodyDk.scale.set(1, 0.75, 1.35);
    const headDk = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshStandardMaterial({ color: '#3a7d4a', roughness: 0.7 }));
    headDk.position.set(0, 0.3, 0.3);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 6), new THREE.MeshStandardMaterial({ color: '#e8a23c' }));
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 0.28, 0.45);
    g.add(bodyDk, headDk, beak);
    g.position.set(rand(-8, 8), LAKE_WATER_Y + 0.1, 295 + rand(-6, 6));
    scene.add(g);
    ducks.push({ mesh: g, angle: rand(TAU), t: rand(10) });
  }

  // ============================================================ butterflies
  const butterflies = [];
  {
    const wingG = new THREE.PlaneGeometry(0.16, 0.22);
    for (let i = 0; i < 12; i++) {
      const g = new THREE.Group();
      const matB = new THREE.MeshBasicMaterial({ color: pick(['#f2b134', '#e85d75', '#7ab8f5', '#c86bd9']), side: THREE.DoubleSide });
      const w1 = new THREE.Mesh(wingG, matB);
      const w2 = new THREE.Mesh(wingG, matB);
      w1.position.x = 0.08; w2.position.x = -0.08;
      g.add(w1, w2);
      const x = rand(-30, 30), z = rand(10, 260);
      g.position.set(x, Math.max(groundHeight(x, z), 0) + rand(0.6, 2), z);
      scene.add(g);
      butterflies.push({ g, w1, w2, base: g.position.clone(), t: rand(20), spd: rand(0.5, 1.2) });
    }
  }

  // fireflies (forest & lake, dusk vibes)
  let fireflies;
  {
    const N = 90;
    const posF = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const x = rand(-25, 25), z = rand(220, 315);
      posF[i * 3] = x;
      posF[i * 3 + 1] = Math.max(groundHeight(x, z), LAKE_WATER_Y) + rand(0.4, 2.6);
      posF[i * 3 + 2] = z;
    }
    const gF = new THREE.BufferGeometry();
    gF.setAttribute('position', new THREE.BufferAttribute(posF, 3));
    const mF = new THREE.PointsMaterial({ color: '#ffe98a', size: 0.14, transparent: true, opacity: 0.9, sizeAttenuation: true });
    fireflies = new THREE.Points(gF, mF);
    scene.add(fireflies);
  }

  // clouds
  const clouds = [];
  for (let i = 0; i < 9; i++) {
    const g = new THREE.Group();
    const cm = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, transparent: true, opacity: 0.92 });
    for (let j = 0; j < randInt(3, 5); j++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(rand(3, 6.5), 8, 6), cm);
      s.position.set(rand(-6, 6), rand(-1, 1.4), rand(-3, 3));
      s.scale.y = 0.55;
      g.add(s);
    }
    g.position.set(rand(-120, 120), rand(46, 72), rand(-20, 330));
    scene.add(g);
    clouds.push(g);
  }

  // birds crossing the sky
  const birds = [];
  for (let i = 0; i < 4; i++) {
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
    for (const f of waterUpdate) f(elapsed);
    for (const s of spinners) s.rotation.z += dt * 0.8;

    // pickups bob + spin
    for (const p of pickups) {
      if (p.taken) continue;
      p.mesh.position.y = p.baseY + Math.sin(elapsed * 2 + p.x) * 0.08;
      p.mesh.rotation.y += dt * 1.4;
    }
    // checkpoints pulse
    for (const cpt of checkpoints) {
      const s = 1 + Math.sin(elapsed * 3) * 0.06;
      cpt.ring.scale.setScalar(s);
    }
    beacon.userData.ring.scale.setScalar(1 + Math.sin(elapsed * 4) * 0.15);
    beacon.rotation.y += dt * 0.5;

    // ---- cars ----
    for (const lane of lanes) {
      lane.next -= dt;
      if (lane.next <= 0 && cars.length < 8) {
        lane.next = rand(2.2, 5.2);
        const mesh = makeCar();
        mesh.position.set(-66 * lane.dir, 0.05, lane.z);
        mesh.rotation.y = lane.dir > 0 ? 0 : Math.PI;
        carsGroup.add(mesh);
        cars.push({ mesh, dir: lane.dir, speed: rand(9.5, 13.5), z: lane.z, honked: false });
      }
    }
    let nearestCar = 999;
    for (let i = cars.length - 1; i >= 0; i--) {
      const car = cars[i];
      car.mesh.position.x += car.dir * car.speed * dt;
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
      if (Math.abs(car.mesh.position.x) > 68) {
        carsGroup.remove(car.mesh);
        cars.splice(i, 1);
      }
    }
    cb.carProximity(nearestCar);

    // ---- dog ----
    {
      const dp = dog.group.position;
      const pdx = playerPos.x - dp.x, pdz = playerPos.z - dp.z;
      const pdist = Math.hypot(pdx, pdz);
      const playerInYard = playerPos.x > dog.yard.minX && playerPos.x < dog.yard.maxX &&
        playerPos.z > dog.yard.minZ && playerPos.z < dog.yard.maxZ && playerPos.y < 2;
      dog.biteCool = Math.max(0, dog.biteCool - dt);
      dog.barkCool = Math.max(0, dog.barkCool - dt);

      let target, speed;
      if (playerInYard && pdist < 14) {
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
      const tdx = target[0] - dp.x, tdz = target[1] - dp.z;
      const tdist = Math.hypot(tdx, tdz);
      if (tdist > 0.3) {
        const vx = (tdx / tdist) * speed, vz = (tdz / tdist) * speed;
        dp.x = clamp(dp.x + vx * dt, dog.yard.minX, dog.yard.maxX);
        dp.z = clamp(dp.z + vz * dt, dog.yard.minZ, dog.yard.maxZ);
        dog.group.rotation.y = Math.atan2(vx, vz);
        dog.legPhase += dt * speed * 3;
        for (let li = 0; li < 4; li++) {
          dog.legs[li].rotation.x = Math.sin(dog.legPhase + (li % 2) * Math.PI) * 0.6;
        }
      }
      dog.tail.rotation.y = Math.sin(elapsed * (dog.state === 'chase' ? 14 : 5)) * 0.4;
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
      d.mesh.position.x += Math.sin(d.angle) * dt * 0.5;
      d.mesh.position.z += Math.cos(d.angle * 0.7) * dt * 0.4;
      d.mesh.position.y = LAKE_WATER_Y + 0.1 + Math.sin(d.t * 2) * 0.03;
      d.mesh.rotation.y = Math.sin(d.angle) * 0.8;
    }
    for (const b of butterflies) {
      b.t += dt;
      const flap = Math.sin(b.t * 18) * 0.9;
      b.w1.rotation.y = flap;
      b.w2.rotation.y = -flap;
      b.g.position.x = b.base.x + Math.sin(b.t * b.spd) * 1.6;
      b.g.position.y = b.base.y + Math.sin(b.t * b.spd * 1.7) * 0.5;
      b.g.position.z = b.base.z + Math.cos(b.t * b.spd * 0.8) * 1.6;
      b.g.rotation.y = b.t * 0.5;
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
    }
  }

  function setBeaconTarget(x, y, z) {
    beacon.position.set(x, y, z);
  }
  function setBeaconVisible(v) { beacon.visible = v; }

  return {
    colliders, pickups, checkpoints, trampolines,
    groundHeight, waterLevelAt, update,
    setBeaconTarget, setBeaconVisible,
    dog, cars, fishes, fishRing,
    FISH_CENTER, PIER_END,
    startPos: new THREE.Vector3(-4.4, 3.62, -7.6), // on the bed
    windowPos: new THREE.Vector3(2.1, 4.2, 2.1),
  };
}
