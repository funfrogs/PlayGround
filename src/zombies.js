import * as THREE from 'three';
import { getTextures } from './textures.js';

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[(Math.random() * a.length) | 0];

const TYPES = {
  walker: {
    hp: 115, speed: 1.55, damage: 12, radius: 0.5, attackRange: 2.05, score: 100,
    eye: 0xffc24a, climb: false, height: 1.9,
  },
  runner: {
    hp: 78, speed: 3.25, damage: 8, radius: 0.45, attackRange: 2.0, score: 140,
    eye: 0xff7a2a, climb: false, height: 1.85,
  },
  climber: {
    hp: 145, speed: 3.7, damage: 16, radius: 0.46, attackRange: 2.15, score: 220,
    eye: 0xff2a2a, climb: true, height: 2.1,
  },
  boomer: {
    hp: 820, speed: 1.05, damage: 30, radius: 0.95, attackRange: 3.1, score: 500,
    eye: 0x9dff3a, climb: false, height: 2.7, explode: true,
  },
  boss: {
    hp: 4200, speed: 1.25, damage: 45, radius: 1.4, attackRange: 4.2, score: 3000,
    eye: 0x9dff3a, climb: false, height: 4.0, explode: true, boss: true,
  },
};

const SKINS = [0x8b9678, 0x7d8a6c, 0x9aa08a, 0x6f7b63, 0x8a8f7c, 0x73806b];
const SHIRTS = [0x4a3f35, 0x3c4a52, 0x5a4a3a, 0x3d3d3d, 0x54443f, 0x2f3d3a, 0x6b5a46];
const PANTS = [0x2e3338, 0x34302b, 0x2a2f2a, 0x3a3430, 0x25282c];

const shared = {};
function geo(key, make) { return shared[key] || (shared[key] = make()); }

const _tmpV = new THREE.Vector3();

