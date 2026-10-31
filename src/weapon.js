import * as THREE from 'three';
import { getTextures } from './textures.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);

const WEAPONS = {
  rifle: {
    name: 'MK-7 CARBINE', mag: 30, reserve: 240, maxReserve: 360,
    damage: 42, rate: 0.095, spread: 0.012, adsSpread: 0.0022,
    reload: 1.95, pellets: 1, auto: true, recoil: 0.013, score: 1,
  },
  shotgun: {
    name: 'BREACHER 12', mag: 6, reserve: 48, maxReserve: 72,
    damage: 17, rate: 0.82, spread: 0.075, adsSpread: 0.05,
    reload: 2.65, pellets: 8, auto: false, recoil: 0.045, score: 1.3,
  },
};

export class Weapon {
  constructor(player, camera, scene, audio, fx, hud) {
    this.player = player;
    this.camera = camera;
    this.scene = scene;
    this.audio = audio;
    this.fx = fx;
    this.hud = hud;
    this.T = getTextures();
    this.current = 'rifle';
    this.ammo = { rifle: WEAPONS.rifle.mag, shotgun: WEAPONS.shotgun.mag };
    this.reserve = { rifle: WEAPONS.rifle.reserve, shotgun: WEAPONS.shotgun.reserve };
    this.reloading = 0;
    this.reloadDuration = 0;
    this.switching = 0;
    this.switchTo = null;
    this.lastShot = -10;
    this.recoil = 0;
    this.recoilRot = 0;
    this.heat = 0;
    this.triggerHeld = false;
    this.triggerLatch = false;
    this.ads = 0;
    this.muzzleTimer = 0;
    this.pump = 0;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 140;
    this._dir = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._pos = new THREE.Vector3();
    this._muzzle = new THREE.Vector3();
    this._hit = new THREE.Vector3();
    this._aimTarget = new THREE.Vector3();

    // The viewmodel lives in its own scene and is drawn as a final overlay.
    // This keeps the tactical flashlight and world lights from blowing it out,
    // and lets us light it like a proper FPS weapon.
    this.viewScene = new THREE.Scene();
    this.viewCamera = new THREE.PerspectiveCamera(72, 1, 0.01, 10);
    this.viewScene.add(this.viewCamera);

    const key = new THREE.DirectionalLight(0xdbe7ff, 3.6);
    key.position.set(-0.9, 1.15, 0.55);
    key.target.position.set(0, 0, -0.6);
    this.viewScene.add(key, key.target);

    const fill = new THREE.DirectionalLight(0x8aa8cc, 1.9);
    fill.position.set(1.3, 0.15, 0.5);
    fill.target.position.set(0, 0, -0.6);
    this.viewScene.add(fill, fill.target);

    const rim = new THREE.DirectionalLight(0xffa060, 1.3);
    rim.position.set(0.9, 0.55, -2.6);
    rim.target.position.set(0, 0, 0);
    this.viewScene.add(rim, rim.target);

    this.viewScene.add(new THREE.AmbientLight(0x33414f, 1.1));

    this.holder = new THREE.Group();
    this.viewCamera.add(this.holder);
    this.holder.position.set(0.30, -0.285, -0.63);
    this.holder.scale.setScalar(0.72);
    this._buildRifle();
    this._buildShotgun();
    this._buildFlash();

    this.poses = {
      rifle: { base: new THREE.Vector3(0.30, -0.285, -0.63), ads: new THREE.Vector3(0, -0.0778, -0.395) },
      shotgun: { base: new THREE.Vector3(0.32, -0.30, -0.66), ads: new THREE.Vector3(0, -0.105, -0.45) },
    };
    this.holder.rotation.set(0.015, -0.06, -0.015);
    this.setVisible('rifle', true);
    this.setVisible('shotgun', false);
    this.hud.setWeapon(WEAPONS.rifle.name, this.ammo.rifle, this.reserve.rifle);
    this.hud.setGrenades(player.grenades);
  }

