import * as THREE from 'three';
import { Weapon } from './weapon.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);

export class Player {
  constructor({ camera, world, scene, audio, fx, hud, renderer }) {
    this.camera = camera;
    this.world = world;
    this.scene = scene;
    this.audio = audio;
    this.fx = fx;
    this.hud = hud;
    this.renderer = renderer;

    this.pos = new THREE.Vector3(0, 0, 14.5);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.eyeHeight = 1.68;
    this.radius = 0.42;
    this.health = 100;
    this.maxHealth = 100;
    this.stamina = 100;
    this.grenades = 3;
    this.dead = false;
    this.deathT = 0;
    this.grounded = true;
    this.vy = 0;
    this.enabled = false;
    this.isTouch = false;
    this.adsHeld = false;
    this.adsAmount = 0;
    this.sprinting = false;
    this.speedFactor = 0;
    this.bobPhase = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.lookDX = 0;
    this.lookDY = 0;
    this.trauma = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.lastDamage = -99;
    this.time = 0;
    this.invuln = 0;
    this.footTimer = 0;
    this.staminaDelay = 0;
    this.heartTimer = 0;
    this.meleeCooldown = 0;
    this.grenadeList = [];
    this.grenadeCooldown = 0;
    this.keys = {};
    this.touchMove = new THREE.Vector2();
    this.sensitivity = 0.0021;
    this.onDeath = null;
    this.manager = null;
    this.shakeScale = 1;
    this.statsShots = 0;
    this.statsHits = 0;
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._shake = new THREE.Vector3();

    camera.rotation.order = 'YXZ';
    scene.add(camera);

    // tactical flashlight
    this.flashlight = new THREE.SpotLight(0xd7e6ff, 46, 46, 0.42, 0.55, 2);
    this.flashlight.position.set(0.1, -0.05, 0);
    this.flashlight.castShadow = false;
    const target = new THREE.Object3D();
    target.position.set(0, -0.08, -1);
    this.flashlight.target = target;
    camera.add(this.flashlight);
    camera.add(target);

    this.weapon = new Weapon(this, camera, scene, audio, fx, hud);
    this._bindInput();
  }