export class Zombie {
  constructor(type, wave, scene, manager, spawnPos) {
    this.type = type;
    this.cfg = TYPES[type];
    this.manager = manager;
    this.scene = scene;
    this.wave = wave;
    this.scale = this.cfg.boss ? 1.5 : this.cfg.explode ? rand(1.0, 1.12) : rand(0.92, 1.08);
    this.maxHp = this.cfg.hp * (1 + Math.max(0, wave - 1) * 0.14);
    if (this.cfg.boss) this.maxHp = this.cfg.hp * (1 + Math.max(0, wave - 5) * 0.25);
    this.hp = this.maxHp;
    this.speed = this.cfg.speed * (1 + Math.min(0.35, Math.max(0, wave - 1) * 0.025)) * rand(0.94, 1.06);
    this.damage = this.cfg.damage * (1 + Math.max(0, wave - 1) * 0.06);
    this.radius = this.cfg.radius * this.scale;
    this.state = 'chase';
    this.dead = false;
    this.deadTime = 0;
    this.walkPhase = rand(0, 6.28);
    this.attackTimer = 0;
    this.attackCooldown = rand(0.2, 0.8);
    this.staggerTimer = 0;
    this.flashTimer = 0;
    this.fuseTimer = 0;
    this.beepTimer = 0;
    this.pendingExplode = -1;
    this.exploded = false;
    this.entry = true;
    this.y = 0;
    this.vy = 0;
    this.climb = null;
    this.growlTimer = rand(1, 4);
    this.turn = rand(-0.2, 0.2);
    this.lastHitDir = new THREE.Vector3(0, 0, 1);
    this.hitMeshes = [];

    this.pos = new THREE.Vector3(spawnPos.x, 0, spawnPos.z);
    this.group = new THREE.Group();
    this.group.position.copy(this.pos);
    this.group.rotation.y = Math.atan2(-spawnPos.x, -spawnPos.z);
    scene.add(this.group);

    this._buildModel();

    this.group.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        this.hitMeshes.push(o);
      }
    });

    // spawn pop: scale in
    this.spawnT = 0.35;
    this.group.scale.multiplyScalar(0.001);
    this.baseScale = this.scale;
    this.group.scale.setScalar(0.001);
  }

  // ------------------------------------------------------------------- model
  _mats() {
    const T = getTextures();
    const skinCol = pick(SKINS);
    this.skinMat = new THREE.MeshStandardMaterial({
      map: pick(T.skin), color: 0xffffff,
      roughness: 0.82, metalness: 0.02, envMapIntensity: 0.4,
    });
    this.shirtMat = new THREE.MeshStandardMaterial({
      map: pick(T.cloth), roughness: 0.96, metalness: 0.01, envMapIntensity: 0.3,
    });
    this.pantsMat = new THREE.MeshStandardMaterial({
      map: pick(T.pants), roughness: 0.96, metalness: 0.01,
    });
    this.darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1b1c, roughness: 0.85, metalness: 0.1 });
    this.hairMat = new THREE.MeshStandardMaterial({ color: pick([0x2b2119, 0x3a2c20, 0x24211d]), roughness: 0.95 });
    this.boneMat = new THREE.MeshStandardMaterial({ color: 0x9a9484, roughness: 0.8 });
    this.mats = [this.skinMat, this.shirtMat, this.pantsMat, this.darkMat];
    for (const m of this.mats) m.userData.baseEmissive = m.emissive ? m.emissive.getHex() : 0;
  }

  _mark(mesh, part) {
    mesh.userData.zombie = this;
    mesh.userData.part = part;
    return mesh;
  }

  _buildModel() {
    this._mats();
    const body = new THREE.Group();
    this.body = body;
    this.group.add(body);

    const upper = new THREE.Group();
    upper.position.y = 0.86;
    body.add(upper);
    this.upper = upper;

    const isBoomer = this.cfg.explode;
    const isClimber = this.type === 'climber';

    // ------------------------------------------------------------- legs
    const legR = isBoomer ? 0.19 : 0.085;
    const legLen = isBoomer ? 0.42 : 0.4;
    const hipY = 0.86;
    this.legs = [];
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * (isBoomer ? 0.24 : 0.13) * (isBoomer ? 1.3 : 1), hipY, 0);
      body.add(hip);
      const thigh = new THREE.Mesh(
        geo('thigh' + (isBoomer ? 'b' : ''), () => new THREE.CylinderGeometry(legR * 1.1, legR, legLen, 8)),
        this.pantsMat
      );
      thigh.position.y = -legLen / 2;
      thigh.scale.z = isBoomer ? 1.2 : 1;
      this._mark(thigh, 'limb');
      hip.add(thigh);
      const knee = new THREE.Group();
      knee.position.y = -legLen;
      hip.add(knee);
      const shin = new THREE.Mesh(
        geo('shin' + (isBoomer ? 'b' : ''), () => new THREE.CylinderGeometry(legR * 0.95, legR * 0.7, legLen, 8)),
        this.pantsMat
      );
      shin.position.y = -legLen / 2;
      this._mark(shin, 'limb');
      knee.add(shin);
      const foot = new THREE.Mesh(
        geo('foot', () => new THREE.BoxGeometry(0.15, 0.09, 0.28)),
        this.darkMat
      );
      foot.position.set(0, -legLen - 0.02, 0.06);
      this._mark(foot, 'limb');
      knee.add(foot);
      this.legs.push({ hip, knee, shin, side });
    }

    // ------------------------------------------------------------- torso
    const chestW = isBoomer ? 0.82 : 0.46;
    const chestH = isBoomer ? 0.5 : 0.44;
    const chestD = isBoomer ? 0.5 : 0.26;
    const pelvis = new THREE.Mesh(
      geo('pelvis' + (isBoomer ? 'b' : ''), () => new THREE.BoxGeometry(isBoomer ? 0.62 : 0.4, 0.22, isBoomer ? 0.44 : 0.26)),
      this.pantsMat
    );
    pelvis.position.y = 0.04;
    this._mark(pelvis, 'body');
    upper.add(pelvis);

    const abdomen = new THREE.Mesh(
      geo('abd' + (isBoomer ? 'b' : ''), () => new THREE.CylinderGeometry(
        isBoomer ? 0.42 : 0.19, isBoomer ? 0.38 : 0.17, isBoomer ? 0.4 : 0.28, 10
      )),
      this.shirtMat
    );
    abdomen.scale.z = isBoomer ? 1.24 : 0.68;
    abdomen.position.y = isBoomer ? 0.3 : 0.22;
    this._mark(abdomen, 'body');
    upper.add(abdomen);

    const chest = new THREE.Mesh(
      geo('chest' + (isBoomer ? 'b' : ''), () => new THREE.CylinderGeometry(
        isBoomer ? 0.46 : 0.245, isBoomer ? 0.42 : 0.195, isBoomer ? 0.5 : 0.44, 10
      )),
      this.shirtMat
    );
    chest.scale.z = isBoomer ? 1.15 : 0.6;
    chest.position.y = isBoomer ? 0.72 : 0.54;
    this._mark(chest, 'body');
    upper.add(chest);

    if (isBoomer) {
      // bloated belly
      const belly = new THREE.Mesh(
        geo('belly', () => new THREE.SphereGeometry(0.5, 16, 14)),
        this.skinMat
      );
      belly.scale.set(1.14, 1.0, 0.98);
      belly.position.set(0, 0.34, 0.15);
      this._mark(belly, 'body');
      upper.add(belly);
      // stretched, filthy shirt clinging over the sac
      const shirt = new THREE.Mesh(
        geo('bellyshirt', () => new THREE.SphereGeometry(0.515, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55)),
        this.shirtMat
      );
      shirt.scale.set(1.12, 0.9, 0.96);
      shirt.position.set(0, 0.42, 0.13);
      shirt.rotation.x = 0.1;
      shirt.userData.noHit = true;
      upper.add(shirt);
      // toxic sacs — dim, sickly, not a glowing orb
      this.sacs = [];
      const sacMat = new THREE.MeshStandardMaterial({
        color: 0x3c5a22, emissive: 0x5aa020, emissiveIntensity: 0.55, roughness: 0.35, metalness: 0.1,
      });
      const sacGeo = new THREE.SphereGeometry(0.1, 10, 8);
      const spots = [[0.38, 0.55, 0.42], [-0.34, 0.28, 0.46], [0.12, 0.7, 0.44], [-0.2, 0.62, -0.42], [0.4, 0.2, -0.36]];
      for (const [sx, sy, sz] of spots) {
        const s = new THREE.Mesh(sacGeo, sacMat);
        s.position.set(sx, sy, sz);
        s.scale.setScalar(rand(0.65, 1.2));
        s.userData.noHit = true;
        upper.add(s);
        this.sacs.push(s);
      }
      this.sacMat = sacMat;
    }

    // shoulders
    if (!isBoomer) {
      for (const side of [-1, 1]) {
        const sh = new THREE.Mesh(geo('shoulder', () => new THREE.SphereGeometry(0.1, 8, 6)), this.shirtMat);
        sh.position.set(side * 0.27, 0.64, 0);
        sh.scale.set(1.1, 0.9, 1);
        this._mark(sh, 'limb');
        upper.add(sh);
      }
    }

    // ------------------------------------------------------------- arms
    this.arms = [];
    const armLen = isBoomer ? 0.46 : isClimber ? 0.46 : 0.34;
    const armR = isBoomer ? 0.18 : 0.07;
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * (isBoomer ? 0.62 : 0.3), isBoomer ? 0.62 : 0.6, 0);
      upper.add(shoulder);
      const upperArm = new THREE.Mesh(
        geo('uarm' + (isBoomer ? 'b' : ''), () => new THREE.CylinderGeometry(armR * 1.1, armR, armLen, 8)),
        isClimber ? this.skinMat : this.shirtMat
      );
      upperArm.position.y = -armLen / 2;
      this._mark(upperArm, 'limb');
      shoulder.add(upperArm);
      const elbow = new THREE.Group();
      elbow.position.y = -armLen;
      shoulder.add(elbow);
      const lowerArm = new THREE.Mesh(
        geo('larm' + (isBoomer ? 'b' : ''), () => new THREE.CylinderGeometry(armR * 0.85, armR * 0.65, armLen, 8)),
        this.skinMat
      );
      lowerArm.position.y = -armLen / 2;
      this._mark(lowerArm, 'limb');
      elbow.add(lowerArm);
      const hand = new THREE.Mesh(
        geo('hand' + (isClimber ? 'c' : ''), () => new THREE.BoxGeometry(isClimber ? 0.14 : 0.1, 0.14, isClimber ? 0.2 : 0.09)),
        this.skinMat
      );
      hand.position.set(0, -armLen - 0.05, isClimber ? 0.03 : 0);
      this._mark(hand, 'limb');
      elbow.add(hand);
      if (isClimber) {
        for (let f = 0; f < 3; f++) {
          const claw = new THREE.Mesh(geo('claw', () => new THREE.ConeGeometry(0.018, 0.16, 4)), this.boneMat);
          claw.position.set(-0.045 + f * 0.045, -armLen - 0.1, 0.09);
          claw.rotation.x = 1.2;
          claw.userData.noHit = true;
          elbow.add(claw);
        }
      }
      shoulder.rotation.z = side * (isBoomer ? 0.5 : 0.12);
      shoulder.rotation.x = isClimber ? -0.15 : isBoomer ? -0.2 : -0.85;
      elbow.rotation.x = isBoomer ? -0.2 : -0.7;
      this.arms.push({ shoulder, elbow, side });
    }

    // ------------------------------------------------------------- head
    const neck = new THREE.Mesh(
      geo('neck', () => new THREE.CylinderGeometry(0.07, 0.08, 0.1, 8)),
      this.skinMat
    );
    neck.position.y = isBoomer ? 0.96 : 0.78;
    this._mark(neck, 'body');
    upper.add(neck);

    const headGroup = new THREE.Group();
    headGroup.position.y = isBoomer ? 1.02 : 0.86;
    upper.add(headGroup);
    this.headGroup = headGroup;

    const headR = isBoomer ? 0.2 : 0.165;
    const head = new THREE.Mesh(
      geo('head' + (isBoomer ? 'b' : ''), () => new THREE.SphereGeometry(1, 14, 12)),
      this.skinMat
    );
    head.scale.set(headR, headR * 1.16, headR * 1.04);
    head.position.y = headR * 0.75;
    this._mark(head, 'head');
    headGroup.add(head);
    this.headMesh = head;

    // jaw
    const jaw = new THREE.Mesh(
      geo('jaw' + (isBoomer ? 'b' : ''), () => new THREE.BoxGeometry(isBoomer ? 0.22 : 0.16, 0.07, 0.14)),
      this.skinMat
    );
    jaw.position.set(0, headR * 0.12, headR * 0.72);
    jaw.rotation.x = 0.28;
    this._mark(jaw, 'head');
    headGroup.add(jaw);
    this.jaw = jaw;
    // dark mouth cavity
    const mouth = new THREE.Mesh(
      geo('mouth', () => new THREE.BoxGeometry(0.1, 0.07, 0.05)),
      new THREE.MeshBasicMaterial({ color: 0x120808 })
    );
    mouth.position.set(0, headR * 0.34, headR * 0.8);
    mouth.userData.noHit = true;
    headGroup.add(mouth);
    // teeth
    const teeth = new THREE.Mesh(
      geo('teeth', () => new THREE.BoxGeometry(0.11, 0.025, 0.03)),
      new THREE.MeshStandardMaterial({ color: 0xd8d2b8, roughness: 0.5 })
    );
    teeth.position.set(0, headR * 0.42, headR * 0.86);
    teeth.userData.noHit = true;
    headGroup.add(teeth);

    // eyes — sunken sockets with a small ember
    const eyeMat = new THREE.MeshBasicMaterial({ color: this.cfg.eye, toneMapped: false });
    this.eyeMat = eyeMat;
    const socketMat = new THREE.MeshBasicMaterial({ color: 0x070806 });
    for (const side of [-1, 1]) {
      const socket = new THREE.Mesh(geo('socket', () => new THREE.SphereGeometry(0.042, 8, 6)), socketMat);
      socket.position.set(side * headR * 0.42, headR * 0.92, headR * 0.8);
      socket.scale.set(1, 0.85, 0.6);
      socket.userData.noHit = true;
      headGroup.add(socket);
      const eye = new THREE.Mesh(geo('eye', () => new THREE.SphereGeometry(0.019, 8, 6)), eyeMat);
      eye.position.set(side * headR * 0.42, headR * 0.92, headR * 0.9);
      eye.userData.noHit = true;
      headGroup.add(eye);
    }
    const eyeGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getTextures().glow, color: this.cfg.eye, transparent: true, opacity: 0.42,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    eyeGlow.scale.setScalar(isBoomer ? 0.34 : 0.19);
    eyeGlow.position.set(0, headR * 0.92, headR * 1.02);
    headGroup.add(eyeGlow);
    this.eyeGlow = eyeGlow;

    // heavy brow ridge and nose
    const brow = new THREE.Mesh(
      geo('brow' + (isBoomer ? 'b' : ''), () => new THREE.BoxGeometry(headR * 1.34, headR * 0.17, headR * 0.4)),
      this.skinMat
    );
    brow.position.set(0, headR * 1.06, headR * 0.72);
    brow.userData.noHit = true;
    headGroup.add(brow);
    const nose = new THREE.Mesh(
      geo('nose' + (isBoomer ? 'b' : ''), () => new THREE.BoxGeometry(headR * 0.26, headR * 0.42, headR * 0.32)),
      this.skinMat
    );
    nose.position.set(0, headR * 0.66, headR * 0.96);
    nose.rotation.x = 0.16;
    nose.userData.noHit = true;
    headGroup.add(nose);

    // hair / hat
    if (!isBoomer && Math.random() < 0.4) {
      if (Math.random() < 0.5) {
        const hat = new THREE.Mesh(
          geo('hat', () => new THREE.CylinderGeometry(0.17, 0.19, 0.08, 10)),
          this.darkMat
        );
        hat.position.y = headR * 1.55;
        hat.userData.noHit = true;
        headGroup.add(hat);
      } else {
        const hair = new THREE.Mesh(
          geo('hair', () => new THREE.SphereGeometry(0.17, 10, 8, 0, 6.28, 0, 1.4)),
          this.hairMat
        );
        hair.position.y = headR * 0.92;
        hair.rotation.x = -0.2;
        hair.scale.set(1.04, 0.92, 1.02);
        hair.userData.noHit = true;
        headGroup.add(hair);
      }
    }

    // blood stains
    const bloodMat = new THREE.MeshBasicMaterial({
      map: getTextures().blood, transparent: true, opacity: 0.75, depthWrite: false,
      color: 0xaa2020,
    });
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(geo('bstain', () => new THREE.PlaneGeometry(0.22, 0.22)), bloodMat);
      if (i === 0) b.position.set(rand(-0.08, 0.08), 0.6, chestD / 2 + 0.005);
      else if (i === 1) b.position.set(rand(-0.14, 0.14), 0.3, chestD / 2 + 0.005);
      else b.position.set(rand(-0.08, 0.08), headR * 0.5, headR * 0.94);
      b.scale.setScalar(rand(0.7, 1.5));
      b.rotation.z = rand(0, 6);
      b.userData.noHit = true;
      if (i === 2) headGroup.add(b); else upper.add(b);
    }

    // tattered shirt hem and belt
    const belt = new THREE.Mesh(
      geo('belt', () => new THREE.CylinderGeometry(0.21, 0.21, 0.05, 10)),
      this.darkMat
    );
    belt.scale.z = 0.62;
    belt.position.y = 0.08;
    belt.userData.noHit = true;
    upper.add(belt);
    if (!isBoomer) {
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const flap = new THREE.Mesh(
          geo('hem', () => new THREE.BoxGeometry(0.11, 0.16, 0.02)),
          this.shirtMat
        );
        flap.position.set(Math.cos(a) * 0.19, -0.03 - Math.random() * 0.05, Math.sin(a) * 0.13);
        flap.rotation.y = -a;
        flap.rotation.x = rand(-0.3, 0.3);
        flap.rotation.z = rand(-0.25, 0.25);
        flap.userData.noHit = true;
        upper.add(flap);
      }
    }

    // exposed ribs for climbers
    if (isClimber) {
      const ribMat = new THREE.MeshStandardMaterial({ color: 0xb0a894, roughness: 0.7 });
      for (let i = 0; i < 3; i++) {
        const rib = new THREE.Mesh(geo('rib', () => new THREE.TorusGeometry(0.1, 0.012, 4, 8, Math.PI)), ribMat);
        rib.position.set(0.1, 0.35 + i * 0.08, 0.13);
        rib.rotation.set(0.3, 0.5, 0);
        rib.userData.noHit = true;
        upper.add(rib);
      }
    }

    // climber hunch
    if (isClimber) {
      upper.rotation.x = 0.22;
      headGroup.rotation.x = -0.2;
      body.position.y = 0.05;
    } else {
      upper.rotation.x = isBoomer ? 0.05 : 0.08;
    }
    headGroup.rotation.z = rand(-0.14, 0.14);

    // scale
    this.group.scale.setScalar(this.scale);
  }

  // ------------------------------------------------------------------- damage
  takeDamage(amount, { headshot = false, point = null, dir = null } = {}) {
    if (this.dead) return false;
    const dmg = amount * (headshot ? 2.7 : 1);
    this.hp -= dmg;
    this.flashTimer = 0.09;
    for (const m of this.mats) {
      if (m.emissive) m.emissive.setHex(headshot ? 0xaa2222 : 0x551111);
    }
    if (dir) this.lastHitDir.copy(dir);
    if (this.hp <= 0) {
      this.die(headshot);
      return true;
    }
    // small stagger on heavy hits
    if (dmg > 45 && !this.cfg.boss && Math.random() < 0.22) {
      this.staggerTimer = 0.32;
      this.state = 'stagger';
    }
    return false;
  }

  die(headshot = false) {
    if (this.dead) return;
    this.dead = true;
    this.state = 'dead';
    this.deadTime = 0;
    this.attackTimer = 0;
    this.climb = null;
    this.eyeGlow.material.opacity = 0;
    this.eyeMat.color.setHex(0x111111);
    for (const m of this.mats) if (m.emissive) m.emissive.setHex(0x000000);
    this.manager.fx.bloodPool(this.pos.x, this.pos.z, this.cfg.boss ? 5 : this.cfg.explode ? 3.2 : rand(1.2, 2.1));
    this.manager.fx.bloodBurst(
      this.pos.clone().add(new THREE.Vector3(0, 1.1 * this.scale, 0)),
      this.lastHitDir, 18, headshot
    );
    this.manager.onZombieKilled(this, headshot);
    if (this.cfg.explode) this.pendingExplode = this.cfg.boss ? 0.7 : 0.35;
  }

  explode() {
    if (this.exploded) return;
    this.exploded = true;
    const p = this.pos.clone();
    p.y += 0.8 * this.scale;
    const big = this.cfg.boss;
    const radius = big ? 8.5 : 5.6;
    this.manager.fx.explosion(p, { big, toxic: true });
    this.manager.fx.addToxicCloud(this.pos.clone(), big ? 8 : 5.4, big ? 14 : 9);
    this.manager.damageArea(this.pos, radius, big ? 90 : 45, this);
    const player = this.manager.player;
    if (player && !player.dead) {
      const d = player.pos.distanceTo(this.pos);
      if (d < radius) {
        const falloff = 1 - Math.max(0, d - 1.2) / radius;
        player.applyDamage((big ? 62 : 34) * Math.max(0.25, falloff), this.pos.clone(), { explosion: true });
      }
    }
    this.manager.audio.explosion(0, big);
    this.manager.onBoomerExploded?.(this);
    if (!this.dead) this.die(false);
    this.manager.removeZombie(this);
  }

  // ------------------------------------------------------------------ update
  update(dt, player, world, fx, audio, zombies, time) {
    if (this.spawnT > 0) {
      this.spawnT -= dt;
      const k = Math.max(0, 1 - this.spawnT / 0.35);
      this.group.scale.setScalar(this.baseScale * (0.001 + k * (1.15 - k * 0.15)));
      if (this.spawnT <= 0) this.group.scale.setScalar(this.baseScale);
    }

    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) for (const m of this.mats) if (m.emissive) m.emissive.setHex(0x000000);
    }

    if (this.dead) {
      this.deadTime += dt;
      // fall + sink
      const fall = Math.min(1, this.deadTime / 0.55);
      this.body.rotation.x = fall * (Math.PI / 2) * 0.92;
      this.body.rotation.z += (this.deadTilt || 0) * dt * 0.2;
      if (this.deadTime > 5.5) {
        this.group.position.y -= dt * 0.45;
        if (this.deadTime > 8) this.manager.removeZombie(this);
      }
      return;
    }

    // boomer death fuse
    if (this.pendingExplode >= 0) {
      this.pendingExplode -= dt;
      this.sacPulse = (this.sacPulse || 0) + dt * 22;
      if (this.sacMat) this.sacMat.emissiveIntensity = 3 + Math.sin(this.sacPulse) * 2.5;
      this.group.scale.setScalar(this.baseScale * (1 + Math.sin(this.sacPulse * 1.5) * 0.05));
      if (this.pendingExplode <= 0) this.explode();
      return;
    }

    if (this.staggerTimer > 0) {
      this.staggerTimer -= dt;
      this.upper.rotation.x = -0.4 * (this.staggerTimer / 0.32);
      this.state = 'chase';
      this._animate(dt, time, 0.1);
      this._sync();
      return;
    }

    const toPlayer = _tmpV.set(player.pos.x - this.pos.x, 0, player.pos.z - this.pos.z);
    const dist = toPlayer.length();
    const dir = toPlayer.normalize();

    // ground zombies outside the arena must funnel through a gate
    let moveDir = dir;
    if (!this.cfg.climb) {
      const OUT = 24.15;
      if (this.pos.z > OUT || this.pos.z < -OUT || this.pos.x > OUT || this.pos.x < -OUT) {
        let gx = this.pos.x, gz = this.pos.z;
        if (this.pos.z > OUT) { gz = 23.4; gx = Math.max(-2.1, Math.min(2.1, this.pos.x)); }
        else if (this.pos.z < -OUT) { gz = -23.4; gx = Math.max(-2.1, Math.min(2.1, this.pos.x)); }
        else if (this.pos.x > OUT) { gx = 23.4; gz = Math.max(-2.1, Math.min(2.1, this.pos.z)); }
        else if (this.pos.x < -OUT) { gx = -23.4; gz = Math.max(-2.1, Math.min(2.1, this.pos.z)); }
        moveDir = new THREE.Vector3(gx - this.pos.x, 0, gz - this.pos.z).normalize();
      }
    }

    // growls
    this.growlTimer -= dt;
    if (this.growlTimer <= 0) {
      this.growlTimer = rand(2.4, 6.5);
      if (dist < 32) {
        const pan = this.manager.panFor(this.pos);
        audio.growl(pan, Math.max(0.15, 0.65 - dist / 50), rand(0.85, 1.2), this.type);
      }
    }

    if (this.state === 'climb') {
      this._updateClimb(dt, player);
      this._sync();
      return;
    }

    // boomer fuse trigger
    if (this.cfg.explode && !this.fuseActive && dist < (this.cfg.boss ? 6.5 : 4.6) && this.state !== 'dead') {
      this.fuseActive = true;
      this.fuseTimer = this.cfg.boss ? 2.0 : 1.45;
      this.beepTimer = 0;
      this.state = 'fuse';
      audio.growl(this.manager.panFor(this.pos), 1.0, 0.7, 'boomer');
    }
    if (this.fuseActive) {
      this.fuseTimer -= dt;
      this.beepTimer -= dt;
      this.sacPulse = (this.sacPulse || 0) + dt * 18;
      if (this.sacMat) this.sacMat.emissiveIntensity = 2.4 + Math.sin(this.sacPulse) * 2.2;
      if (this.sacMat) this.sacMat.color.setHex(Math.sin(this.sacPulse * 2) > 0 ? 0x4a7a22 : 0x2d4a1a);
      this.group.scale.setScalar(this.baseScale * (1 + Math.sin(this.sacPulse * 2) * 0.06));
      if (this.beepTimer <= 0) {
        this.beepTimer = Math.max(0.12, this.fuseTimer * 0.18);
        audio.boomerBeep(this.manager.panFor(this.pos), 1 + (1 - this.fuseTimer / (this.cfg.boss ? 2 : 1.45)) * 1.6);
      }
      if (this.fuseTimer <= 0) { this.explode(); return; }
      // keep waddling toward player while fusing
      this._move(dt, player, world, zombies, moveDir, 0.45);
      this._animate(dt, time, 0.6);
      this._sync();
      return;
    }

    // attacks
    if (this.attackTimer > 0) {
      this.attackTimer -= dt;
      this.attackCooldown -= dt;
      if (this.attackTimer <= 0 && dist < this.cfg.attackRange + 0.75) {
        player.applyDamage(this.damage, this.pos.clone(), { type: this.type });
        audio.growl(this.manager.panFor(this.pos), 0.9, rand(0.9, 1.1), this.type);
      }
      this._animate(dt, time, 0.15);
      this._sync();
      return;
    }
    this.attackCooldown -= dt;

    if (dist < this.cfg.attackRange && this.attackCooldown <= 0) {
      this.attackTimer = this.cfg.explode ? 0.6 : this.type === 'climber' ? 0.34 : 0.5;
      this.attackCooldown = this.type === 'climber' ? 1.1 : 1.35;
      this.attackAnim = 0;
      this.state = 'attack';
      if (this.type === 'climber') audio.scratch(this.manager.panFor(this.pos));
      this._animate(dt, time, 0.1);
      this._sync();
      return;
    }

    // movement + steering
    const moved = this._move(dt, player, world, zombies, moveDir, 1);
    if (!moved && this.cfg.climb) {
      const surface = world.nearestClimb(this.pos.x, this.pos.z, 2.4);
      if (surface) this._startClimb(surface);
    }
    // entry climb for climbers that hit a wall
    if (this.cfg.climb && !this.climb && this.state === 'chase') {
      const near = world.nearestClimb(this.pos.x, this.pos.z, 0.9);
      if (near && (this.entry || Math.abs(near.height - 0) > 0.5)) {
        // only start if wall is between us and the player
        const dot = dir.x * near.nx + dir.z * near.nz;
        if (dot < -0.25 || this.entry) this._startClimb(near);
      }
    }

    // look at player
    const targetYaw = Math.atan2(dir.x, dir.z);
    let d = targetYaw - this.group.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.group.rotation.y += d * Math.min(1, dt * (this.type === 'climber' ? 9 : 4));

    this._animate(dt, time, this.state === 'chase' ? 1 : 0.2);
    this._sync();
  }

  _move(dt, player, world, zombies, dir, speedMul) {
    // separation
    let sx = 0, sz = 0;
    for (const other of zombies) {
      if (other === this || other.dead) continue;
      const dx = this.pos.x - other.pos.x;
      const dz = this.pos.z - other.pos.z;
      const d2 = dx * dx + dz * dz;
      const rr = (this.radius + other.radius) * 1.05;
      if (d2 < rr * rr && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        sx += (dx / d) * (1 - d / rr);
        sz += (dz / d) * (1 - d / rr);
      }
    }
    let dx = dir.x + sx * 1.6;
    let dz = dir.z + sz * 1.6;
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl; dz /= dl;

    // whisker obstacle avoidance
    const speed = this.speed * speedMul;
    const probe = 1.1 + this.radius;
    const test = world.collideCircle(this.pos.x + dx * probe, this.pos.z + dz * probe, this.radius);
    const blockedAhead = Math.hypot(test.x - (this.pos.x + dx * probe), test.z - (this.pos.z + dz * probe)) > 0.01;
    if (blockedAhead) {
      const side = (Math.sin(this.walkPhase * 1.7) > 0 ? 1 : -1) * (this.avoidSide || 1);
      const a = Math.atan2(dx, dz) + side * 1.15;
      const ax = Math.sin(a), az = Math.cos(a);
      const test2 = world.collideCircle(this.pos.x + ax * probe, this.pos.z + az * probe, this.radius);
      const blocked2 = Math.hypot(test2.x - (this.pos.x + ax * probe), test2.z - (this.pos.z + az * probe)) > 0.01;
      if (!blocked2) { dx = ax; dz = az; }
      else { this.avoidSide = -(this.avoidSide || 1); }
    }

    const nx = this.pos.x + dx * speed * dt;
    const nz = this.pos.z + dz * speed * dt;
    const res = world.collideCircle(nx, nz, this.radius);
    const actually = Math.hypot(res.x - this.pos.x, res.z - this.pos.z);
    this.pos.x = res.x;
    this.pos.z = res.z;
    // keep inside a generous outer bound (climbers spawn outside the arena)
    this.pos.x = Math.max(-29, Math.min(29, this.pos.x));
    this.pos.z = Math.max(-29, Math.min(29, this.pos.z));
    this.walkPhase += dt * speed * 2.6;
    return actually > speed * dt * 0.35;
  }

  _startClimb(surface) {
    this.state = 'climb';
    this.climb = {
      x: surface.x, z: surface.z, nx: surface.nx, nz: surface.nz,
      top: surface.height, phase: 'up', t: 0, vy: 0,
    };
    this.pos.x = surface.x;
    this.pos.z = surface.z;
    this.pos.y = 0;
    this.group.rotation.y = Math.atan2(-surface.nx, -surface.nz);
    this.group.scale.setScalar(this.baseScale);
    this.manager.audio.scratch(this.manager.panFor(this.pos));
  }

  _updateClimb(dt, player) {
    const c = this.climb;
    if (c.phase === 'up') {
      this.pos.y += 1.75 * dt;
      this.walkPhase += dt * 7;
      if (this.pos.y >= c.top + 0.12) {
        this.pos.y = c.top + 0.12;
        c.phase = 'vault';
        c.t = 0;
        c.sx = this.pos.x; c.sz = this.pos.z;
        this.manager.audio.scratch(this.manager.panFor(this.pos));
      }
    } else if (c.phase === 'vault') {
      c.t += dt / 0.45;
      const t = Math.min(1, c.t);
      this.pos.x = c.sx - c.nx * 1.5 * t;
      this.pos.z = c.sz - c.nz * 1.5 * t;
      this.pos.y = c.top + 0.12 + Math.sin(t * Math.PI) * 0.25;
      if (c.t >= 1) {
        c.phase = 'drop';
        this.vy = 0;
      }
    } else {
      this.vy -= 18 * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= 0) {
        this.pos.y = 0;
        this.state = 'chase';
        this.climb = null;
        this.entry = false;
        this.attackCooldown = 0.4;
        this.manager.fx.smoke.spawn({
          x: this.pos.x, y: 0.1, z: this.pos.z,
          vx: 0, vy: 0.4, vz: 0, life: 0.7, size: 0.3, endSize: 1.1,
          gravity: -0.2, drag: 0.9, color: [0.4, 0.38, 0.34], alpha: 0.25,
        });
        this.manager.audio.footstep?.(false);
      }
    }
    this.group.position.set(this.pos.x, this.pos.y, this.pos.z);
    // climbing animation
    const p = this.walkPhase;
    const reach = Math.sin(p) * 0.75;
    if (this.arms) {
      this.arms[0].shoulder.rotation.x = -2.5 + reach;
      this.arms[1].shoulder.rotation.x = -2.5 - reach;
      this.arms[0].shoulder.rotation.z = -0.25;
      this.arms[1].shoulder.rotation.z = 0.25;
      this.arms[0].elbow.rotation.x = -0.5 - reach * 0.3;
      this.arms[1].elbow.rotation.x = -0.5 + reach * 0.3;
    }
    if (this.legs) {
      this.legs[0].hip.rotation.x = 0.4 + reach * 0.6;
      this.legs[1].hip.rotation.x = 0.4 - reach * 0.6;
      this.legs[0].knee.rotation.x = -0.5 - Math.max(0, reach) * 0.5;
      this.legs[1].knee.rotation.x = -0.5 - Math.max(0, -reach) * 0.5;
    }
    this.upper.rotation.x = 0.12;
    this.headGroup.rotation.x = -0.2;
    this.body.position.y = 0;
    this.body.rotation.x = 0;
    this.group.position.y = this.pos.y;
    this.group.position.x = this.pos.x;
    this.group.position.z = this.pos.z;
  }

  _animate(dt, time, mul) {
    const p = this.walkPhase;
    const isBoomer = this.cfg.explode;
    const isClimber = this.type === 'climber';
    const bob = Math.abs(Math.sin(p)) * (isBoomer ? 0.06 : 0.03) * mul;

    if (this.arms) {
      const swing = Math.sin(p) * (isBoomer ? 0.18 : 0.55) * mul;
      const atk = this.attackTimer > 0 ? 1 - this.attackTimer / (this.cfg.explode ? 0.6 : 0.5) : 0;
      const armRaise = this.attackTimer > 0 ? Math.sin(Math.min(1, atk) * Math.PI) * 1.9 : 0;
      this.arms[0].shoulder.rotation.x = swing + (this.type === 'runner' ? -0.5 : isClimber ? -0.3 : -0.28) - armRaise;
      this.arms[1].shoulder.rotation.x = -swing + (this.type === 'runner' ? -0.5 : isClimber ? -0.3 : -0.28) - armRaise;
      this.arms[0].shoulder.rotation.z = isBoomer ? 0.5 : 0.12 + Math.abs(swing) * 0.08;
      this.arms[1].shoulder.rotation.z = isBoomer ? -0.5 : -0.12 - Math.abs(swing) * 0.08;
      this.arms[0].elbow.rotation.x = -0.5 - Math.max(0, -swing) * 0.6 - armRaise * 0.4;
      this.arms[1].elbow.rotation.x = -0.5 - Math.max(0, swing) * 0.6 - armRaise * 0.4;
      if (isClimber) {
        this.arms[0].shoulder.rotation.x -= 0.45;
        this.arms[1].shoulder.rotation.x -= 0.45;
      }
    }
    if (this.legs) {
      const stride = Math.sin(p) * (isBoomer ? 0.32 : 0.62) * mul;
      this.legs[0].hip.rotation.x = stride;
      this.legs[1].hip.rotation.x = -stride;
      this.legs[0].knee.rotation.x = -Math.max(0, -stride) * 0.85 - 0.05;
      this.legs[1].knee.rotation.x = -Math.max(0, stride) * 0.85 - 0.05;
    }
    this.upper.rotation.x = (isClimber ? 0.22 : isBoomer ? 0.05 : 0.08) + Math.sin(p * 2) * 0.02 + (this.attackTimer > 0 ? 0.18 : 0);
    this.upper.rotation.z = isBoomer ? Math.sin(p) * 0.1 : Math.sin(p) * 0.025;
    this.body.position.y = bob;
    this.headGroup.rotation.x = (isClimber ? -0.2 : 0) + Math.sin(p + 0.6) * 0.05;
    this.headGroup.rotation.y = Math.sin(time * 1.3 + this.walkPhase) * 0.12;
    this.jaw.rotation.x = Math.abs(Math.sin(p * 0.5)) * 0.25 + (this.attackTimer > 0 ? 0.4 : 0);
  }

  _sync() {
    this.group.position.set(this.pos.x, this.pos.y, this.pos.z);
  }
}

