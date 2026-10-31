import * as THREE from 'three';
import { getTextures } from './textures.js';

const rand = (a, b) => a + Math.random() * (b - a);
const V = () => new THREE.Vector3();

class ParticleSystem {
  constructor(scene, texture, { additive = false, max = 500, depthWrite = false } = {}) {
    this.max = max;
    this.cursor = 0;
    this.parts = [];
    const positions = new Float32Array(max * 3);
    const colors = new Float32Array(max * 3);
    const alphas = new Float32Array(max);
    const sizes = new Float32Array(max);
    for (let i = 0; i < max; i++) {
      this.parts.push({ life: 0, maxLife: 1, vx: 0, vy: 0, vz: 0, x: 0, y: -999, z: 0, size: 0.1, endSize: 0.1, gravity: 0, drag: 1, r: 1, g: 1, b: 1, alpha: 1, fade: true });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: texture },
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
      },
      vertexShader: `
        attribute float aSize;
        attribute float aAlpha;
        attribute vec3 aColor;
        varying float vAlpha;
        varying vec3 vColor;
        uniform float uPixelRatio;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = min(180.0, aSize * uPixelRatio * (330.0 / max(0.1, -mv.z)));
          gl_Position = projectionMatrix * mv;
          vAlpha = aAlpha;
          vColor = aColor;
        }`,
      fragmentShader: `
        uniform sampler2D uTex;
        varying float vAlpha;
        varying vec3 vColor;
        void main() {
          vec4 t = texture2D(uTex, gl_PointCoord);
          if (t.a * vAlpha < 0.002) discard;
          gl_FragColor = vec4(vColor * t.rgb, t.a * vAlpha);
        }`,
      transparent: true,
      depthWrite,
      depthTest: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.geo = geo;
    this.mat = mat;
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    scene.add(this.points);
    this.positions = positions;
    this.colors = colors;
    this.alphas = alphas;
    this.sizes = sizes;
  }

  spawn({ x, y, z, vx = 0, vy = 0, vz = 0, life = 1, size = 0.1, endSize = null, gravity = 0, drag = 0.99, color = [1, 1, 1], alpha = 1 }) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const p = this.parts[i];
    p.life = life; p.maxLife = life;
    p.x = x; p.y = y; p.z = z;
    p.vx = vx; p.vy = vy; p.vz = vz;
    p.size = size; p.endSize = endSize === null ? size : endSize;
    p.gravity = gravity; p.drag = drag;
    p.r = color[0]; p.g = color[1]; p.b = color[2]; p.alpha = alpha;
    this.positions[i * 3] = x; this.positions[i * 3 + 1] = y; this.positions[i * 3 + 2] = z;
    this.colors[i * 3] = p.r; this.colors[i * 3 + 1] = p.g; this.colors[i * 3 + 2] = p.b;
    this.alphas[i] = alpha;
    this.sizes[i] = size;
  }

  update(dt) {
    const pos = this.positions, col = this.colors, al = this.alphas, si = this.sizes;
    let dirty = false;
    for (let i = 0; i < this.max; i++) {
      const p = this.parts[i];
      if (p.life <= 0) continue;
      dirty = true;
      p.life -= dt;
      if (p.life <= 0) { al[i] = 0; pos[i * 3 + 1] = -999; continue; }
      const k = p.life / p.maxLife;
      p.vy -= p.gravity * dt;
      const dr = Math.pow(p.drag, dt * 60);
      p.vx *= dr; p.vy *= dr; p.vz *= dr;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      si[i] = p.size + (p.endSize - p.size) * (1 - k);
      al[i] = p.alpha * (k < 0.25 ? k / 0.25 : 1) * (0.35 + 0.65 * Math.min(1, k * 3));
    }
    if (dirty) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.aAlpha.needsUpdate = true;
      this.geo.attributes.aSize.needsUpdate = true;
    }
  }
}

export class FX {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    const T = getTextures();
    this.T = T;
    this.sparks = new ParticleSystem(scene, T.glow, { additive: true, max: 420 });
    this.blood = new ParticleSystem(scene, T.smoke, { additive: false, max: 520 });
    this.smoke = new ParticleSystem(scene, T.smoke, { additive: false, max: 340 });
    this.toxic = new ParticleSystem(scene, T.smoke, { additive: false, max: 260 });
    this.glow = new ParticleSystem(scene, T.glow, { additive: true, max: 160 });
    this.effects = [];
    this.clouds = [];
    this.shake = null;

