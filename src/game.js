// Core game: renderer, camera, character physics, gameplay state and HUD.
import * as THREE from 'three';
import { clamp, lerp, dampAngle, rand, TAU, formatTime } from './util.js';
import { createCat } from './cat.js';
import { buildWorld, groundHeight, waterLevelAt, LAKE_WATER_Y } from './world.js';

const GRAV = 21;
const WALK = 3.4, RUN = 6.6, SWIM = 2.1;
const JUMP_V = 7.7, DJUMP_V = 5.8;
const PLAYER_R = 0.32;
const STEP_UP = 0.52;

const OBJECTIVES = [
  'Escape through the open bedroom window',
  'Reach the garden checkpoint',
  'Over the back fence — beware of the dog!',
  'Cross the street. Watch for cars!',
  'Cross the fields and the stream',
  'Through the dark forest',
  'Reach the pier at the lake',
  'Pounce! Catch 3 fish',
];

export class Game {
  constructor(canvas, audio, hooks) {
    this.canvas = canvas;
    this.audio = audio;
    this.hooks = hooks; // { onDeath, onWin, onCheckpoint, onToast, onLevelUp, onSaveChanged }
    this.state = 'title'; // title | playing | dead | won
    this.paused = false;
    this.settings = { sensitivity: 1, invertY: false, quality: 'high', palette: 'percy' };

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xf5c99a, 70, 300);
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 600);
    this.camYaw = Math.PI;      // look toward -Z initially (into the bedroom)
    this.camPitch = -0.18;
    this.camDist = 4.3;

    this._setupLights();
    this._setupSky();

    this.world = buildWorld(this.scene);
    this.cat = null;
    this._makeCat('percy');

    // player state
    this.pos = this.world.startPos.clone();
    this.vel = new THREE.Vector3();
    this.facing = Math.PI;
    this.grounded = true;
    this.climbing = false;
    this.swimming = false;
    this.canDouble = true;
    this.coyote = 0;
    this.idleTime = 0;
    this.invuln = 0;
    this.pounceT = 0;
    this.timeScale = 1;
    this.slowT = 0;

    // run stats
    this.hp = 100; this.maxHp = 100;
    this.xp = 0; this.level = 1;
    this.yarn = 0; this.fish = 0;
    this.lives = 9; this.deaths = 0;
    this.runTime = 0;
    this.cpIdx = -1; // last activated checkpoint (-1 = start)
    this.snapshot = null;

    this.keys = {};
    this.touch = { move: { x: 0, y: 0 }, cam: { x: 0, y: 0 }, jump: false, sprint: false };
    this._bindInput();

    this.particles = new ParticlePool(this.scene);
    this._footT = 0;
    this._purring = false;
    this._clock = new THREE.Clock();
    this._camPos = new THREE.Vector3(0, 6, -14);
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();

    this.hud = {};
    for (const id of ['hpFill', 'hpText', 'xpFill', 'levelText', 'objective', 'distance', 'yarnCount', 'livesCount', 'prompt', 'damageFlash', 'fishHud', 'fishCount', 'timer']) {
      this.hud[id] = document.getElementById(id);
    }

    window.addEventListener('resize', () => this._resize());
    this._resize();
    this.renderer.setAnimationLoop(() => this._frame());
  }

  // ------------------------------------------------------------- setup
  _setupLights() {
    this.hemi = new THREE.HemisphereLight(0xbdd6f5, 0x7a8a5a, 0.75);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffd9a3, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const c = this.sun.shadow.camera;
    c.left = -42; c.right = 42; c.top = 42; c.bottom = -42;
    c.near = 1; c.far = 160;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.06;
    this.scene.add(this.sun, this.sun.target);
    this.amb = new THREE.AmbientLight(0xffe6c8, 0.18);
    this.scene.add(this.amb);
    // cozy warm lamp inside the bedroom
    const lamp = new THREE.PointLight(0xffd9a0, 22, 18, 1.8);
    lamp.position.set(0, 5.4, -4);
    this.scene.add(lamp);
  }

  _setupSky() {
    const geo = new THREE.SphereGeometry(480, 24, 15);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x3a7bd5) },
        midColor: { value: new THREE.Color(0xf7b267) },
        botColor: { value: new THREE.Color(0xf5c99a) },
        sunDir: { value: new THREE.Vector3(0.5, 0.22, -0.8).normalize() },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 topColor; uniform vec3 midColor; uniform vec3 botColor; uniform vec3 sunDir;
        varying vec3 vDir;
        void main() {
          float h = clamp(vDir.y, -1.0, 1.0);
          vec3 col = h > 0.12 ? mix(midColor, topColor, smoothstep(0.12, 0.65, h))
                              : mix(botColor, midColor, smoothstep(-0.05, 0.12, h));
          float s = pow(max(dot(normalize(vDir), sunDir), 0.0), 90.0);
          col += vec3(1.0, 0.85, 0.6) * s * 1.4;
          float glow = pow(max(dot(normalize(vDir), sunDir), 0.0), 6.0);
          col += vec3(0.9, 0.5, 0.2) * glow * 0.35;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const sky = new THREE.Mesh(geo, mat);
    sky.frustumCulled = false;
    this.scene.add(sky);
    this._sky = sky;
    this.renderer.setClearColor(0xf5c99a);

    // soft sun billboard riding on the sky dome
    const sunCanvas = document.createElement('canvas');
    sunCanvas.width = sunCanvas.height = 128;
    const sg = sunCanvas.getContext('2d');
    const grad = sg.createRadialGradient(64, 64, 6, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,248,225,1)');
    grad.addColorStop(0.25, 'rgba(255,226,150,0.9)');
    grad.addColorStop(0.6, 'rgba(255,180,90,0.35)');
    grad.addColorStop(1, 'rgba(255,160,70,0)');
    sg.fillStyle = grad;
    sg.fillRect(0, 0, 128, 128);
    const sunTex = new THREE.CanvasTexture(sunCanvas);
    sunTex.colorSpace = THREE.SRGBColorSpace;
    const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, transparent: true, depthWrite: false, fog: false }));
    sunSprite.scale.setScalar(160);
    sunSprite.position.set(0.5, 0.22, -0.8).normalize().multiplyScalar(430);
    sky.add(sunSprite);
  }

  _makeCat(palette) {
    if (this.cat) this.scene.remove(this.cat.group);
    this.cat = createCat(palette);
    this.scene.add(this.cat.group);
  }

  setPalette(p) {
    this.settings.palette = p;
    this._makeCat(p);
  }

  applyQuality(q) {
    this.settings.quality = q;
    const dpr = window.devicePixelRatio || 1;
    const cap = q === 'low' ? 1 : q === 'medium' ? 1.5 : 2;
    this.renderer.setPixelRatio(Math.min(dpr, cap));
    this.sun.castShadow = q !== 'low';
    this.sun.shadow.mapSize.set(q === 'high' ? 2048 : 1024, q === 'high' ? 2048 : 1024);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this._resize();
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  // ------------------------------------------------------------- input
  _bindInput() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys[e.code] = true;
      if (this.state !== 'playing' || this.paused) return;
      if (e.code === 'Space') { this._jumpPressed(); e.preventDefault(); }
      if (e.code === 'KeyM') { this.audio.meow(); }
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    window.addEventListener('blur', () => { this.keys = {}; });

    this.canvas.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== this.canvas) return;
      const s = 0.0022 * this.settings.sensitivity;
      this.camYaw -= e.movementX * s;
      this.camPitch += e.movementY * s * (this.settings.invertY ? 1 : -1);
      this.camPitch = clamp(this.camPitch, -1.15, 0.7);
    });
  }

  _jumpPressed() {
    // fishing pounce takes priority at the pier
    if (this._atFishingSpot() && this.grounded) { this._pounce(); return; }
    if (this.swimming) { this.vel.y = 4.5; return; }
    if (this.climbing) {
      // leap off the wall
      this.vel.y = 6.5;
      this.vel.x = -Math.sin(this.facing) * 3.5;
      this.vel.z = -Math.cos(this.facing) * 3.5;
      this.climbing = false;
      this.audio.jump();
      return;
    }
    if (this.grounded || this.coyote > 0) {
      this.vel.y = JUMP_V;
      this.grounded = false;
      this.coyote = 0;
      this.canDouble = true;
      this.audio.jump();
      this.particles.burst(this.pos.x, this.pos.y + 0.05, this.pos.z, 6, 0xcdb891, 0.5);
    } else if (this.canDouble) {
      this.vel.y = DJUMP_V;
      this.canDouble = false;
      this.audio.doubleJump();
      this.particles.burst(this.pos.x, this.pos.y + 0.2, this.pos.z, 8, 0xffffff, 0.7);
    }
  }

  // --------------------------------------------------------- run control
  newRun() {
    this.hp = 100; this.maxHp = 100;
    this.xp = 0; this.level = 1; this.yarn = 0; this.fish = 0;
    this.lives = 9; this.deaths = 0; this.runTime = 0;
    this.cpIdx = -1;
    for (const p of this.world.pickups) { p.taken = false; p.mesh.visible = true; }
    for (const c of this.world.checkpoints) {
      c.active = false;
      c.disc.material.emissive.set('#25c2c2');
      c.disc.material.color.set('#1f8a8a');
    }
    this.pos.copy(this.world.startPos);
    this.vel.set(0, 0, 0);
    this.facing = Math.PI;
    this.camYaw = Math.PI + 0.4;
    this.camPitch = -0.12;
    this.snapshot = this._makeSnapshot();
    this.state = 'playing';
    this.paused = false;
    this.invuln = 1;
    this._syncHud(true);
  }

  loadRun(save) {
    this.newRun();
    this.hp = save.hp; this.maxHp = save.maxHp;
    this.xp = save.xp; this.level = save.level;
    this.yarn = save.yarn; this.fish = save.fish || 0;
    this.lives = save.lives; this.deaths = save.deaths;
    this.runTime = save.runTime;
    this.cpIdx = save.cpIdx;
    for (const p of this.world.pickups) {
      if (save.taken.includes(this._pickupId(p))) { p.taken = true; p.mesh.visible = false; }
    }
    for (let i = 0; i <= save.cpIdx && i < this.world.checkpoints.length; i++) {
      this._markCheckpoint(this.world.checkpoints[i]);
    }
    this.pos.set(save.x, save.y, save.z);
    this.vel.set(0, 0, 0);
    this.snapshot = this._makeSnapshot();
    this._syncHud(true);
  }

  _pickupId(p) { return `${p.type}:${p.x.toFixed(1)}:${p.z.toFixed(1)}`; }

  _makeSnapshot() {
    return {
      x: this.pos.x, y: this.pos.y, z: this.pos.z,
      hp: Math.max(this.hp, 40), maxHp: this.maxHp,
      xp: this.xp, level: this.level, yarn: this.yarn, fish: this.fish,
      lives: this.lives, deaths: this.deaths, runTime: this.runTime,
      cpIdx: this.cpIdx,
      taken: this.world.pickups.filter((p) => p.taken).map((p) => this._pickupId(p)),
    };
  }

  respawn() {
    const s = this.snapshot;
    this.pos.set(s.x, s.y + 0.1, s.z);
    this.vel.set(0, 0, 0);
    this.hp = s.hp; this.maxHp = s.maxHp;
    // restore pickups collected after the snapshot
    for (const p of this.world.pickups) {
      const wasTaken = s.taken.includes(this._pickupId(p));
      p.taken = wasTaken;
      p.mesh.visible = !wasTaken;
    }
    this.xp = s.xp; this.level = s.level; this.yarn = s.yarn; this.fish = s.fish;
    this.state = 'playing';
    this.paused = false;
    this.invuln = 2.2;
    this.timeScale = 1;
    this.swimming = false; this.climbing = false;
    this._syncHud(true);
  }

  setPaused(p) {
    this.paused = p;
    if (p) this.audio.suspend(); else this.audio.resume();
  }

  // ------------------------------------------------------------- damage
  hurt(dmg, reason) {
    if (this.invuln > 0 || this.state !== 'playing') return;
    this.hp -= dmg;
    this.audio.hurt();
    this._flashDamage();
    if (this.hp <= 0) this._die(reason);
    else this.invuln = 0.8;
    this._syncHud();
  }

  _flashDamage() {
    const el = this.hud.damageFlash;
    el.classList.remove('active');
    void el.offsetWidth;
    el.classList.add('active');
  }

  _die(reason) {
    if (this.state !== 'playing') return;
    this.hp = 0;
    this.state = 'dead';
    this.deaths++;
    this.lives--;
    if (this.lives <= 0) this.lives = 9;
    this.timeScale = 0.3;
    this.slowT = 1.3;
    this.audio.death();
    this.audio.purr(false);
    const reasons = {
      car: 'Percy got hit by a car…',
      dog: 'The dog got Percy…',
      drown: 'Percy is not a fan of deep water…',
      fall: 'Percy fell a little too hard…',
    };
    setTimeout(() => this.hooks.onDeath(reasons[reason] || 'Percy ran out of luck…', this.lives), 1500);
  }

  addXp(n) {
    this.xp += n;
    const newLevel = Math.floor(this.xp / 100) + 1;
    if (newLevel > this.level) {
      this.level = newLevel;
      this.maxHp += 10;
      this.hp = this.maxHp;
      this.audio.levelUp();
      this.hooks.onLevelUp(this.level);
    }
    this._syncHud();
  }

  // ------------------------------------------------------------ fishing
  _atFishingSpot() {
    return this.cpIdx >= 4 && this.fish < 3 &&
      this.pos.distanceTo(this.world.PIER_END) < 2.6;
  }

  _pounce() {
    this.pounceT = 0.5;
    this.audio.pounce();
    this.vel.y = 4.2;
    const ringC = this.world.FISH_CENTER;
    setTimeout(() => {
      if (this.state !== 'playing') return;
      let caught = false;
      for (const f of this.world.fishes) {
        if (f.caught) continue;
        const d = Math.hypot(f.mesh.position.x - ringC.x, f.mesh.position.z - ringC.z);
        if (d < 1.5) {
          f.caught = true; f.respawn = 6; f.mesh.visible = false;
          caught = true;
          break;
        }
      }
      this.particles.burst(ringC.x, LAKE_WATER_Y + 0.2, ringC.z, 18, 0x8ecdf0, 1.2);
      if (caught) {
        this.fish++;
        this.audio.fishCatch();
        this.addXp(50);
        this.hooks.onToast(`🐟 Fish caught! ${this.fish}/3`);
        this._syncHud();
        if (this.fish >= 3) this._winSequence();
      } else {
        this.audio.splash();
        this.hooks.onToast('Splash! The fish got away…');
      }
    }, 420);
  }

  _winSequence() {
    this.state = 'won';
    this.audio.win();
    this.audio.purr(true);
    setTimeout(() => {
      this.audio.purr(false);
      this.hooks.onWin({
        time: formatTime(this.runTime),
        deaths: this.deaths,
        xp: this.xp,
        level: this.level,
        yarn: this.yarn,
      });
    }, 1800);
  }

  // ------------------------------------------------------------- frame
  _frame() {
    let dt = Math.min(this._clock.getDelta(), 0.05);
    const realDt = dt;
    if (this.slowT > 0) {
      this.slowT -= realDt;
      if (this.slowT <= 0) this.timeScale = this.state === 'dead' ? 0.12 : 1;
    }
    dt *= this.timeScale;

    if (!this.paused) {
      if (this.state === 'playing') {
        this.runTime += dt;
        this._stepPlayer(dt);
        this._checkTriggers();
      }
      if (this.state === 'dead') this._stepDead(dt);
      if (this.state === 'won') this._stepWon(realDt);
      if (this.state === 'title') this._stepTitle(realDt);
      this.world.update(dt, this.pos, this._worldCallbacks());
      this._updateCatVisual(realDt);
      this.particles.update(realDt);
      this._updateCamera(realDt);
      this._updateSunFollow();
      if (this.state === 'playing') this._syncHudFrame();
    }
    this.renderer.render(this.scene, this.camera);
  }

  _worldCallbacks() {
    if (!this._wcb) {
      this._wcb = {
        carHit: () => { if (this.invuln <= 0 && this.state === 'playing') this._die('car'); },
        honk: () => this.audio.honk(),
        bark: () => this.audio.bark(),
        carProximity: (d) => this.audio.carProximity(d),
        dogBite: (dx, dz) => {
          if (this.state !== 'playing') return;
          const d = Math.hypot(dx, dz) || 1;
          this.vel.x = (dx / d) * 7;
          this.vel.z = (dz / d) * 7;
          this.vel.y = 5;
          this.grounded = false;
          this.hurt(35, 'dog');
        },
      };
    }
    return this._wcb;
  }

  _stepTitle(dt) {
    // cat sits on the bed; camera slowly orbits the bedroom
    this.cat.group.position.copy(this.world.startPos);
    this.cat.group.rotation.y = Math.PI + 0.6;
    this.cat.update(dt, { mode: 'sit', speed: 0, grounded: true });
    const t = performance.now() * 0.00012;
    const cx = -4.4 + Math.sin(t) * 3.4;
    const cz = -4.5 + Math.cos(t * 0.8) * 2.6;
    this._camPos.set(cx, 4.6 + Math.sin(t * 1.7) * 0.4, cz);
    this.camera.position.copy(this._camPos);
    this.camera.lookAt(-4.4, 3.9, -7.6);
  }

  _stepDead(dt) {
    // gentle physics so the body settles
    this.vel.y -= GRAV * dt;
    this.pos.y += this.vel.y * dt;
    const support = this._supportHeight();
    if (this.pos.y <= support) { this.pos.y = support; this.vel.y = 0; }
  }

  _stepWon(dt) {
    this.cat.group.position.copy(this.pos);
    this.cat.update(dt, { mode: 'sit', speed: 0, grounded: true });
  }

  // ------------------------------------------------------------ physics
  _moveInput() {
    let x = 0, z = 0;
    if (this.keys.KeyW || this.keys.ArrowUp) z += 1;
    if (this.keys.KeyS || this.keys.ArrowDown) z -= 1;
    if (this.keys.KeyA || this.keys.ArrowLeft) x -= 1;
    if (this.keys.KeyD || this.keys.ArrowRight) x += 1;
    x += this.touch.move.x;
    z += this.touch.move.y;
    const len = Math.hypot(x, z);
    if (len > 1) { x /= len; z /= len; }
    return { x, z, len: Math.min(len, 1) };
  }

  _supportHeight() {
    const { x, z } = this.pos;
    let support = groundHeight(x, z);
    const feet = this.pos.y;
    const stepAllow = this.grounded ? STEP_UP : 0.18;
    for (const c of this.world.colliders) {
      if (x + PLAYER_R * 0.6 < c.minX || x - PLAYER_R * 0.6 > c.maxX) continue;
      if (z + PLAYER_R * 0.6 < c.minZ || z - PLAYER_R * 0.6 > c.maxZ) continue;
      if (c.maxY <= feet + stepAllow && c.maxY > support) support = c.maxY;
    }
    for (const tr of this.world.trampolines) {
      if (Math.hypot(x - tr.x, z - tr.z) < tr.r && tr.y <= feet + stepAllow && tr.y > support) support = tr.y;
    }
    return support;
  }

  _stepPlayer(dt) {
    const input = this._moveInput();
    this.invuln = Math.max(0, this.invuln - dt);
    this.coyote = Math.max(0, this.coyote - dt);
    this.pounceT = Math.max(0, this.pounceT - dt);

    // touch camera
    this.camYaw -= this.touch.cam.x * dt * 2.4 * this.settings.sensitivity;
    this.camPitch = clamp(this.camPitch - this.touch.cam.y * dt * 1.8 * (this.settings.invertY ? -1 : 1), -1.15, 0.7);

    const sprint = this.keys.ShiftLeft || this.keys.ShiftRight || this.touch.sprint;
    const speedCap = this.swimming ? SWIM : sprint ? RUN : WALK;

    // desired velocity in camera space
    const sin = Math.sin(this.camYaw), cos = Math.cos(this.camYaw);
    const wishX = (input.x * cos + input.z * sin);
    const wishZ = (-input.x * sin + input.z * cos);
    const accel = this.grounded ? 14 : 5.5;
    this.vel.x = lerp(this.vel.x, wishX * speedCap * input.len, 1 - Math.exp(-accel * dt));
    this.vel.z = lerp(this.vel.z, wishZ * speedCap * input.len, 1 - Math.exp(-accel * dt));

    // facing follows movement
    const hSpeed = Math.hypot(this.vel.x, this.vel.z);
    if (hSpeed > 0.4) this.facing = dampAngle(this.facing, Math.atan2(this.vel.x, this.vel.z), 12, dt);

    // water check
    const water = waterLevelAt(this.pos.x, this.pos.z);
    const wasSwimming = this.swimming;
    this.swimming = water !== null && this.pos.y < water - 0.22 && !this.climbing;
    if (this.swimming && !wasSwimming) {
      this.audio.splash();
      this.particles.burst(this.pos.x, water, this.pos.z, 14, 0x8ecdf0, 1);
    }

    if (this.swimming) {
      // buoyancy
      const targetY = water - 0.3;
      this.vel.y = lerp(this.vel.y, (targetY - this.pos.y) * 6, 1 - Math.exp(-8 * dt));
      this.hp -= 5 * dt;
      if (this.hp <= 0) { this._die('drown'); return; }
      this.grounded = false;
      this.climbing = false;
    } else {
      // climbing: pressing into a climbable wall
      if (this.climbing) {
        if (input.len < 0.1) this.climbing = false;
        this.vel.y = 2.9;
        this.vel.x *= 0.25;
        this.vel.z *= 0.25;
        this._footT += dt;
        if (this._footT > 0.28) { this._footT = 0; this.audio.climb(); }
      } else {
        this.vel.y -= GRAV * dt;
        if (this.vel.y < -32) this.vel.y = -32;
      }
    }

    // integrate
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this._collideHorizontal(input);
    this.pos.y += this.vel.y * dt;

    // ceilings
    if (this.vel.y > 0) {
      const head = this.pos.y + 0.85;
      for (const c of this.world.colliders) {
        if (this.pos.x + PLAYER_R * 0.5 < c.minX || this.pos.x - PLAYER_R * 0.5 > c.maxX) continue;
        if (this.pos.z + PLAYER_R * 0.5 < c.minZ || this.pos.z - PLAYER_R * 0.5 > c.maxZ) continue;
        if (c.minY < head && c.minY > this.pos.y + 0.35 && c.maxY > head) { this.vel.y = 0; break; }
      }
    }

    // ground / landing
    const support = this._supportHeight();
    if (this.pos.y <= support + 0.001) {
      const impact = -this.vel.y;
      const wasAir = !this.grounded;
      this.pos.y = support;
      if (!this.climbing) this.vel.y = 0;

      // trampoline bounce
      let bounced = false;
      for (const tr of this.world.trampolines) {
        if (Math.hypot(this.pos.x - tr.x, this.pos.z - tr.z) < tr.r && Math.abs(support - tr.y) < 0.05 && impact > 1) {
          this.vel.y = Math.max(11.5, impact * 0.85);
          this.audio.doubleJump();
          this.particles.burst(this.pos.x, this.pos.y, this.pos.z, 10, 0x4a68a8, 1);
          bounced = true;
          this.canDouble = true;
          break;
        }
      }
      if (!bounced) {
        if (wasAir && impact > 3) {
          this.audio.land(impact > 12);
          this.particles.burst(this.pos.x, this.pos.y + 0.02, this.pos.z, Math.min(14, impact | 0), 0xcdb891, 0.6);
          if (impact > 13.5) {
            const dmg = Math.round((impact - 13.5) * 9);
            this.hurt(dmg, 'fall');
          }
        }
        this.grounded = true;
        this.canDouble = true;
        this.coyote = 0.13;
      } else {
        this.grounded = false;
      }
    } else if (this.pos.y > support + 0.05 && this.grounded) {
      this.grounded = false;
      this.coyote = 0.13;
    }

    // footsteps + idle
    if (this.grounded && hSpeed > 0.6) {
      this.idleTime = 0;
      this._footT += dt * hSpeed;
      if (this._footT > 1.4) {
        this._footT = 0;
        this.audio.footstep(this.pos.z > 100 || this.pos.z < 80);
      }
    } else if (hSpeed <= 0.6 && this.grounded) {
      this.idleTime += dt;
    } else {
      this.idleTime = 0;
    }
    const shouldPurr = this.idleTime > 4;
    if (shouldPurr !== this._purring) { this._purring = shouldPurr; this.audio.purr(shouldPurr); }

    // world kill floor (safety net)
    if (this.pos.y < -25) this._die('fall');
  }

  _collideHorizontal(input) {
    const feet = this.pos.y;
    this._touchClimb = null;
    for (const c of this.world.colliders) {
      // floors we can step onto don't push
      if (c.maxY <= feet + STEP_UP) continue;
      if (c.minY >= feet + 0.9) continue;
      // circle vs AABB in XZ
      const nx = clamp(this.pos.x, c.minX, c.maxX);
      const nz = clamp(this.pos.z, c.minZ, c.maxZ);
      let dx = this.pos.x - nx, dz = this.pos.z - nz;
      let d2 = dx * dx + dz * dz;
      if (d2 > PLAYER_R * PLAYER_R) continue;
      let d = Math.sqrt(d2);
      if (d < 1e-5) {
        // center inside the box: push out along smallest penetration
        const pl = this.pos.x - c.minX, pr = c.maxX - this.pos.x;
        const pn = this.pos.z - c.minZ, pf = c.maxZ - this.pos.z;
        const m = Math.min(pl, pr, pn, pf);
        if (m === pl) { this.pos.x = c.minX - PLAYER_R; dx = -1; dz = 0; }
        else if (m === pr) { this.pos.x = c.maxX + PLAYER_R; dx = 1; dz = 0; }
        else if (m === pn) { this.pos.z = c.minZ - PLAYER_R; dx = 0; dz = -1; }
        else { this.pos.z = c.maxZ + PLAYER_R; dx = 0; dz = 1; }
        d = 1;
      } else {
        const push = (PLAYER_R - d) / d;
        this.pos.x += dx * push;
        this.pos.z += dz * push;
      }
      // are we pressing into this wall? (dx,dz normalized by penetration depth)
      const inx = Math.sin(this.camYaw) * input.z + Math.cos(this.camYaw) * input.x;
      const inz = Math.cos(this.camYaw) * input.z - Math.sin(this.camYaw) * input.x;
      const pressing = input.len > 0.25 && (inx * dx + inz * dz) / d < -0.35;
      if (pressing) {
        if (c.climb && !this.swimming) {
          this._touchClimb = c;
        } else if (c.maxY - feet < 1.15 && c.maxY - feet > STEP_UP) {
          // auto-mantle low ledges
          if (this.grounded || this.vel.y > -2) this.vel.y = Math.max(this.vel.y, 5.2);
        }
      }
    }
    // start / continue climbing
    if (this._touchClimb) {
      if (!this.climbing && !this.grounded) this.climbing = true;
      if (!this.climbing && this.grounded) this.climbing = true;
    } else if (this.climbing) {
      // reached the top — mantle forward
      this.climbing = false;
      this.vel.y = Math.max(this.vel.y, 4.2);
      const sin = Math.sin(this.facing), cos = Math.cos(this.facing);
      this.vel.x += sin * 1.6;
      this.vel.z += cos * 1.6;
    }
  }

  // ------------------------------------------------------------ triggers
  _checkTriggers() {
    // pickups
    for (const p of this.world.pickups) {
      if (p.taken) continue;
      const dx = this.pos.x - p.x, dy = this.pos.y + 0.3 - p.mesh.position.y, dz = this.pos.z - p.z;
      if (dx * dx + dy * dy + dz * dz < 1.0) {
        p.taken = true;
        p.mesh.visible = false;
        this.particles.burst(p.x, p.mesh.position.y, p.z, 12, 0xffe9a8, 0.9);
        if (p.type === 'snack') {
          this.hp = Math.min(this.maxHp, this.hp + 20);
          this.audio.eat();
          this.addXp(15);
          this.hooks.onToast('🐟 Fish snack! +20 HP');
        } else if (p.type === 'milk') {
          this.hp = this.maxHp;
          this.audio.eat();
          this.addXp(25);
          this.hooks.onToast('🥛 Milk! Fully healed');
        } else {
          this.yarn++;
          this.audio.pickup();
          this.addXp(30);
          this.hooks.onToast(`🧶 Yarn ball! ${this.yarn}/6 (+30 XP)`);
        }
        this._syncHud();
      }
    }
    // checkpoints
    const cps = this.world.checkpoints;
    for (let i = 0; i < cps.length; i++) {
      const c = cps[i];
      if (c.active) continue;
      const dx = this.pos.x - c.x, dz = this.pos.z - c.z;
      if (dx * dx + dz * dz < 2.6 && Math.abs(this.pos.y - c.y) < 2) {
        this._markCheckpoint(c);
        this.cpIdx = Math.max(this.cpIdx, i);
        this.audio.checkpoint();
        this.addXp(20);
        this.snapshot = this._makeSnapshot();
        this.snapshot.x = c.x; this.snapshot.y = c.y + 0.1; this.snapshot.z = c.z;
        this.hooks.onCheckpoint(c.name, this.snapshot);
        this.particles.burst(c.x, c.y + 0.4, c.z, 24, 0x35e0e0, 1.4);
      }
    }
    this._updateObjective();
  }

  _markCheckpoint(c) {
    c.active = true;
    c.disc.material.emissive.set('#ffb020');
    c.disc.material.color.set('#c98a20');
  }

  _updateObjective() {
    let idx;
    if (this.cpIdx < 0) idx = this.pos.z < 2.2 ? 0 : 1;
    else idx = this.cpIdx + 2;
    idx = Math.min(idx, OBJECTIVES.length - 1);
    this._objIdx = idx;

    // beacon target
    const cps = this.world.checkpoints;
    let target;
    if (idx === 0) target = this.world.windowPos;
    else if (idx <= 5) target = cps[idx - 1];
    else if (idx === 6) target = this.world.PIER_END;
    else target = this.world.FISH_CENTER;
    this._beaconTarget = target;
    this.world.setBeaconTarget(target.x, (target.y || 0), target.z);
    this.world.setBeaconVisible(this.state === 'playing');
  }

  // --------------------------------------------------------------- visuals
  _updateCatVisual(dt) {
    if (this.state === 'title') return;
    this.cat.group.position.copy(this.pos);
    const turnRate = dt > 0 ? (this.facing - (this._prevFacing ?? this.facing)) / dt : 0;
    this._prevFacing = this.facing;
    if (this.state !== 'dead') this.cat.group.rotation.y = this.facing;

    let mode = 'idle';
    const hSpeed = Math.hypot(this.vel.x, this.vel.z);
    if (this.state === 'dead') mode = 'death';
    else if (this.state === 'won') mode = 'sit';
    else if (this.pounceT > 0) mode = 'pounce';
    else if (this.swimming) mode = 'swim';
    else if (this.climbing) mode = 'climb';
    else if (!this.grounded) mode = this.vel.y > 0.5 ? 'jump' : 'fall';
    else if (hSpeed > 4.2) mode = 'run';
    else if (hSpeed > 0.5) mode = 'walk';
    else if (this.idleTime > 6) mode = 'sit';
    this.cat.update(dt, { mode, speed: hSpeed, grounded: this.grounded, lean: -turnRate * 0.09 });

    // invulnerability blink
    this.cat.group.visible = this.invuln <= 0 || Math.sin(performance.now() * 0.025) > -0.4;
  }

  _updateCamera(dt) {
    if (this.state === 'title') return;
    const targetY = this.pos.y + 0.75;
    const want = this._tmp.set(
      this.pos.x + Math.sin(this.camYaw) * Math.cos(this.camPitch) * -this.camDist,
      targetY - Math.sin(this.camPitch) * -this.camDist,
      this.pos.z + Math.cos(this.camYaw) * Math.cos(this.camPitch) * -this.camDist
    );
    // keep the camera out of walls: march from target outward
    const origin = this._tmp2.set(this.pos.x, targetY, this.pos.z);
    let t = 1;
    const dir = want.clone().sub(origin);
    const len = dir.length();
    dir.normalize();
    for (const c of this.world.colliders) {
      const hit = rayAABB(origin, dir, c);
      if (hit !== null && hit > 0 && hit < len) t = Math.min(t, Math.max((hit - 0.25) / len, 0.12));
    }
    want.copy(origin).addScaledVector(dir, len * t);
    // never below ground
    const gy = groundHeight(want.x, want.z);
    if (want.y < gy + 0.3) want.y = gy + 0.3;

    const k = 1 - Math.exp(-12 * dt);
    this._camPos.lerp(want, k);
    this.camera.position.copy(this._camPos);
    this.camera.lookAt(this.pos.x, targetY, this.pos.z);

    // sprint FOV kick
    const sprinting = (this.keys.ShiftLeft || this.touch.sprint) && Math.hypot(this.vel.x, this.vel.z) > 4;
    const wantFov = sprinting ? 70 : 62;
    if (Math.abs(this.camera.fov - wantFov) > 0.1) {
      this.camera.fov = lerp(this.camera.fov, wantFov, 1 - Math.exp(-6 * dt));
      this.camera.updateProjectionMatrix();
    }
  }

  _updateSunFollow() {
    this.sun.position.set(this.pos.x + 38, 46, this.pos.z - 26);
    this.sun.target.position.set(this.pos.x, 0, this.pos.z);
    // keep the sky dome centered on the camera so it never crosses the far plane
    this._sky.position.copy(this.camera.position);
  }

  // ------------------------------------------------------------------ HUD
  _syncHud(full = false) {
    const h = this.hud;
    h.hpFill.style.width = `${clamp((this.hp / this.maxHp) * 100, 0, 100)}%`;
    h.hpFill.classList.toggle('low', this.hp / this.maxHp < 0.3);
    h.hpText.textContent = `${Math.max(0, Math.ceil(this.hp))}/${this.maxHp}`;
    h.xpFill.style.width = `${(this.xp % 100)}%`;
    h.levelText.textContent = `LV ${this.level}`;
    h.yarnCount.textContent = `${this.yarn}/6`;
    h.livesCount.textContent = this.lives;
    h.fishCount.textContent = `${this.fish}/3`;
    if (full) this._updateObjective();
  }

  _syncHudFrame() {
    const h = this.hud;
    h.objective.textContent = OBJECTIVES[this._objIdx ?? 0];
    if (this._beaconTarget) {
      const d = Math.hypot(this.pos.x - this._beaconTarget.x, this.pos.z - this._beaconTarget.z);
      h.distance.textContent = `${Math.round(d)} m`;
    }
    h.timer.textContent = formatTime(this.runTime);
    h.fishHud.classList.toggle('visible', this._objIdx === 7);
    // fishing prompt
    if (this._atFishingSpot()) {
      h.prompt.textContent = 'SPACE — pounce when a fish swims into the golden ring!';
      h.prompt.classList.add('visible');
    } else if (this.swimming) {
      h.prompt.textContent = 'Percy hates water! Get out, quick!';
      h.prompt.classList.add('visible');
    } else {
      h.prompt.classList.remove('visible');
    }
  }
}