// ===========================================================================
export class ZombieManager {
  constructor(scene, world, fx, audio) {
    this.scene = scene;
    this.world = world;
    this.fx = fx;
    this.audio = audio;
    this.zombies = [];
    this.queue = [];
    this.wave = 0;
    this.spawnTimer = 0;
    this.boss = null;
    this.growlTimer = rand(1, 3);
    this.toxicTimer = 0;
    this.onKill = null;
    this.onWaveCleared = null;
    this.onBossUpdate = null;
    this.onBoomerExploded = null;
    this._tmp = new THREE.Vector3();
    this._right = new THREE.Vector3();
  }

  panFor(pos) {
    const cam = this.world.scene.userData.camera;
    if (!cam) return 0;
    const dx = pos.x - cam.position.x, dz = pos.z - cam.position.z;
    const yaw = Math.atan2(dx, dz);
    const camYaw = Math.atan2(
      -cam.matrixWorld.elements[8],
      -cam.matrixWorld.elements[10]
    );
    let a = yaw - camYaw;
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return Math.max(-1, Math.min(1, Math.sin(a) * 0.9));
  }

  startWave(wave) {
    this.wave = wave;
    this.queue.length = 0;
    this.boss = null;
    const w = wave;
    const walkers = 4 + Math.floor(w * 1.5);
    const runners = w >= 2 ? 1 + Math.floor(w * 0.65) : 0;
    const climbers = w >= 3 ? 1 + Math.floor((w - 2) * 0.65) : 0;
    const boomers = w >= 4 ? 1 + Math.floor((w - 4) * 0.5) : 0;
    const boss = w % 5 === 0;

    const gates = [
      { x: 0, z: 27, nx: 0, nz: 1 }, { x: 0, z: -27, nx: 0, nz: -1 },
      { x: 27, z: 0, nx: 1, nz: 0 }, { x: -27, z: 0, nx: -1, nz: 0 },
    ];

    let delay = boss ? 0.5 : 0.3;
    if (boss) {
      const g = gates[1];
      this.queue.push({ type: 'boss', delay: 0.5, x: g.x + rand(-1, 1), z: g.z });
      delay = 2.2;
    }
    for (let i = 0; i < walkers; i++) {
      const g = pick(gates);
      this.queue.push({ type: 'walker', delay: delay + i * rand(0.18, 0.55), x: g.x + rand(-2.2, 2.2) * (g.nz !== 0 ? 1 : 0), z: g.z + rand(-2.2, 2.2) * (g.nx !== 0 ? 1 : 0) });
    }
    delay += walkers * 0.2;
    for (let i = 0; i < runners; i++) {
      const g = pick(gates);
      this.queue.push({ type: 'runner', delay: delay + i * rand(0.2, 0.6), x: g.x + rand(-2, 2) * (g.nz !== 0 ? 1 : 0), z: g.z + rand(-2, 2) * (g.nx !== 0 ? 1 : 0) });
    }
    delay += runners * 0.25;
    for (let i = 0; i < climbers; i++) {
      const a = this._climberAngle();
      this.queue.push({ type: 'climber', delay: delay + i * rand(0.5, 1.0), x: Math.cos(a) * 25.6, z: Math.sin(a) * 25.6 });
    }
    delay += climbers * 0.5;
    for (let i = 0; i < boomers; i++) {
      const g = pick(gates);
      this.queue.push({ type: 'boomer', delay: delay + i * rand(0.8, 1.5), x: g.x + rand(-1.5, 1.5) * (g.nz !== 0 ? 1 : 0), z: g.z + rand(-1.5, 1.5) * (g.nx !== 0 ? 1 : 0) });
    }
    this.queue.sort((a, b) => a.delay - b.delay);
    this.spawnTimer = 0;
    this.audio.waveHorn();
  }

