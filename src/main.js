import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { World } from './world.js';
import { Player } from './player.js';
import { ZombieManager } from './zombies.js';
import { FX } from './fx.js';
import { AudioEngine } from './audio.js';
import { HUD } from './hud.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pad = (n) => String(n).padStart(2, '0');

const SETTINGS_KEY = 'deadAscent.settings.v1';
const BEST_KEY = 'deadAscent.best.v1';

function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; }
}

async function boot() {
  // let the loading screen paint before we build textures
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  try {
    await Promise.all([
      document.fonts.load('700 100px Teko'),
      document.fonts.load('700 16px Rajdhani'),
      document.fonts.load('600 16px Rajdhani'),
      document.fonts.ready,
    ]);
  } catch {}

  const canvas = $('game');
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, powerPreference: 'high-performance', stencil: false,
  });
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 650);
  camera.rotation.order = 'YXZ';
  scene.add(camera);
  scene.userData.camera = camera;

  const audio = new AudioEngine();
  const hud = new HUD();
  const world = new World(scene, renderer, audio);
  const fx = new FX(scene, camera);

  const player = new Player({ camera, world, scene, audio, fx, hud, renderer });
  player.weapon.holder.visible = false;
  player.weapon.resize(window.innerWidth, window.innerHeight);

  const manager = new ZombieManager(scene, world, fx, audio);
  player.manager = manager;

  // post processing
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(window.innerWidth, window.innerHeight);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.72, 0.55, 0.82);
  composer.addPass(bloom);
  const output = new OutputPass();
  composer.addPass(output);

  fx.setShake((amount) => {
    player.addTrauma(amount * 0.65);
  });

  // ------------------------------------------------------------------ state
  const state = {
    mode: 'menu', wave: 0, waveActive: false, intermission: 0, waveTotal: 0,
    score: 0, kills: 0, heads: 0, time: 0, combo: 0, comboTimer: 0,
    best: 0, bestWave: 0, deathTimer: 0, started: false,
  };
  const pickups = [];
  const settings = loadJSON(SETTINGS_KEY, { sens: 1, vol: 0.7, quality: 'high', shake: 1 });
  const bestData = loadJSON(BEST_KEY, { score: 0, wave: 0 });
  state.best = bestData.score || 0;
  state.bestWave = bestData.wave || 0;
  hud.setBest(state.best, state.bestWave);
  hud.setScore(0, 0, state.best);

  const isTouch = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || (navigator.maxTouchPoints > 0 && !window.matchMedia('(pointer: fine)').matches);
  if (isTouch) {
    document.body.classList.add('touch');
    player.setTouch(true);
  }

  // -------------------------------------------------------------- settings
  function applyQuality(q) {
    const high = q === 'high';
    const dpr = Math.min(window.devicePixelRatio || 1, high ? 1.75 : 1.05);
    renderer.setPixelRatio(dpr);
    composer.setPixelRatio(dpr);
    composer.setSize(window.innerWidth, window.innerHeight);
    bloom.enabled = high;
    renderer.shadowMap.enabled = high;
  }
  function applySettings() {
    player.sensitivity = 0.0021 * settings.sens;
    player.shakeScale = settings.shake;
    audio.setVolume(settings.vol);
    applyQuality(settings.quality);
    $('sens').value = settings.sens;
    $('sens-val').textContent = Number(settings.sens).toFixed(2);
    $('vol').value = settings.vol;
    $('vol-val').textContent = Math.round(settings.vol * 100) + '%';
    $('shake').value = settings.shake;
    $('shake-val').textContent = Math.round(settings.shake * 100) + '%';
    $('quality-val').textContent = settings.quality.toUpperCase();
    for (const b of $('quality-seg').querySelectorAll('button')) {
      b.classList.toggle('on', b.dataset.q === settings.quality);
    }
  }
  function saveSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
  applySettings();

  // ------------------------------------------------------------------ audio
  function toggleMute() {
    audio.init();
    audio.setMuted(!audio.muted);
    $('btn-sound-menu').textContent = audio.muted ? '×' : '♪';
    $('btn-sound-menu').style.color = audio.muted ? '#ff5b4a' : '';
  }
  $('btn-sound-menu').addEventListener('click', (e) => { e.stopPropagation(); toggleMute(); });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM') toggleMute();
  });

  // ------------------------------------------------------------------- menu
  let menuT = 0;
  function updateMenuCamera(dt) {
    menuT += dt;
    const a = menuT * 0.055;
    camera.position.set(Math.sin(a) * 17.5, 4.4 + Math.sin(menuT * 0.13) * 0.55, Math.cos(a) * 17.5);
    camera.lookAt(0, 2.4, 0);
    if (camera.fov !== 64) {
      camera.fov = 64;
      camera.updateProjectionMatrix();
    }
  }

  function clearRun() {
    while (manager.zombies.length) manager.removeZombie(manager.zombies[0]);
    manager.queue.length = 0;
    manager.boss = null;
    manager.player = null;
    for (const p of pickups) {
      scene.remove(p.group);
      p.group.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); if (o.material) o.material.dispose(); } });
    }
    pickups.length = 0;
    player.reset();
    player.enabled = false;
    player.dead = false;
    player.weapon.holder.visible = false;
    if (document.pointerLockElement) document.exitPointerLock();
  }

  function startRun() {
    audio.init();
    audio.setCombat(false);
    $('menu').classList.add('hidden');
    hud.hideGameOver();
    hud.pause(false);
    hud.settings(false);
    hud.howto(false);
    hud.showHUD(true);
    hud.reset();
    clearRun();
    player.weapon.holder.visible = true;
    player.enabled = true;
    player.dead = false;
    player.invuln = 1.4;
    state.mode = 'playing';
    state.wave = 0;
    state.waveActive = false;
    state.intermission = 1.6;
    state.waveTotal = 0;
    state.score = 0;
    state.kills = 0;
    state.heads = 0;
    state.time = 0;
    state.combo = 0;
    state.comboTimer = 0;
    state.deathTimer = 0;
    state.started = true;
    player.statsShots = 0;
    player.statsHits = 0;
    hud.setScore(0, 0, state.best);
    hud.setEnemies(0, 0);
    hud.banner('SECTOR 09', 'SURVIVE THE NIGHT', 'HOSTILES INBOUND', 2600);
    if (!isTouch) requestLock();
    else hud.toast('Touch controls active — drag right side to look');
  }

  function requestLock() {
    const dom = renderer.domElement;
    if (document.pointerLockElement === dom) return;
    try {
      const p = dom.requestPointerLock();
      if (p && p.catch) p.catch(() => {
        hud.toast('CLICK THE SCENE TO CAPTURE MOUSE');
      });
    } catch {}
  }

  // ------------------------------------------------------------------ waves
  function beginWave(n) {
    state.wave = n;
    state.waveActive = true;
    state.intermission = 0;
    manager.startWave(n);
    state.waveTotal = manager.remaining;
    hud.setWave(n, state.waveTotal);
    hud.setEnemies(state.waveTotal, state.waveTotal);
    const boss = n % 5 === 0;
    hud.banner(
      boss ? 'THREAT SURGE' : 'WAVE ' + pad(n),
      boss ? 'ABOMINATION INBOUND' : 'HOLD THE LINE',
      boss ? 'KILL IT BEFORE IT REACHES YOU' : state.waveTotal + ' HOSTILES APPROACHING',
      2600
    );
    audio.setCombat(true);
  }

  function waveCleared() {
    state.waveActive = false;
    state.intermission = 7.5;
    const bonus = 500 * state.wave;
    state.score += bonus;
    hud.setScore(state.score, state.kills, state.best);
    hud.banner('WAVE ' + pad(state.wave) + ' CLEARED', 'REGROUP', 'SUPPLIES INBOUND — ' + bonus + ' BONUS', 3000);
    hud.toast('WAVE BONUS +' + bonus);
    player.grenades = Math.min(4, player.grenades + 2);
    hud.setGrenades(player.grenades);
    audio.setCombat(false);
    audio.pickup();
    spawnSupply();
  }

  function updateWave(dt) {
    if (state.waveActive) {
      const remaining = manager.remaining;
      hud.setEnemies(remaining, state.waveTotal);
      if (remaining === 0) waveCleared();
    } else {
      state.intermission -= dt;
      if (state.intermission <= 0) beginWave(state.wave + 1);
    }
    state.comboTimer -= dt;
    if (state.comboTimer <= 0) state.combo = 0;
  }

  // ---------------------------------------------------------------- pickups
  function makePickup(kind, x, z) {
    const g = new THREE.Group();
    let glowColor = 0x6affc0;
    if (kind === 'health') {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 0.3), new THREE.MeshStandardMaterial({
        color: 0xd9dcd4, roughness: 0.6, metalness: 0.2, emissive: 0x223322, emissiveIntensity: 0.4,
      }));
      box.castShadow = true;
      g.add(box);
      const crossMat = new THREE.MeshBasicMaterial({ color: 0xff3b30, toneMapped: false });
      const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.07, 0.01), crossMat);
      c1.position.z = 0.155; g.add(c1);
      const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.22, 0.01), crossMat);
      c2.position.z = 0.155; g.add(c2);
      glowColor = 0x6affc0;
    } else if (kind === 'ammo') {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.28, 0.34), new THREE.MeshStandardMaterial({
        color: 0x3f4a2c, roughness: 0.75, metalness: 0.3,
      }));
      box.castShadow = true;
      g.add(box);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.06, 0.36), new THREE.MeshStandardMaterial({
        color: 0xd7a52f, emissive: 0x6a4a00, emissiveIntensity: 0.5, roughness: 0.6,
      }));
      stripe.position.y = 0.02; g.add(stripe);
      glowColor = 0xffc85a;
    } else {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), new THREE.MeshStandardMaterial({
        color: 0x2e3f22, roughness: 0.5, metalness: 0.5, emissive: 0x44aa22, emissiveIntensity: 0.6,
      }));
      ball.castShadow = true;
      g.add(ball);
      glowColor = 0x8aff5a;
    }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: world.T.glow, color: glowColor, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    glow.scale.setScalar(1.25);
    g.add(glow);
    g.position.set(x, 0.55, z);
    scene.add(g);
    pickups.push({ kind, group: g, pos: new THREE.Vector3(x, 0, z), t: 0, glow });
  }

  function dropPickup(kind, x, z) {
    // keep the drop inside the arena and out of the walls
    const cx = clamp(x, -21.5, 21.5), cz = clamp(z, -21.5, 21.5);
    makePickup(kind, cx + (Math.random() - 0.5) * 0.6, cz + (Math.random() - 0.5) * 0.6);
  }

  function spawnSupply() {
    makePickup('health', -3.2, 3.4);
    makePickup('ammo', 3.4, -3.0);
    if (Math.random() < 0.6) makePickup('grenade', 0, 7.2);
  }

  function updatePickups(dt) {
    for (let i = pickups.length - 1; i >= 0; i--) {
      const p = pickups[i];
      p.t += dt;
      p.group.position.y = 0.52 + Math.sin(p.t * 2.4) * 0.09;
      p.group.rotation.y += dt * 1.4;
      p.glow.material.opacity = 0.4 + Math.sin(p.t * 3.2) * 0.18;
      let remove = p.t > 50;
      if (state.mode === 'playing' && !player.dead) {
        const dx = player.pos.x - p.pos.x, dz = player.pos.z - p.pos.z;
        if (dx * dx + dz * dz < 1.65 * 1.65) {
          if (p.kind === 'health') {
            player.heal(35);
            hud.toast('+35 VITALS');
          } else if (p.kind === 'ammo') {
            player.weapon.addAmmo(90);
            audio.pickup();
            hud.toast('+90 ROUNDS');
          } else {
            player.grenades = Math.min(4, player.grenades + 1);
            hud.setGrenades(player.grenades);
            audio.pickup();
            hud.toast('+1 FRAG');
          }
          remove = true;
        }
      }
      if (remove) {
        scene.remove(p.group);
        p.group.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); if (o.material) o.material.dispose(); } });
        pickups.splice(i, 1);
      }
    }
  }

  // ------------------------------------------------------------------ kills
  manager.onKill = (z, headshot) => {
    state.kills++;
    if (headshot) state.heads++;
    state.combo++;
    state.comboTimer = 3.2;
    const comboMult = Math.min(5, 1 + Math.max(0, state.combo - 1) * 0.22);
    const waveMult = 1 + state.wave * 0.07;
    const pts = Math.round(z.cfg.score * waveMult * comboMult * (headshot ? 1.5 : 1));
    state.score += pts;
    hud.setScore(state.score, state.kills, state.best);
    hud.killfeed(
      (headshot ? '<b>HEADSHOT</b> · ' : '') + z.type.toUpperCase() + (z.cfg.boss ? ' · ABOMINATION' : ' DOWN'),
      pts, headshot
    );
    if (z.cfg.boss) {
      hud.banner('ABOMINATION DOWN', 'THE LINE HOLDS', 'FOR NOW', 2800);
      dropPickup('health', z.pos.x, z.pos.z);
      dropPickup('ammo', z.pos.x, z.pos.z);
      dropPickup('grenade', z.pos.x, z.pos.z);
    } else {
      const roll = Math.random();
      if (roll < 0.13) dropPickup('health', z.pos.x, z.pos.z);
      else if (roll < 0.31) dropPickup('ammo', z.pos.x, z.pos.z);
      else if (roll < 0.35) dropPickup('grenade', z.pos.x, z.pos.z);
    }
  };

  manager.onBossUpdate = (frac, name) => {
    hud.setBoss(frac === 0 ? null : frac, name);
  };

  manager.onBoomerExploded = (z) => {
    if (z.cfg.boss) hud.toast('ABOMINATION DETONATED');
  };

  // ----------------------------------------------------------------- death
  player.onDeath = () => {
    state.mode = 'dead';
    state.deathTimer = 0;
    player.enabled = false;
    player.weapon.setTrigger(false);
    audio.setCombat(false);
    if (document.pointerLockElement) document.exitPointerLock();
    const acc = player.statsShots ? player.statsHits / player.statsShots : 0;
    const record = state.score > state.best;
    if (state.score > state.best || state.wave > state.bestWave) {
      state.best = Math.max(state.best, state.score);
      state.bestWave = Math.max(state.bestWave, state.wave);
      localStorage.setItem(BEST_KEY, JSON.stringify({ score: state.best, wave: state.bestWave }));
    }
    setTimeout(() => {
      hud.gameOver({
        wave: state.wave, score: state.score, kills: state.kills, heads: state.heads,
        accuracy: acc, time: state.time, best: state.best, record,
      });
      hud.setBest(state.best, state.bestWave);
      hud.showHUD(false);
    }, 1500);
  };

  player.onPointerUnlock = () => {
    if (state.mode === 'playing' && !player.dead) pauseGame();
  };

  // ---------------------------------------------------------------- pause
  function pauseGame() {
    if (state.mode !== 'playing') return;
    state.mode = 'paused';
    player.enabled = false;
    player.weapon.setTrigger(false);
    player.adsHeld = false;
    if (document.pointerLockElement) document.exitPointerLock();
    hud.pause(true);
    audio.setCombat(false);
  }
  function resumeGame() {
    if (state.mode !== 'paused') return;
    state.mode = 'playing';
    player.enabled = true;
    hud.pause(false);
    audio.setCombat(state.waveActive);
    if (!isTouch) requestLock();
  }
  function toMenu() {
    hud.pause(false);
    hud.settings(false);
    hud.hideGameOver();
    hud.showHUD(false);
    hud.showMenu(true);
    hud.setBest(state.best, state.bestWave);
    clearRun();
    state.mode = 'menu';
    state.started = false;
    audio.setCombat(false);
    updateMenuCamera(0);
  }

  $('btn-deploy').addEventListener('click', startRun);
  $('btn-resume').addEventListener('click', resumeGame);
  $('btn-restart-pause').addEventListener('click', startRun);
  $('btn-quit').addEventListener('click', toMenu);
  $('btn-retry').addEventListener('click', startRun);
  $('btn-menu').addEventListener('click', toMenu);
  $('btn-howto').addEventListener('click', () => { audio.init(); audio.ui(); hud.howto(true); });
  $('btn-howto-close').addEventListener('click', () => hud.howto(false));
  $('btn-settings-menu').addEventListener('click', () => { audio.init(); audio.ui(); hud.settings(true); });
  $('btn-settings-pause').addEventListener('click', () => hud.settings(true));
  $('btn-settings-close').addEventListener('click', () => { hud.settings(false); saveSettings(); });

  $('sens').addEventListener('input', (e) => {
    settings.sens = Number(e.target.value);
    player.sensitivity = 0.0021 * settings.sens;
    $('sens-val').textContent = Number(settings.sens).toFixed(2);
    saveSettings();
  });
  $('vol').addEventListener('input', (e) => {
    settings.vol = Number(e.target.value);
    audio.setVolume(settings.vol);
    $('vol-val').textContent = Math.round(settings.vol * 100) + '%';
    saveSettings();
  });
  $('shake').addEventListener('input', (e) => {
    settings.shake = Number(e.target.value);
    player.shakeScale = settings.shake;
    $('shake-val').textContent = Math.round(settings.shake * 100) + '%';
    saveSettings();
  });
  for (const b of $('quality-seg').querySelectorAll('button')) {
    b.addEventListener('click', () => {
      settings.quality = b.dataset.q;
      applyQuality(settings.quality);
      $('quality-val').textContent = settings.quality.toUpperCase();
      for (const x of $('quality-seg').querySelectorAll('button')) x.classList.toggle('on', x === b);
      saveSettings();
    });
  }

  $('btn-fullscreen').addEventListener('click', () => {
    if (!document.fullscreenElement) {
      (document.documentElement.requestFullscreen?.() || Promise.resolve()).catch(() => {});
      try { screen.orientation?.lock?.('landscape').catch?.(() => {}); } catch {}
    } else {
      document.exitFullscreen?.();
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') {
      if (state.mode === 'playing') pauseGame();
      else if (state.mode === 'paused') { if (!$('settings').classList.contains('on')) resumeGame(); }
    }
    if (e.code === 'Enter' && state.mode === 'dead') startRun();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.mode === 'playing') pauseGame();
  });
  renderer.domElement.addEventListener('click', () => {
    if (state.mode === 'playing' && !isTouch && document.pointerLockElement !== renderer.domElement) requestLock();
  });

  // ------------------------------------------------------------ touch input
  function setupTouch() {
    const joy = $('joystick');
    const stick = $('stick');
    let joyId = null, cx = 0, cy = 0, radius = 50;
    const resetJoy = () => {
      joyId = null;
      stick.style.transform = 'translate(0px,0px)';
      player.setTouchMove(0, 0);
    };
    joy.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      joyId = e.pointerId;
      const r = joy.getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2; radius = r.width * 0.42;
      joy.setPointerCapture?.(e.pointerId);
      moveJoy(e);
    });
    const moveJoy = (e) => {
      if (e.pointerId !== joyId) return;
      let dx = e.clientX - cx, dy = e.clientY - cy;
      const d = Math.hypot(dx, dy);
      if (d > radius) { dx = dx / d * radius; dy = dy / d * radius; }
      stick.style.transform = `translate(${dx}px,${dy}px)`;
      player.setTouchMove(dx / radius, -dy / radius);
    };
    joy.addEventListener('pointermove', (e) => { e.preventDefault(); moveJoy(e); });
    joy.addEventListener('pointerup', (e) => { e.preventDefault(); resetJoy(); });
    joy.addEventListener('pointercancel', resetJoy);
    joy.addEventListener('pointerleave', (e) => { if (e.pointerId === joyId && e.buttons === 0) resetJoy(); });

    // look drag on the canvas
    let lookId = null, lx = 0, ly = 0;
    renderer.domElement.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' || state.mode !== 'playing') return;
      if (lookId !== null) return;
      lookId = e.pointerId; lx = e.clientX; ly = e.clientY;
      renderer.domElement.setPointerCapture?.(e.pointerId);
    });
    renderer.domElement.addEventListener('pointermove', (e) => {
      if (e.pointerId !== lookId) return;
      const dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      player.lookTouch(dx, dy);
    });
    const endLook = (e) => { if (e.pointerId === lookId) lookId = null; };
    renderer.domElement.addEventListener('pointerup', endLook);
    renderer.domElement.addEventListener('pointercancel', endLook);

    const bindHold = (id, on, off) => {
      const el = $(id);
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        el.classList.add('on');
        el.setPointerCapture?.(e.pointerId);
        on();
      });
      const release = (e) => { e.preventDefault(); el.classList.remove('on'); off(); };
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      el.addEventListener('pointerleave', (e) => { if (e.buttons === 0) release(e); });
    };
    bindHold('btn-fire', () => player.setTrigger(true), () => player.setTrigger(false));
    bindHold('btn-ads', () => player.setADS(true), () => player.setADS(false));
    $('btn-reload').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); player.weapon.reload(); });
    $('btn-jump').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); player.jump(); });
    $('btn-switch').addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      player.weapon.switchWeapon(player.weapon.current === 'rifle' ? 'shotgun' : 'rifle');
    });
    $('btn-grenade').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); player.throwGrenade(); });
  }
  if (isTouch) setupTouch();

  // ------------------------------------------------------------------ resize
  function onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloom.setSize(w, h);
    player.weapon.resize(w, h);
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(onResize, 120));

  // ------------------------------------------------------------------- loop
  const clock = new THREE.Clock();
  let elapsed = 0;
  let hudTimer = 0;

  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, clock.getDelta());
    elapsed += dt;

    if (state.mode === 'menu') {
      updateMenuCamera(dt);
    } else if (state.mode === 'playing') {
      state.time += dt;
      player.update(dt, elapsed);
      manager.update(dt, player, elapsed);
      updatePickups(dt);
      updateWave(dt);
    } else if (state.mode === 'dead') {
      state.deathTimer += dt;
      player.update(dt, elapsed);
      updatePickups(dt);
    } else if (state.mode === 'paused') {
      // world ambience keeps breathing while the fight is frozen
    }

    world.update(dt, elapsed, camera);
    fx.update(dt, player.pos);
    audio.update(dt);

    hudTimer -= dt;
    if (hudTimer <= 0 && state.mode !== 'menu') {
      hudTimer = 0.06;
      hud.updateCompass(player.yaw, manager.zombies, player.pos, pickups);
    }

    composer.render();
    if (player.weapon.holder.visible) {
      const prevClear = renderer.autoClear;
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(player.weapon.viewScene, player.weapon.viewCamera);
      renderer.autoClear = prevClear;
    }
  }

  updateMenuCamera(0);
  composer.render();
  hud.bootDone();
  setTimeout(() => { if (state.mode === 'menu') hud.showMenu(true); }, 250);
  frame();

  // debug / automation hooks
  window.__deadAscent = {
    state, player, manager, world, fx, audio, hud, renderer, camera, scene,
    startRun, beginWave, pauseGame, resumeGame, toMenu,
    spawn(type = 'walker') {
      const a = Math.random() * Math.PI * 2;
      return manager.spawn(type, Math.cos(a) * 25.6, Math.sin(a) * 25.6);
    },
    spawnAt(type, x, z) { return manager.spawn(type, x, z); },
  };
}

boot().catch((err) => {
  console.error(err);
  const boot = document.getElementById('boot');
  if (boot) {
    boot.innerHTML = '<div class="mark" style="color:#ff4438">FAILED TO START</div><div class="sub" style="max-width:80vw;letter-spacing:.1em;line-height:1.6">' + String(err.message || err) + '</div>';
  }
});