  // ------------------------------------------------------------------- models
  _mat() {
    this.matGun = new THREE.MeshStandardMaterial({ color: 0x3b4149, metalness: 0.45, roughness: 0.48, emissive: 0x0d1013, emissiveIntensity: 1, envMapIntensity: 1.35 });
    this.matPoly = new THREE.MeshStandardMaterial({ color: 0x24282d, metalness: 0.1, roughness: 0.7, emissive: 0x080a0c, emissiveIntensity: 1, envMapIntensity: 0.7 });
    this.matTan = new THREE.MeshStandardMaterial({ color: 0x8a7757, metalness: 0.08, roughness: 0.82, emissive: 0x14110b, emissiveIntensity: 1, envMapIntensity: 0.4 });
    this.matSteel = new THREE.MeshStandardMaterial({ color: 0x9aa1a8, metalness: 0.7, roughness: 0.3, emissive: 0x101315, emissiveIntensity: 1, envMapIntensity: 1.6 });
    this.matWood = new THREE.MeshStandardMaterial({ color: 0x5a3c22, metalness: 0.05, roughness: 0.72, emissive: 0x0e0805, emissiveIntensity: 1, envMapIntensity: 0.4 });
    this.matGlove = new THREE.MeshStandardMaterial({ color: 0x343a41, metalness: 0.05, roughness: 0.88, emissive: 0x0c0e10, emissiveIntensity: 1, envMapIntensity: 0.3 });
    this.matSleeve = new THREE.MeshStandardMaterial({ color: 0x3d4636, metalness: 0.02, roughness: 0.94, emissive: 0x0c0f0a, emissiveIntensity: 1, envMapIntensity: 0.25 });
    this.matBrass = new THREE.MeshStandardMaterial({ color: 0xb08a3e, metalness: 0.9, roughness: 0.35 });
    this.matRed = new THREE.MeshBasicMaterial({ color: 0xff2a1a, toneMapped: false });
  }

  _box(parent, w, h, d, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    parent.add(m);
    return m;
  }