  _climberAngle() {
    // avoid the four gate openings
    for (let tries = 0; tries < 20; tries++) {
      const a = rand(0, Math.PI * 2);
      const nearGate = [0, Math.PI / 2, Math.PI, Math.PI * 1.5].some((g) => {
        let d = Math.abs(a - g);
        if (d > Math.PI) d = Math.PI * 2 - d;
        return d < 0.42;
      });
      if (!nearGate) return a;
    }
    return rand(0, Math.PI * 2);
  }

  spawn(type, x, z) {
    const z0 = new Zombie(type, this.wave, this.scene, this, new THREE.Vector3(x, 0, z));
    this.zombies.push(z0);
    if (type === 'boss') {
      this.boss = z0;
      this.audio.growl(0, 1.8, 0.45, 'boomer');
      this.onBossUpdate?.(1, 'THE ABOMINATION');
    }
    return z0;
  }

  update(dt, player, time) {
    this.player = player;
    this.spawnTimer -= dt;
    // spawn queue
    const alive = this.zombies.filter((z) => !z.dead).length;
    const cap = 20;
    if (this.queue.length && alive < cap) {
      for (const q of this.queue) {
        if (q.delay <= 0) {
          if (alive + 1 > cap) break;
          this.spawn(q.type, q.x, q.z);
          q.done = true;
        } else q.delay -= dt;
      }
      this.queue = this.queue.filter((q) => !q.done);
    }

    // update zombies
    for (let i = this.zombies.length - 1; i >= 0; i--) {
      const z = this.zombies[i];
      z.update(dt, player, this.world, this.fx, this.audio, this.zombies, time);
    }

    // boss hp
    if (this.boss) {
      if (this.boss.dead || this.boss.hp <= 0) {
        this.boss = null;
        this.onBossUpdate?.(0, null);
      } else {
        this.onBossUpdate?.(Math.max(0, this.boss.hp / this.boss.maxHp), 'THE ABOMINATION');
      }
    }

    // toxic damage
    this.toxicTimer -= dt;
    if (this.toxicTimer <= 0) {
      this.toxicTimer = 0.55;
      if (this.fx.damageAt(player.pos, 0.35)) {
        player.applyDamage(5.5, player.pos.clone(), { toxic: true });
      }
    }

    // ambient growl layer
    this.growlTimer -= dt;
    if (this.growlTimer <= 0) {
      this.growlTimer = rand(2.5, 5.5);
      const aliveZ = this.zombies.filter((z) => !z.dead);
      if (aliveZ.length) {
        const z = pick(aliveZ);
        const d = z.pos.distanceTo(player.pos);
        if (d < 30) this.audio.growl(this.panFor(z.pos), Math.max(0.12, 0.5 - d / 70), rand(0.8, 1.15), z.type);
      }
    }
  }