    // bullet-hole decals (instanced)
    this.holeCount = 96;
    const holeMat = new THREE.MeshBasicMaterial({
      map: T.bullet, transparent: true, depthWrite: false, opacity: 0.9,
      polygonOffset: true, polygonOffsetFactor: -4, side: THREE.DoubleSide,
    });
    this.holes = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), holeMat, this.holeCount);
    this.holes.frustumCulled = false;
    this.holes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.holes.renderOrder = 2;
    this.holeIndex = 0;
    this._m4 = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._q2 = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.holeCount; i++) this.holes.setMatrixAt(i, zero);
    scene.add(this.holes);

    // blood pools
    this.poolCount = 40;
    const poolMat = new THREE.MeshBasicMaterial({
      map: T.blood, transparent: true, depthWrite: false, opacity: 0.8,
      polygonOffset: true, polygonOffsetFactor: -3, side: THREE.DoubleSide,
    });
    this.pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), poolMat, this.poolCount);
    this.pools.frustumCulled = false;
    this.pools.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pools.renderOrder = 1;
    this.poolIndex = 0;
    for (let i = 0; i < this.poolCount; i++) this.pools.setMatrixAt(i, zero);
    scene.add(this.pools);

    // tracers
    this.tracerMax = 40;
    this.tracerCursor = 0;
    this.tracers = [];
    const tp = new Float32Array(this.tracerMax * 6);
    const tc = new Float32Array(this.tracerMax * 6);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(tp, 3));
    tg.setAttribute('color', new THREE.BufferAttribute(tc, 3));
    this.tracerGeo = tg;
    this.tracerPos = tp; this.tracerCol = tc;
    this.tracerMesh = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, opacity: 1, toneMapped: false,
    }));
    this.tracerMesh.frustumCulled = false;
    this.tracerMesh.renderOrder = 4;
    scene.add(this.tracerMesh);
    for (let i = 0; i < this.tracerMax; i++) this.tracers.push({ life: 0, max: 0.1, from: V(), to: V(), color: new THREE.Color() });

    // casings
    this.casings = [];
    const caseGeo = new THREE.CylinderGeometry(0.009, 0.011, 0.042, 6);
    const caseMat = new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.95, roughness: 0.3 });
    for (let i = 0; i < 22; i++) {
      const m = new THREE.Mesh(caseGeo, caseMat);
      m.visible = false;
      m.castShadow = false;
      scene.add(m);
      this.casings.push({ mesh: m, life: 0, vx: 0, vy: 0, vz: 0, spin: V() });
    }
    this.casingCursor = 0;
  }

  setShake(fn) { this.shake = fn; }

  // ------------------------------------------------------------------ helpers
  _color(c) { return c.isColor ? [c.r, c.g, c.b] : [c[0], c[1], c[2]]; }

  muzzleSmoke(pos, dir) {
    for (let i = 0; i < 2; i++) {
      this.smoke.spawn({
        x: pos.x + dir.x * 0.2, y: pos.y + dir.y * 0.2, z: pos.z + dir.z * 0.2,
        vx: dir.x * rand(0.4, 1.2) + rand(-0.15, 0.15),
        vy: dir.y * 0.4 + rand(0.1, 0.4),
        vz: dir.z * rand(0.4, 1.2) + rand(-0.15, 0.15),
        life: rand(0.5, 1.1), size: rand(0.12, 0.22), endSize: rand(0.5, 0.9),
        gravity: -0.4, drag: 0.94, color: [0.45, 0.47, 0.5], alpha: 0.16,
      });
    }
  }

  tracer(from, to, color = new THREE.Color(0xffd9a0)) {
    const i = this.tracerCursor;
    this.tracerCursor = (this.tracerCursor + 1) % this.tracerMax;
    const t = this.tracers[i];
    t.from.copy(from); t.to.copy(to);
    t.max = 0.075; t.life = 0.075;
    t.color.copy(color);
    const o = i * 6;
    this.tracerPos[o] = from.x; this.tracerPos[o + 1] = from.y; this.tracerPos[o + 2] = from.z;
    this.tracerPos[o + 3] = to.x; this.tracerPos[o + 4] = to.y; this.tracerPos[o + 5] = to.z;
    this.tracerCol[o] = color.r; this.tracerCol[o + 1] = color.g; this.tracerCol[o + 2] = color.b;
    this.tracerCol[o + 3] = color.r * 0.7; this.tracerCol[o + 4] = color.g * 0.7; this.tracerCol[o + 5] = color.b * 0.7;
    this.tracerGeo.attributes.position.needsUpdate = true;
    this.tracerGeo.attributes.color.needsUpdate = true;
  }

  bulletImpact(point, normal, kind = 'concrete') {
    // sparks
    const n = kind === 'metal' ? 12 : 6;
    for (let i = 0; i < n; i++) {
      const dir = this._v.copy(normal).add(V().set(rand(-0.7, 0.7), rand(-0.2, 0.9), rand(-0.7, 0.7))).normalize();
      this.sparks.spawn({
        x: point.x, y: point.y, z: point.z,
        vx: dir.x * rand(2, 8), vy: dir.y * rand(2, 8), vz: dir.z * rand(2, 8),
        life: rand(0.12, 0.4), size: rand(0.03, 0.09), endSize: 0.005,
        gravity: 14, drag: 0.9, color: kind === 'metal' ? [1, 0.75, 0.35] : [1, 0.55, 0.2], alpha: 1,
      });
    }
    // dust puff
    for (let i = 0; i < 3; i++) {
      this.smoke.spawn({
        x: point.x, y: point.y, z: point.z,
        vx: normal.x * rand(0.3, 1.5) + rand(-0.3, 0.3),
        vy: normal.y * rand(0.3, 1.5) + rand(0, 0.4),
        vz: normal.z * rand(0.3, 1.5) + rand(-0.3, 0.3),
        life: rand(0.35, 0.8), size: rand(0.08, 0.16), endSize: rand(0.3, 0.55),
        gravity: -0.2, drag: 0.92, color: [0.55, 0.54, 0.5], alpha: 0.2,
      });
    }
    // decal
    const i = this.holeIndex;
    this.holeIndex = (this.holeIndex + 1) % this.holeCount;
    this._q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    this._q2.setFromAxisAngle(normal, rand(0, Math.PI * 2));
    this._q.premultiply(this._q2);
    const s = rand(0.09, 0.17);
    this._m4.compose(
      new THREE.Vector3(point.x + normal.x * 0.012, point.y + normal.y * 0.012, point.z + normal.z * 0.012),
      this._q, this._s.set(s, s, s)
    );
    this.holes.setMatrixAt(i, this._m4);
    this.holes.instanceMatrix.needsUpdate = true;
  }

  bloodBurst(point, dir, amount = 12, headshot = false) {
    for (let i = 0; i < amount; i++) {
      const d = V().copy(dir).add(V().set(rand(-0.9, 0.9), rand(-0.3, 1), rand(-0.9, 0.9))).normalize();
      this.blood.spawn({
        x: point.x, y: point.y, z: point.z,
        vx: d.x * rand(1.5, headshot ? 7 : 4.5),
        vy: d.y * rand(1, 4) + rand(0.5, 2),
        vz: d.z * rand(1.5, headshot ? 7 : 4.5),
        life: rand(0.4, 1.0), size: rand(0.05, 0.13), endSize: rand(0.02, 0.06),
        gravity: 16, drag: 0.97,
        color: [rand(0.28, 0.45), 0.015, 0.02], alpha: 0.9,
      });
    }
    for (let i = 0; i < 3; i++) {
      this.smoke.spawn({
        x: point.x, y: point.y, z: point.z,
        vx: dir.x * 0.8 + rand(-0.5, 0.5), vy: rand(0.2, 1), vz: dir.z * 0.8 + rand(-0.5, 0.5),
        life: rand(0.3, 0.6), size: 0.12, endSize: 0.45,
        gravity: 1, drag: 0.9, color: [0.22, 0.01, 0.01], alpha: 0.35,
      });
    }
  }

  bloodPool(x, z, scale = 1.6) {
    const i = this.poolIndex;
    this.poolIndex = (this.poolIndex + 1) % this.poolCount;
    this._q.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, rand(0, Math.PI * 2)));
    this._m4.compose(new THREE.Vector3(x, 0.015, z), this._q, this._s.set(scale, scale, scale));
    this.pools.setMatrixAt(i, this._m4);
    this.pools.instanceMatrix.needsUpdate = true;
  }

  explosion(pos, { big = false, toxic = false } = {}) {
    const flashMat = new THREE.MeshBasicMaterial({
      color: toxic ? 0x7dff6a : 0xffc27a, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    const flash = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 16), flashMat);
    flash.position.copy(pos);
    flash.scale.setScalar(0.6);
    this.scene.add(flash);
    const light = new THREE.PointLight(toxic ? 0x66ff55 : 0xffa040, big ? 120 : 70, big ? 30 : 20, 2);
    light.position.copy(pos);
    light.position.y += 0.5;
    this.scene.add(light);

    const ringMat = new THREE.MeshBasicMaterial({
      color: toxic ? 0x88ff66 : 0xffb060, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.95, 40), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(pos.x, 0.06, pos.z);
    this.scene.add(ring);

    const sparks = big ? 60 : 34;
    for (let i = 0; i < sparks; i++) {
      const a = rand(0, Math.PI * 2), e = rand(0.1, 1.2);
      const sp = rand(4, big ? 22 : 14);
      this.sparks.spawn({
        x: pos.x, y: pos.y, z: pos.z,
        vx: Math.cos(a) * sp * Math.cos(e), vy: Math.sin(e) * sp, vz: Math.sin(a) * sp * Math.cos(e),
        life: rand(0.2, 0.9), size: rand(0.05, 0.15), endSize: 0.01,
        gravity: 15, drag: 0.93, color: toxic ? [0.5, 1, 0.4] : [1, rand(0.4, 0.8), 0.2], alpha: 1,
      });
    }
    const smokeN = big ? 40 : 22;
    for (let i = 0; i < smokeN; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(0.5, big ? 6 : 3.5);
      this.smoke.spawn({
        x: pos.x + rand(-0.5, 0.5), y: pos.y + rand(0, 1), z: pos.z + rand(-0.5, 0.5),
        vx: Math.cos(a) * sp, vy: rand(0.5, 3), vz: Math.sin(a) * sp,
        life: rand(1.0, 2.6), size: rand(0.6, 1.2), endSize: rand(2.4, 4.5),
        gravity: -1.0, drag: 0.93,
        color: toxic ? [0.25, 0.45, 0.18] : [0.16, 0.15, 0.14], alpha: 0.3,
      });
    }
    // debris chunks
    for (let i = 0; i < (big ? 16 : 8); i++) {
      const a = rand(0, Math.PI * 2), sp = rand(2, big ? 12 : 7);
      this.glow.spawn({
        x: pos.x, y: pos.y + 0.4, z: pos.z,
        vx: Math.cos(a) * sp, vy: rand(2, 8), vz: Math.sin(a) * sp,
        life: rand(0.6, 1.4), size: rand(0.1, 0.22), endSize: 0.02,
        gravity: 18, drag: 0.98, color: [1, 0.55, 0.18], alpha: 1,
      });
    }
    this.effects.push({ type: 'flash', mesh: flash, light, ring, life: big ? 0.5 : 0.36, max: big ? 0.5 : 0.36, big });
    if (this.shake) this.shake(big ? 1.0 : 0.55, pos);
  }

  addToxicCloud(pos, radius = 5.2, duration = 9) {
    const cloud = { pos: pos.clone(), radius, life: duration, max: duration, emit: 0, smokeTimer: 0 };
    this.clouds.push(cloud);
    return cloud;
  }

  ejectCasing(pos, right, up, forward) {
    const c = this.casings[this.casingCursor];
    this.casingCursor = (this.casingCursor + 1) % this.casings.length;
    c.life = rand(2.5, 4.0);
    c.mesh.visible = true;
    c.mesh.position.copy(pos);
    c.mesh.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
    c.vx = right.x * rand(1.2, 2.6) + up.x * rand(0.6, 1.6) + forward.x * rand(-0.3, 0.3);
    c.vy = right.y * 1.2 + up.y * rand(1.4, 2.8) + rand(0.2, 1.2);
    c.vz = right.z * rand(1.2, 2.6) + up.z * rand(0.6, 1.6) + forward.z * rand(-0.3, 0.3);
    c.spin.set(rand(-18, 18), rand(-18, 18), rand(-18, 18));
  }

  update(dt, playerPos) {
    this.sparks.update(dt);
    this.blood.update(dt);
    this.smoke.update(dt);
    this.toxic.update(dt);
    this.glow.update(dt);

    // tracers fade
    for (let i = 0; i < this.tracerMax; i++) {
      const t = this.tracers[i];
      if (t.life <= 0) continue;
      t.life -= dt;
      const k = Math.max(0, t.life / t.max);
      const o = i * 6;
      this.tracerCol[o] = t.color.r * k; this.tracerCol[o + 1] = t.color.g * k; this.tracerCol[o + 2] = t.color.b * k;
      this.tracerCol[o + 3] = t.color.r * k * 0.5; this.tracerCol[o + 4] = t.color.g * k * 0.5; this.tracerCol[o + 5] = t.color.b * k * 0.5;
      if (t.life <= 0) {
        this.tracerPos[o] = 0; this.tracerPos[o + 1] = -999; this.tracerPos[o + 2] = 0;
        this.tracerPos[o + 3] = 0; this.tracerPos[o + 4] = -999; this.tracerPos[o + 5] = 0;
      }
    }
    this.tracerGeo.attributes.position.needsUpdate = true;
    this.tracerGeo.attributes.color.needsUpdate = true;

    // casings
    for (const c of this.casings) {
      if (c.life <= 0) continue;
      c.life -= dt;
      if (c.life <= 0) { c.mesh.visible = false; continue; }
      c.vy -= 22 * dt;
      c.mesh.position.x += c.vx * dt;
      c.mesh.position.y += c.vy * dt;
      c.mesh.position.z += c.vz * dt;
      if (c.mesh.position.y < 0.02) {
        c.mesh.position.y = 0.02;
        c.vy *= -0.35; c.vx *= 0.6; c.vz *= 0.6;
      }
      c.mesh.rotation.x += c.spin.x * dt;
      c.mesh.rotation.y += c.spin.y * dt;
      c.mesh.rotation.z += c.spin.z * dt;
    }

    // explosion effects
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.life -= dt;
      const k = Math.max(0, e.life / e.max);
      if (e.type === 'flash') {
        const grow = 1 - k;
        e.mesh.scale.setScalar((e.big ? 3.4 : 2.2) * (0.5 + grow * 1.2));
        e.mesh.material.opacity = k * k;
        e.ring.scale.setScalar(1 + grow * (e.big ? 9 : 6));
        e.ring.material.opacity = k * 0.7;
        e.light.intensity = (e.big ? 120 : 70) * k * k;
        if (e.life <= 0) {
          this.scene.remove(e.mesh); e.mesh.geometry.dispose(); e.mesh.material.dispose();
          this.scene.remove(e.ring); e.ring.geometry.dispose(); e.ring.material.dispose();
          this.scene.remove(e.light);
          this.effects.splice(i, 1);
        }
      }
    }

    // toxic clouds
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const c = this.clouds[i];
      c.life -= dt;
      c.smokeTimer -= dt;
      if (c.smokeTimer <= 0) {
        c.smokeTimer = 0.055;
        const a = rand(0, Math.PI * 2), r = Math.sqrt(Math.random()) * c.radius;
        this.toxic.spawn({
          x: c.pos.x + Math.cos(a) * r, y: rand(0.15, 1.4), z: c.pos.z + Math.sin(a) * r,
          vx: rand(-0.25, 0.25), vy: rand(0.15, 0.5), vz: rand(-0.25, 0.25),
          life: rand(1.2, 2.6), size: rand(0.4, 0.9), endSize: rand(1.2, 2.4),
          gravity: -0.15, drag: 0.98,
          color: [rand(0.22, 0.36), rand(0.5, 0.7), 0.18], alpha: 0.22,
        });
      }
      if (c.life <= 0) this.clouds.splice(i, 1);
    }
  }

  damageAt(pos, radius) {
    for (const c of this.clouds) {
      if (c.pos.distanceTo(pos) < radius + c.radius) return true;
    }
    return false;
  }
}