  _cyl(parent, r1, r2, h, mat, x, y, z, rx = Math.PI / 2, ry = 0, rz = 0, seg = 12) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    parent.add(m);
    return m;
  }

  _hand(parent, side, x, y, z, rx, ry, rz) {
    const glove = this.matGlove;
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.set(rx, ry, rz);
    parent.add(g);
    // palm
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.085, 0.075), glove);
    palm.position.set(0, 0, 0);
    g.add(palm);
    // fingers wrapping
    for (let i = 0; i < 4; i++) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.052, 0.02), glove);
      f.position.set(-0.021 + i * 0.014, 0.028, 0.038);
      f.rotation.x = 0.75;
      g.add(f);
    }
    // thumb
    const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.05, 0.025), glove);
    thumb.position.set(side * 0.032, 0.012, -0.005);
    thumb.rotation.z = side * 0.7;
    g.add(thumb);
    // knuckle pad
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.018, 0.05), this.matTan);
    pad.position.set(0, -0.012, 0.036);
    pad.rotation.x = 0.2;
    g.add(pad);
    // sleeve / forearm trailing back, angled down and out of frame
    const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.085, 0.2), this.matSleeve);
    sleeve.position.set(side * 0.01, -0.065, 0.1);
    sleeve.rotation.x = -0.55;
    sleeve.rotation.y = side * -0.12;
    g.add(sleeve);
    const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.09, 0.035), this.matGlove);
    cuff.position.set(side * 0.005, -0.02, 0.028);
    g.add(cuff);
    return g;
  }

  _buildRifle() {
    this._mat();
    const g = new THREE.Group();
    this.rifle = g;
    this.holder.add(g);
    const G = this.matGun, P = this.matPoly, S = this.matSteel, T = this.matTan;

    // receiver
    this._box(g, 0.086, 0.086, 0.31, G, 0, 0.005, 0.0);
    this._box(g, 0.078, 0.082, 0.14, G, 0, 0.0, 0.19);
    this._box(g, 0.072, 0.095, 0.17, P, 0, -0.077, 0.015);
    // magwell
    this._box(g, 0.07, 0.045, 0.11, G, 0, -0.105, -0.05);
    // handguard with vent slots
    this._box(g, 0.074, 0.078, 0.31, P, 0, 0.006, -0.27);
    for (let i = 0; i < 5; i++) {
      this._box(g, 0.006, 0.028, 0.03, G, 0.039, 0.012, -0.37 + i * 0.05);
      this._box(g, 0.006, 0.028, 0.03, G, -0.039, 0.012, -0.37 + i * 0.05);
    }
    // top rail
    for (let i = 0; i < 12; i++) {
      this._box(g, 0.048, 0.012, 0.024, G, 0, 0.055, -0.43 + i * 0.042);
    }
    // barrel + muzzle
    this._cyl(g, 0.0125, 0.0125, 0.36, S, 0, 0.008, -0.58, Math.PI / 2, 0, 0, 10);
    this._cyl(g, 0.024, 0.024, 0.075, G, 0, 0.008, -0.77, Math.PI / 2, 0, 0, 12);
    this._cyl(g, 0.016, 0.02, 0.03, G, 0, 0.008, -0.81, Math.PI / 2, 0, 0, 12);
    // gas block / front sight
    this._box(g, 0.038, 0.045, 0.06, G, 0, 0.03, -0.47);
    this._box(g, 0.01, 0.05, 0.01, G, 0, 0.062, -0.47);
    // stock
    this._box(g, 0.055, 0.095, 0.21, P, 0, -0.01, 0.27);
    this._box(g, 0.062, 0.125, 0.03, P, 0, -0.025, 0.385);
    this._box(g, 0.05, 0.03, 0.12, P, 0, 0.048, 0.25);
    this._box(g, 0.03, 0.05, 0.03, G, 0, -0.01, 0.16);
    // grip
    this._box(g, 0.055, 0.135, 0.072, P, 0, -0.15, 0.065, 0.26, 0, 0);
    this._box(g, 0.058, 0.02, 0.075, T, 0, -0.205, 0.085, 0.26, 0, 0);
    // trigger guard
    this._box(g, 0.026, 0.012, 0.09, G, 0, -0.117, -0.01);
    this._box(g, 0.026, 0.045, 0.012, G, 0, -0.137, -0.05);
    this._box(g, 0.012, 0.045, 0.012, G, 0, -0.137, 0.035);
    // magazine
    this.mag = this._box(g, 0.052, 0.17, 0.1, P, 0, -0.18, -0.055, -0.14, 0, 0);
    this._box(g, 0.056, 0.02, 0.104, T, 0, -0.258, -0.045, -0.14, 0, 0);
    // optic — open tube so the sight picture is visible when aiming
    this._box(g, 0.042, 0.028, 0.1, G, 0, 0.074, -0.02);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.135, 16, 1, true), G);
    tube.position.set(0, 0.108, -0.02);
    tube.rotation.x = Math.PI / 2;
    g.add(tube);
    const ringGeo = new THREE.TorusGeometry(0.03, 0.0065, 6, 18);
    const ringRear = new THREE.Mesh(ringGeo, G);
    ringRear.position.set(0, 0.108, 0.047);
    g.add(ringRear);
    const ringFront = new THREE.Mesh(ringGeo, G);
    ringFront.position.set(0, 0.108, -0.087);
    g.add(ringFront);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.024, 18), new THREE.MeshStandardMaterial({
      color: 0x113344, metalness: 0.4, roughness: 0.05, emissive: 0x0a2233, emissiveIntensity: 1.2,
    }));
    lens.position.set(0, 0.108, -0.089);
    g.add(lens);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0032, 8, 8), this.matRed);
    dot.position.set(0, 0.108, -0.081);
    g.add(dot);
    // flashlight + laser
    this._cyl(g, 0.018, 0.02, 0.09, G, 0.058, 0.012, -0.34, Math.PI / 2, 0, 0, 10);
    this._cyl(g, 0.022, 0.022, 0.012, S, 0.058, 0.012, -0.388, Math.PI / 2, 0, 0, 10);
    this._box(g, 0.02, 0.02, 0.05, G, -0.056, 0.02, -0.3);
    // charging handle
    this._box(g, 0.07, 0.012, 0.02, G, 0, 0.04, 0.17);
    // ejection port
    this._box(g, 0.005, 0.028, 0.06, G, 0.043, 0.005, 0.06);
    // sling mount
    this._box(g, 0.02, 0.012, 0.04, G, 0, -0.1, 0.24);

    // hands
    this._hand(g, 1, 0.012, -0.155, 0.07, 0.15, 0, 0.05);
    this._hand(g, -1, -0.062, -0.005, -0.29, 0.05, 0.25, -0.35);

    this.rifleMuzzle = new THREE.Object3D();
    this.rifleMuzzle.position.set(0, 0.008, -0.83);
    g.add(this.rifleMuzzle);
    this.rifleEject = new THREE.Object3D();
    this.rifleEject.position.set(0.05, 0.01, 0.06);
    g.add(this.rifleEject);
    this.rifleMag = this.mag;
  }

  _buildShotgun() {
    const g = new THREE.Group();
    this.shotgun = g;
    this.holder.add(g);
    const G = this.matGun, P = this.matPoly, S = this.matSteel, W = this.matWood;

    this._box(g, 0.088, 0.095, 0.28, G, 0, 0.0, 0.02);
    this._box(g, 0.082, 0.08, 0.1, G, 0, -0.005, -0.16);
    this._cyl(g, 0.027, 0.027, 0.58, S, 0, 0.025, -0.43, Math.PI / 2, 0, 0, 12);
    this._cyl(g, 0.021, 0.021, 0.46, G, 0, -0.032, -0.37, Math.PI / 2, 0, 0, 10);
    // pump
    this.pumpMesh = this._box(g, 0.076, 0.082, 0.18, W, 0, -0.028, -0.31);
    for (let i = 0; i < 4; i++) {
      this._box(g, 0.08, 0.012, 0.012, G, 0, -0.07, -0.37 + i * 0.04);
    }
    // receiver details
    this._box(g, 0.045, 0.03, 0.1, G, 0, 0.058, -0.06);
    this._box(g, 0.05, 0.018, 0.02, G, 0, 0.048, 0.1);
    // stock
    this._box(g, 0.07, 0.115, 0.3, W, 0, -0.02, 0.28);
    this._box(g, 0.074, 0.14, 0.028, P, 0, -0.035, 0.43);
    this._box(g, 0.058, 0.04, 0.12, W, 0, 0.055, 0.24);
    // grip
    this._box(g, 0.06, 0.13, 0.075, W, 0, -0.145, 0.09, 0.28, 0, 0);
    // trigger guard
    this._box(g, 0.03, 0.012, 0.095, G, 0, -0.115, 0.015);
    this._box(g, 0.03, 0.045, 0.012, G, 0, -0.137, -0.03);
    this._box(g, 0.012, 0.045, 0.012, G, 0, -0.137, 0.06);
    // shell carrier
    this._box(g, 0.03, 0.012, 0.06, this.matBrass, 0.048, -0.02, 0.0);
    // bead sight
    const bead = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), this.matBrass);
    bead.position.set(0, 0.062, -0.67);
    g.add(bead);
    // muzzle
    this._cyl(g, 0.031, 0.031, 0.02, G, 0, 0.025, -0.725, Math.PI / 2, 0, 0, 12);

    this._hand(g, 1, 0.012, -0.15, 0.09, 0.18, 0, 0.05);
    this._hand(g, -1, -0.07, -0.04, -0.31, 0.02, 0.2, -0.3);

    this.shotgunMuzzle = new THREE.Object3D();
    this.shotgunMuzzle.position.set(0, 0.025, -0.74);
    g.add(this.shotgunMuzzle);
    this.shotgunEject = new THREE.Object3D();
    this.shotgunEject.position.set(0.05, 0.01, 0.02);
    g.add(this.shotgunEject);
  }

  _buildFlash() {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.T.muzzle, color: 0xffc46a, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, toneMapped: false,
    }));
    sprite.scale.setScalar(0.34);
    sprite.visible = false;
    sprite.renderOrder = 20;
    this.holder.add(sprite);
    this.flashSprite = sprite;

    this.muzzleLight = new THREE.PointLight(0xffb15c, 0, 9, 2);
    this.holder.add(this.muzzleLight);
  }

  resize(width, height) {
    this.viewCamera.aspect = width / Math.max(1, height);
    this.viewCamera.updateProjectionMatrix();
  }

  // -------------------------------------------------------------------- state
  setVisible(which, v) {
    if (which === 'rifle') this.rifle.visible = v;
    else this.shotgun.visible = v;
  }

  get cfg() { return WEAPONS[this.current]; }
  get muzzle() { return this.current === 'rifle' ? this.rifleMuzzle : this.shotgunMuzzle; }
  get eject() { return this.current === 'rifle' ? this.rifleEject : this.shotgunEject; }

  setTrigger(v) {
    this.triggerHeld = v;
    if (!v) this.triggerLatch = false;
  }

  reload() {
    if (this.reloading > 0 || this.switching > 0) return;
    if (this.ammo[this.current] >= this.cfg.mag) return;
    if (this.reserve[this.current] <= 0) { this.audio.empty(); return; }
    this.reloading = 0.001;
    this.reloadDuration = this.cfg.reload;
    this.audio.reload(0);
    this.hud.setReloading(true, 0);
  }

  switchWeapon(which) {
    if (which === this.current || this.switching > 0) return;
    this.switching = 0.55;
    this.switchTo = which;
    this.reloading = 0;
    this.hud.setReloading(false, 0);
    this.audio.reload(1);
  }

  addAmmo(amount) {
    for (const k of ['rifle', 'shotgun']) {
      this.reserve[k] = Math.min(WEAPONS[k].maxReserve, this.reserve[k] + (k === 'rifle' ? amount : Math.ceil(amount / 4)));
    }
    this.hud.setWeapon(this.cfg.name, this.ammo[this.current], this.reserve[this.current]);
  }

  // --------------------------------------------------------------------- fire
  fire(time) {
    const cfg = this.cfg;
    if (this.reloading > 0 || this.switching > 0) return;
    if (!cfg.auto && this.triggerLatch) return;
    if (this.ammo[this.current] <= 0) {
      this.audio.empty();
      this.triggerLatch = true;
      this.reload();
      return;
    }
    if (time - this.lastShot < cfg.rate) return;
    this.lastShot = time;
    this.triggerLatch = true;
    this.ammo[this.current]--;
    this.hud.setWeapon(cfg.name, this.ammo[this.current], this.reserve[this.current]);

    this.recoil = 1;
    this.recoilRot = 1;
    this.heat = Math.min(1, this.heat + (this.current === 'rifle' ? 0.12 : 0.5));
    this.audio.gunshot(0.12, this.current);
    this.player.addRecoil(cfg.recoil * (this.ads > 0.5 ? 0.55 : 1), rand(-0.35, 0.35) * cfg.recoil);
    this.player.addTrauma(this.current === 'shotgun' ? 0.22 : 0.06);
    this.muzzleTimer = 0.055;
    this.flashSprite.visible = true;
    this.flashSprite.material.rotation = rand(0, 6.28);
    this.flashSprite.scale.setScalar(rand(0.24, 0.42) * (this.current === 'shotgun' ? 1.5 : 1));
    this.muzzleLight.intensity = this.current === 'shotgun' ? 65 : 40;
    if (this.current === 'shotgun') this.pump = 1;

    // muzzle world position
    this.muzzle.getWorldPosition(this._muzzle);
    this.camera.getWorldDirection(this._dir);
    this.fx.muzzleSmoke(this._muzzle, this._dir);
    this.camera.getWorldDirection(this._dir);
    this._right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    this._up.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
    this.eject.getWorldPosition(this._pos);
    this.fx.ejectCasing(this._pos, this._right, this._up, this._dir);

    const baseSpread = (this.ads > 0.5 ? cfg.adsSpread : cfg.spread) * (1 + this.heat * 0.8);
    const moveSpread = this.player.speedFactor * 0.012;
    let anyHit = false;
    let anyHead = false;
    let anyKill = false;
    let hitCount = 0;

    for (let p = 0; p < cfg.pellets; p++) {
      const spread = baseSpread + moveSpread;
      const dir = this._dir.clone();
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.sqrt(Math.random()) * spread;
      dir.addScaledVector(this._right, Math.cos(ang) * rad);
      dir.addScaledVector(this._up, Math.sin(ang) * rad);
      dir.normalize();
      if (this.player.isTouch && p === 0) {
        // gentle aim assist for touch controls
        const target = this.player.manager?.nearestThreat(this.player.pos, 42);
        if (target && !target.dead) {
          this._aimTarget.copy(target.pos).add(new THREE.Vector3(0, 1.05 * target.scale, 0)).sub(this.camera.position).normalize();
          if (this._aimTarget.dot(this._dir) > 0.985) {
            dir.lerp(this._aimTarget, 0.55).normalize();
          }
        }
      }

      this.raycaster.set(this.camera.position, dir);
      const zHits = this.raycaster.intersectObjects(this.player.manager ? this.player.manager.getHitMeshes() : [], false);
      const wHits = this.raycaster.intersectObjects(this.player.world.raycastTargets, false);
      const zHit = zHits[0];
      const wHit = wHits[0];
      let hit = null, kind = null;
      if (zHit && (!wHit || zHit.distance < wHit.distance)) { hit = zHit; kind = 'zombie'; }
      else if (wHit) { hit = wHit; kind = 'world'; }

      const end = hit ? hit.point : this.camera.position.clone().addScaledVector(dir, 90);
      this.fx.tracer(this._muzzle, end, new THREE.Color(0xffd7a0));

      if (kind === 'zombie') {
        const z = hit.object.userData.zombie;
        const part = hit.object.userData.part;
        const headshot = part === 'head';
        let dmg = cfg.damage;
        if (this.current === 'shotgun') dmg *= clamp(1 - (hit.distance - 9) / 26, 0.35, 1);
        if (part === 'limb') dmg *= 0.72;
        const killed = z.takeDamage(dmg, { headshot, point: hit.point, dir });
        this.fx.bloodBurst(hit.point, dir, headshot ? 20 : 10, headshot);
        anyHit = true;
        hitCount++;
        if (headshot) anyHead = true;
        if (killed) anyKill = true;
      } else if (kind === 'world') {
        this.fx.bulletImpact(hit.point, hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : dir.clone().negate(), 'concrete');
      }
    }

    if (anyHit) {
      this.audio.hit(anyHead);
      this.hud.hitmarker(anyHead, anyKill);
      if (anyKill) this.audio.kill();
    }
    this.player.statsShots += cfg.pellets;
    this.player.statsHits += hitCount;
    this.hud.pulseCrosshair();
  }

  // ------------------------------------------------------------------- update
  update(dt, time) {
    if (this.viewCamera.fov !== this.camera.fov) {
      this.viewCamera.fov = this.camera.fov;
      this.viewCamera.updateProjectionMatrix();
    }
    // reload timeline
    if (this.reloading > 0) {
      this.reloading += dt;
      const k = clamp(this.reloading / this.reloadDuration, 0, 1);
      this.hud.setReloading(true, k);
      if (this.reloading >= this.reloadDuration) {
        const need = this.cfg.mag - this.ammo[this.current];
        const take = Math.min(need, this.reserve[this.current]);
        this.ammo[this.current] += take;
        this.reserve[this.current] -= take;
        this.reloading = 0;
        this.hud.setReloading(false, 0);
        this.hud.setWeapon(this.cfg.name, this.ammo[this.current], this.reserve[this.current]);
        this.audio.reload(2);
      }
    }

    // switching
    if (this.switching > 0) {
      this.switching -= dt;
      if (this.switching <= 0 && this.switchTo) {
        this.setVisible(this.current, false);
        this.current = this.switchTo;
        this.switchTo = null;
        this.setVisible(this.current, true);
        this.hud.setWeapon(this.cfg.name, this.ammo[this.current], this.reserve[this.current]);
        this.audio.reload(1);
      }
    }

    // trigger
    if (this.triggerHeld && this.reloading <= 0 && this.switching <= 0) this.fire(time);

    // aim down sights
    const adsTarget = this.player.adsHeld && this.reloading <= 0 && this.switching <= 0 ? 1 : 0;
    this.ads += (adsTarget - this.ads) * Math.min(1, dt * 12);
    this.player.adsAmount = this.ads;

    // recoil recovery
    this.recoil = Math.max(0, this.recoil - dt * 9);
    this.recoilRot = Math.max(0, this.recoilRot - dt * 7);
    this.heat = Math.max(0, this.heat - dt * 1.8);
    this.pump = Math.max(0, this.pump - dt * 3.2);

    // muzzle flash
    if (this.muzzleTimer > 0) {
      this.muzzleTimer -= dt;
      if (this.muzzleTimer <= 0) {
        this.flashSprite.visible = false;
        this.muzzleLight.intensity = 0;
      }
    }
    this.muzzleLight.intensity *= Math.pow(0.0001, dt);

    // pose
    const pose = this.poses[this.current];
    const target = this._pos.copy(pose.base).lerp(pose.ads, this.ads);
    // reload dip
    let reloadDip = 0;
    if (this.reloading > 0) {
      const k = clamp(this.reloading / this.reloadDuration, 0, 1);
      reloadDip = Math.sin(Math.min(1, k * 1.15) * Math.PI);
    }
    // switch dip
    let switchDip = 0;
    if (this.switching > 0) switchDip = Math.sin(clamp(1 - this.switching / 0.55, 0, 1) * Math.PI);

    // sway / bob
    const bob = this.player.bobPhase;
    const bobAmt = this.player.grounded ? (1 - this.ads * 0.75) : 0.4;
    const sx = Math.sin(bob) * 0.007 * this.player.speedFactor * bobAmt;
    const sy = Math.abs(Math.cos(bob)) * 0.006 * this.player.speedFactor * bobAmt;
    const swayX = this.player.swayX * (1 - this.ads * 0.6);
    const swayY = this.player.swayY * (1 - this.ads * 0.6);

    target.x += sx + swayX;
    target.y += sy + swayY - reloadDip * 0.16 - switchDip * 0.3;
    target.z += this.recoil * 0.055 + switchDip * 0.1;
    this.holder.position.lerp(target, Math.min(1, dt * 16));

    const rotTarget = new THREE.Euler(
      0.015 + this.recoilRot * 0.07 + swayY * 2.2 - reloadDip * 0.35,
      -0.06 + swayX * 3.2 + reloadDip * 0.32 + switchDip * 0.3,
      -0.015 + reloadDip * 0.75 + switchDip * 0.5,
    );
    this.holder.rotation.x += (rotTarget.x - this.holder.rotation.x) * Math.min(1, dt * 14);
    this.holder.rotation.y += (rotTarget.y - this.holder.rotation.y) * Math.min(1, dt * 14);
    this.holder.rotation.z += (rotTarget.z - this.holder.rotation.z) * Math.min(1, dt * 14);

    // magazine animation
    if (this.rifleMag) {
      const baseY = -0.18;
      this.rifleMag.position.y = baseY - reloadDip * 0.16;
      this.rifleMag.rotation.z = reloadDip * 0.5;
    }
    if (this.pumpMesh) {
      this.pumpMesh.position.z = -0.31 + this.pump * 0.075;
    }
    // muzzle flash follows muzzle
    if (this.flashSprite.visible) {
      this.muzzle.getWorldPosition(this._muzzle);
      this.holder.worldToLocal(this._muzzle);
      this.flashSprite.position.copy(this._muzzle);
      this.muzzleLight.position.copy(this._muzzle);
    }

    this.hud.setCrosshair((this.player.adsAmount > 0.5 ? 0.35 : 1) * (this.cfg.spread * 1.0 + this.heat * 0.35 + this.player.speedFactor * 0.35));
  }
}