  // ------------------------------------------------------------------- input
  _bindInput() {
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      const k = e.code;
      if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight'].includes(k)) e.preventDefault();
      if (this.keys[k]) return;
      this.keys[k] = true;
      if (k === 'KeyR') this.weapon.reload();
      if (k === 'Digit1') this.weapon.switchWeapon('rifle');
      if (k === 'Digit2') this.weapon.switchWeapon('shotgun');
      if (k === 'KeyQ') this.weapon.switchWeapon(this.weapon.current === 'rifle' ? 'shotgun' : 'rifle');
      if (k === 'KeyG') this.throwGrenade();
      if (k === 'KeyF') this.melee();
      if (k === 'Space' && this.grounded && !this.dead) {
        this.vy = 5.5;
        this.grounded = false;
        this.audio.jump();
      }
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    window.addEventListener('blur', () => { this.keys = {}; this.weapon.setTrigger(false); });

    document.addEventListener('mousemove', (e) => {
      if (!this.enabled || this.dead) return;
      if (document.pointerLockElement !== this.renderer.domElement) return;
      const sens = this.sensitivity * (this.adsAmount > 0.5 ? 0.62 : 1);
      this.yaw -= e.movementX * sens;
      this.pitch -= e.movementY * sens;
      this.pitch = clamp(this.pitch, -1.42, 1.42);
      this.lookDX += e.movementX;
      this.lookDY += e.movementY;
    });

    const dom = this.renderer.domElement;
    dom.addEventListener('mousedown', (e) => {
      if (!this.enabled || this.dead) return;
      if (document.pointerLockElement !== dom) return;
      if (e.button === 0) this.weapon.setTrigger(true);
      if (e.button === 2) this.adsHeld = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.weapon.setTrigger(false);
      if (e.button === 2) this.adsHeld = false;
    });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== dom && this.enabled && !this.dead) {
        // released by the browser (Esc) — the shell pauses the run
        this.onPointerUnlock?.();
      }
    });
  }

  setTouch(on) {
    this.isTouch = on;
  }

  lookTouch(dx, dy) {
    if (!this.enabled || this.dead) return;
    const sens = 0.0034 * (this.adsAmount > 0.5 ? 0.6 : 1);
    this.yaw -= dx * sens;
    this.pitch = clamp(this.pitch - dy * sens, -1.42, 1.42);
    this.lookDX += dx;
    this.lookDY += dy;
  }

  setTouchMove(x, y) {
    this.touchMove.set(x, y);
  }

  setTrigger(v) {
    if (this.dead) return;
    this.weapon.setTrigger(v);
  }

  setADS(v) {
    this.adsHeld = v;
  }

  jump() {
    if (this.dead || !this.grounded || !this.enabled) return;
    this.vy = 5.5;
    this.grounded = false;
    this.audio.jump();
  }

  // ------------------------------------------------------------------ damage
  applyDamage(amount, sourcePos = null, opts = {}) {
    if (this.dead || this.invuln > 0) return;
    this.health -= amount;
    this.lastDamage = this.time;
    this.invuln = 0.08;
    this.trauma = Math.min(1, this.trauma + (opts.explosion ? 0.75 : 0.22 + amount / 140));
    this.audio.hurt();
    if (sourcePos) {
      const dx = sourcePos.x - this.pos.x;
      const dz = sourcePos.z - this.pos.z;
      const bearing = (this.yaw + Math.PI) - Math.atan2(dx, dz);
      let deg = bearing * 180 / Math.PI;
      while (deg > 180) deg -= 360;
      while (deg < -180) deg += 360;
      this.hud.damageFrom(deg, opts.toxic);
    } else {
      this.hud.damageFrom(0, opts.toxic);
    }
    this.hud.setHealth(Math.max(0, this.health), this.maxHealth);
    this.hud.flashDamage(opts.explosion ? 0.85 : 0.5, opts.toxic);
    if (this.health <= 0) this.die();
  }

  heal(amount) {
    if (this.dead) return;
    this.health = Math.min(this.maxHealth, this.health + amount);
    this.hud.setHealth(this.health, this.maxHealth);
    this.audio.pickup();
    this.hud.toast('+ ' + Math.round(amount) + ' VITALS');
  }

  addRecoil(pitch, yaw) {
    this.recoilPitch += pitch;
    this.recoilYaw += yaw;
    this.pitch = clamp(this.pitch + pitch * 0.55, -1.42, 1.42);
  }

  addTrauma(v) {
    this.trauma = Math.min(1, this.trauma + v);
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    this.deathT = 0;
    this.weapon.setTrigger(false);
    this.hud.setHealth(0, this.maxHealth);
    if (document.pointerLockElement) document.exitPointerLock();
    this.onDeath?.();
  }

  // ---------------------------------------------------------------- grenades
  throwGrenade() {
    if (this.dead || this.grenades <= 0 || this.grenadeCooldown > 0) return;
    this.grenades--;
    this.grenadeCooldown = 0.7;
    this.hud.setGrenades(this.grenades);
    this.audio.reload(0);
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.085, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0x2b3a22, roughness: 0.6, metalness: 0.5, emissive: 0x224411, emissiveIntensity: 1 })
    );
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    mesh.position.copy(this.camera.position).addScaledVector(fwd, 0.5);
    mesh.position.y -= 0.1;
    this.scene.add(mesh);
    const vel = fwd.clone().multiplyScalar(15).add(new THREE.Vector3(0, 3.2, 0)).add(this.vel.clone().multiplyScalar(0.4));
    this.grenadeList.push({ mesh, vel, timer: 2.4, blink: 0 });
  }

  _updateGrenades(dt) {
    this.grenadeCooldown = Math.max(0, this.grenadeCooldown - dt);
    for (let i = this.grenadeList.length - 1; i >= 0; i--) {
      const g = this.grenadeList[i];
      g.timer -= dt;
      g.blink += dt;
      g.vel.y -= 20 * dt;
      g.mesh.position.addScaledVector(g.vel, dt);
      g.mesh.rotation.x += dt * 9;
      g.mesh.rotation.z += dt * 6;
      g.mesh.material.emissiveIntensity = 1 + (Math.sin(g.blink * 20) > 0 ? 2.5 : 0);
      if (g.mesh.position.y < 0.1) {
        g.mesh.position.y = 0.1;
        g.vel.y *= -0.42;
        g.vel.x *= 0.7; g.vel.z *= 0.7;
      }
      if (Math.abs(g.mesh.position.x) > 23.2) { g.mesh.position.x = Math.sign(g.mesh.position.x) * 23.2; g.vel.x *= -0.45; }
      if (Math.abs(g.mesh.position.z) > 23.2) { g.mesh.position.z = Math.sign(g.mesh.position.z) * 23.2; g.vel.z *= -0.45; }
      if (g.timer <= 0) {
        const p = g.mesh.position.clone();
        this.scene.remove(g.mesh);
        g.mesh.geometry.dispose();
        g.mesh.material.dispose();
        this.grenadeList.splice(i, 1);
        this.fx.explosion(p, { big: false });
        this.audio.explosion(0, false);
        if (this.manager) {
          this.manager.damageArea(p, 6.4, 210, null);
          const d = this.pos.distanceTo(p);
          if (d < 5.4) this.applyDamage(48 * (1 - d / 6.4), p, { explosion: true });
        }
        this.addTrauma(0.6);
      }
    }
  }

  // ------------------------------------------------------------------- melee
  melee() {
    if (this.meleeCooldown > 0 || this.dead) return;
    this.meleeCooldown = 0.85;
    this.audio.scratch(0.2);
    this.weapon.recoil = 0.7;
    this.weapon.recoilRot = 0.7;
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    if (!this.manager) return;
    let best = null, bd = 2.9;
    for (const z of this.manager.zombies) {
      if (z.dead) continue;
      const to = z.pos.clone().sub(this.pos);
      to.y = 0;
      const d = to.length();
      if (d > bd) continue;
      to.normalize();
      if (to.dot(new THREE.Vector3(fwd.x, 0, fwd.z).normalize()) > 0.55) { best = z; bd = d; }
    }
    if (best) {
      const p = best.pos.clone().add(new THREE.Vector3(0, 1.1 * best.scale, 0));
      best.takeDamage(120, { point: p, dir: fwd });
      this.fx.bloodBurst(p, fwd, 16, false);
      this.audio.hit(false);
      this.hud.hitmarker(false, best.dead);
    }
  }

  // ------------------------------------------------------------------ update
  update(dt, time) {
    this.time = time;
    this.invuln = Math.max(0, this.invuln - dt);

    if (this.dead) {
      this.deathT += dt;
      const k = Math.min(1, this.deathT / 1.2);
      this.camera.position.set(this.pos.x, this.pos.y + this.eyeHeight - k * 1.35, this.pos.z);
      this.camera.rotation.z = k * 0.6;
      this.camera.rotation.x = this.pitch * (1 - k) - k * 0.2;
      return;
    }
    if (!this.enabled) return;

    this._updateGrenades(dt);
    this.meleeCooldown = Math.max(0, this.meleeCooldown - dt);

    // ------------------------------------------------------------- movement
    let ix = (this.keys.KeyD ? 1 : 0) - (this.keys.KeyA ? 1 : 0) + this.touchMove.x;
    let iz = (this.keys.KeyW ? 1 : 0) - (this.keys.KeyS ? 1 : 0) + this.touchMove.y;
    const mag = Math.hypot(ix, iz);
    if (mag > 1) { ix /= mag; iz /= mag; }
    const moving = mag > 0.08;

    this._fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this._right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this._desired.set(0, 0, 0)
      .addScaledVector(this._fwd, iz)
      .addScaledVector(this._right, ix);

    const wantSprint = (this.keys.ShiftLeft || this.keys.ShiftRight) && iz > 0.15 && !this.adsHeld && this.stamina > 1;
    this.sprinting = wantSprint && moving;
    const targetSpeed = this.adsHeld ? 2.7 : this.sprinting ? 7.4 : 4.55;
    const accel = this.grounded ? 14 : 3.5;
    const targetVel = this._desired.clone().multiplyScalar(targetSpeed);
    this.vel.x += (targetVel.x - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (targetVel.z - this.vel.z) * Math.min(1, accel * dt);

    const nx = this.pos.x + this.vel.x * dt;
    const nz = this.pos.z + this.vel.z * dt;
    const res = this.world.collideCircle(nx, nz, this.radius);
    this.pos.x = clamp(res.x, -23.1, 23.1);
    this.pos.z = clamp(res.z, -23.1, 23.1);

    // vertical
    if (!this.grounded) {
      this.vy -= 16 * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= 0) {
        this.pos.y = 0;
        this.vy = 0;
        this.grounded = true;
        this.addTrauma(0.12);
        this.audio.footstep(false);
      }
    }

    const speedMag = Math.hypot(this.vel.x, this.vel.z);
    this.speedFactor = clamp(speedMag / 7.4, 0, 1);

    if (this.grounded && moving) {
      this.bobPhase += dt * (this.sprinting ? 11.5 : 7.2);
      this.footTimer -= dt;
      if (this.footTimer <= 0) {
        this.footTimer = this.sprinting ? 0.31 : 0.46;
        this.audio.footstep(this.sprinting);
        this.addTrauma(0.018);
      }
    } else if (!moving) {
      this.bobPhase += dt * 1.5;
    }

    // stamina
    if (this.sprinting) {
      this.stamina = Math.max(0, this.stamina - dt * 19);
      this.staminaDelay = 1.0;
    } else {
      this.staminaDelay = Math.max(0, this.staminaDelay - dt);
      if (this.staminaDelay <= 0) this.stamina = Math.min(100, this.stamina + dt * 16);
    }

    // health regen up to a floor of 55
    if (time - this.lastDamage > 6.5 && this.health < 55) {
      this.health = Math.min(55, this.health + dt * 2.8);
      this.hud.setHealth(this.health, this.maxHealth);
    }

    // low health heartbeat
    if (this.health < 32) {
      this.heartTimer -= dt;
      if (this.heartTimer <= 0) {
        this.heartTimer = 0.95;
        this.audio.heartbeat();
      }
    }

    // ------------------------------------------------------------- camera
    const adsFov = 54;
    const fovTarget = this.adsHeld ? adsFov : this.sprinting ? 78 : 72;
    this.camera.fov += (fovTarget - this.camera.fov) * Math.min(1, dt * 9);
    this.camera.updateProjectionMatrix();

    this.recoilPitch *= Math.pow(0.0001, dt);
    this.recoilYaw *= Math.pow(0.0001, dt);
    this.trauma = Math.max(0, this.trauma - dt * 1.5);
    const shake = this.trauma * this.trauma * this.shakeScale;
    const bobY = this.grounded && moving ? Math.sin(this.bobPhase * 2) * 0.035 * (1 - this.adsAmount * 0.8) : 0;
    const bobX = this.grounded && moving ? Math.sin(this.bobPhase) * 0.026 * (1 - this.adsAmount * 0.8) : 0;

    this.swayX += (this.lookDX * 0.00022 - this.swayX) * Math.min(1, dt * 8);
    this.swayY += (this.lookDY * 0.00022 - this.swayY) * Math.min(1, dt * 8);
    this.lookDX = 0; this.lookDY = 0;

    this.camera.position.set(
      this.pos.x + bobX + Math.sin(time * 43) * 0.035 * shake,
      this.pos.y + this.eyeHeight + bobY + Math.sin(time * 51) * 0.04 * shake,
      this.pos.z + Math.cos(time * 39) * 0.03 * shake
    );
    this.camera.rotation.y = this.yaw + this.recoilYaw + Math.sin(time * 37) * 0.012 * shake;
    this.camera.rotation.x = this.pitch + this.recoilPitch + Math.sin(time * 47) * 0.014 * shake;
    this.camera.rotation.z = Math.sin(time * 33) * 0.02 * shake;

    this.camera.updateMatrixWorld();
    this.weapon.update(dt, time);

    this.hud.setStamina(this.stamina);
    this.hud.setLowHealth(this.health < 32);
    this.hud.setADS(this.adsAmount > 0.6);
  }

  reset() {
    this.pos.set(0, 0, 14.5);
    this.vel.set(0, 0, 0);
    this.yaw = 0;
    this.pitch = 0;
    this.health = 100;
    this.stamina = 100;
    this.grenades = 3;
    this.dead = false;
    this.deathT = 0;
    this.grounded = true;
    this.vy = 0;
    this.trauma = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.lastDamage = -99;
    this.invuln = 1.5;
    this.weapon.ammo = { rifle: 30, shotgun: 6 };
    this.weapon.reserve = { rifle: 240, shotgun: 48 };
    this.weapon.current = 'rifle';
    this.weapon.reloading = 0;
    this.weapon.setVisible('rifle', true);
    this.weapon.setVisible('shotgun', false);
    this.weapon.hud.setWeapon('MK-7 CARBINE', 30, 240);
    this.hud.setHealth(100, 100);
    this.hud.setGrenades(3);
    this.hud.setStamina(100);
    this.hud.setLowHealth(false);
    for (const g of this.grenadeList) { this.scene.remove(g.mesh); g.mesh.geometry.dispose(); g.mesh.material.dispose(); }
    this.grenadeList.length = 0;
  }
}