  damageArea(pos, radius, damage, source) {
    for (const z of [...this.zombies]) {
      if (z === source || z.dead) continue;
      if (z.pos.distanceTo(pos) < radius + z.radius) {
        z.takeDamage(damage, { point: z.pos.clone(), dir: z.pos.clone().sub(pos).normalize() });
      }
    }
  }

  onZombieKilled(z, headshot) {
    if (z.cfg.explode && !z.exploded) {
      // boomer explosion is delayed; score is still awarded once
    }
    this.onKill?.(z, headshot);
  }

  removeZombie(z) {
    const i = this.zombies.indexOf(z);
    if (i >= 0) this.zombies.splice(i, 1);
    this.scene.remove(z.group);
    for (const m of z.mats) m.dispose();
    z.skinMat.dispose(); z.shirtMat.dispose(); z.pantsMat.dispose();
    if (z.sacMat) z.sacMat.dispose();
  }

  get aliveCount() {
    return this.zombies.filter((z) => !z.dead).length;
  }

  get remaining() {
    return this.zombies.filter((z) => !z.dead).length + this.queue.filter((q) => !q.done).length;
  }

  get isClear() {
    return this.remaining === 0;
  }

  getHitMeshes() {
    const out = [];
    for (const z of this.zombies) {
      if (z.dead || z.spawnT > 0.2) continue;
      for (const m of z.hitMeshes) if (!m.userData.noHit) out.push(m);
    }
    return out;
  }

  nearestThreat(pos, maxDist = 45) {
    let best = null, bd = maxDist;
    for (const z of this.zombies) {
      if (z.dead) continue;
      const d = z.pos.distanceTo(pos);
      if (d < bd) { bd = d; best = z; }
    }
    return best;
  }
}