// segment/AABB intersection — returns distance along dir or null
function rayAABB(origin, dir, c) {
  let tmin = -Infinity, tmax = Infinity;
  const o = [origin.x, origin.y, origin.z];
  const d = [dir.x, dir.y, dir.z];
  const mn = [c.minX, c.minY, c.minZ];
  const mx = [c.maxX, c.maxY, c.maxZ];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-8) {
      if (o[i] < mn[i] || o[i] > mx[i]) return null;
    } else {
      let t1 = (mn[i] - o[i]) / d[i];
      let t2 = (mx[i] - o[i]) / d[i];
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmax < 0 ? null : Math.max(tmin, 0);
}

// ------------------------------------------------------------- particles
class ParticlePool {
  constructor(scene) {
    this.N = 220;
    this.geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(this.N * 3);
    this.colors = new Float32Array(this.N * 3);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.mat = new THREE.PointsMaterial({ size: 0.12, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.items = [];
    for (let i = 0; i < this.N; i++) this.items.push({ life: 0, vx: 0, vy: 0, vz: 0 });
    this.cursor = 0;
    this._col = new THREE.Color();
  }

  burst(x, y, z, count, color, power = 1) {
    this._col.set(color);
    for (let i = 0; i < count; i++) {
      const idx = this.cursor;
      this.cursor = (this.cursor + 1) % this.N;
      const it = this.items[idx];
      it.life = rand(0.35, 0.8);
      const a = rand(TAU), r = rand(0.5, 2.2) * power;
      it.vx = Math.sin(a) * r;
      it.vz = Math.cos(a) * r;
      it.vy = rand(1, 3.2) * power;
      this.positions[idx * 3] = x;
      this.positions[idx * 3 + 1] = y;
      this.positions[idx * 3 + 2] = z;
      this.colors[idx * 3] = this._col.r;
      this.colors[idx * 3 + 1] = this._col.g;
      this.colors[idx * 3 + 2] = this._col.b;
    }
  }

  update(dt) {
    let any = false;
    for (let i = 0; i < this.N; i++) {
      const it = this.items[i];
      if (it.life <= 0) {
        this.positions[i * 3 + 1] = -999;
        continue;
      }
      any = true;
      it.life -= dt;
      it.vy -= 7 * dt;
      this.positions[i * 3] += it.vx * dt;
      this.positions[i * 3 + 1] += it.vy * dt;
      this.positions[i * 3 + 2] += it.vz * dt;
    }
    if (any || !this._cleared) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.color.needsUpdate = true;
      this._cleared = !any;
    }
  }
}
