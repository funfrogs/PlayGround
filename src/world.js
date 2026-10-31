import * as THREE from 'three';
import { getTextures, makeBillboard, makeNeonSign, makeStencil } from './textures.js';

const UP = new THREE.Vector3(0, 1, 0);
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

export class World {
  constructor(scene, renderer, audio) {
    this.scene = scene;
    this.renderer = renderer;
    this.audio = audio;
    this.colliders = [];
    this.climbables = [];
    this.neonMats = [];
    this.fires = [];
    this.steams = [];
    this.lightning = { t: 0, next: rand(16, 30), flash: 0, light: null };
    this.skyBase = { mid: new THREE.Color(0x0c1a28), horizon: new THREE.Color(0x24323d) };
    this.time = 0;
    this.dust = null;
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();

    const T = getTextures();
    this.T = T;

    this._setupEnvironment();
    this._setupSky();
    this._buildGround();
    this._buildWalls();
    this._buildBuildings();
    this._buildProps();
    this._buildLights();
    this._buildRain();
    this._buildDust();
    this.sky.userData.noBullet = true;
    this.raycastTargets = [];
    scene.traverse((o) => {
      if (!o.isMesh || o.userData.noBullet) return;
      if (o.material && o.material.transparent) return;
      this.raycastTargets.push(o);
    });
  }

  // ---------------------------------------------------------------- environment
  _setupEnvironment() {
    const { scene, renderer, T } = this;
    scene.fog = new THREE.FogExp2(0x0a1118, 0.021);

    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const envRT = pmrem.fromEquirectangular(T.env);
    this.envRT = envRT;
    scene.environment = envRT.texture;
    scene.environmentIntensity = 0.55;
    pmrem.dispose();

    scene.background = new THREE.Color(0x05080c);
  }

  _setupSky() {
    const { scene, T } = this;
    const skyGeo = new THREE.SphereGeometry(380, 32, 24);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x03050a) },
        mid: { value: new THREE.Color(0x0c1a28) },
        horizon: { value: new THREE.Color(0x24323d) },
        glow: { value: new THREE.Color(0x3a1a1a) },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vDir;
        uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 glow;
        void main() {
          float h = clamp(vDir.y, 0.0, 1.0);
          vec3 col = mix(horizon, mid, smoothstep(0.0, 0.22, h));
          col = mix(col, top, smoothstep(0.16, 0.75, h));
          // faint city fire glow on the horizon
          float ang = atan(vDir.z, vDir.x);
          float fire = smoothstep(0.35, 1.0, cos(ang - 2.2)) * (1.0 - smoothstep(0.0, 0.16, h));
          col += glow * fire * 0.55;
          // subtle banding-free dither
          float d = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233))) * 43758.5453);
          col += (d - 0.5) * 0.006;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(skyGeo, skyMat);
    scene.add(this.sky);

    // stars
    const starCount = 900;
    const pos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const el = Math.asin(Math.random() * 0.95 + 0.05);
      const r = 340;
      pos[i * 3] = Math.cos(a) * Math.cos(el) * r;
      pos[i * 3 + 1] = Math.sin(el) * r;
      pos[i * 3 + 2] = Math.sin(a) * Math.cos(el) * r;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({
      color: 0xbfd6ff, size: 1.5, map: T.star, transparent: true, opacity: 0.75,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false, sizeAttenuation: true,
    }));
    scene.add(this.stars);

    // moon
    const moon = new THREE.Sprite(new THREE.SpriteMaterial({
      map: T.glow, color: 0xdbe9ff, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    moon.position.set(-110, 150, -250);
    moon.scale.setScalar(42);
    scene.add(moon);
    const disc = new THREE.Sprite(new THREE.SpriteMaterial({
      map: T.glow, color: 0xffffff, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    disc.position.copy(moon.position);
    disc.scale.setScalar(11);
    scene.add(disc);
    this.moon = moon;
  }

  // -------------------------------------------------------------------- ground
  _buildGround() {
    const { scene, T } = this;
    const mat = new THREE.MeshStandardMaterial({
      map: T.asphalt.map,
      bumpMap: T.asphalt.bump,
      bumpScale: 0.04,
      roughnessMap: T.asphalt.rough,
      roughness: 1,
      metalness: 0.22,
      envMapIntensity: 1.15,
      color: 0x9aa0a8,
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(64, 64, 1, 1), mat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    this.ground = ground;

    // wet puddles (planar fake reflections using env map)
    const puddleMat = new THREE.MeshStandardMaterial({
      color: 0x06090d,
      roughness: 0.035,
      metalness: 0.95,
      envMapIntensity: 2.2,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const puddleSpots = [
      [-6, 8, 3.4, 2.1, 0.4], [8, -4, 2.8, 3.6, 1.1], [-13, -9, 2.2, 1.6, 2.2],
      [12, 12, 3.8, 2.2, 0.2], [2, 17, 2.4, 1.4, 1.7], [-17, 13, 2.9, 1.8, 2.8],
      [15, -15, 2.1, 2.6, 0.9], [-2, -13, 3.2, 1.5, 0.1],
    ];
    for (const [x, z, rx, rz, rot] of puddleSpots) {
      const shape = new THREE.Shape();
      const n = 14;
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2;
        const wob = 0.72 + Math.sin(a * 3 + rot) * 0.16 + Math.sin(a * 5 + rot * 2) * 0.09;
        const px = Math.cos(a) * rx * wob, pz = Math.sin(a) * rz * wob;
        if (i === 0) shape.moveTo(px, pz); else shape.lineTo(px, pz);
      }
      const geo = new THREE.ShapeGeometry(shape);
      const m = new THREE.Mesh(geo, puddleMat);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = rot;
      m.position.set(x, 0.012, z);
      m.receiveShadow = false;
      scene.add(m);
    }

    // faded road markings
    const paint = new THREE.MeshStandardMaterial({
      color: 0xb6b3a4, roughness: 0.85, metalness: 0.05,
      transparent: true, opacity: 0.28, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1,
    });
    const stripe = (x, z, w, d, rot = 0, op = 0.28) => {
      const mm = new THREE.Mesh(new THREE.PlaneGeometry(w, d), paint.clone());
      mm.material.opacity = op;
      mm.rotation.x = -Math.PI / 2; mm.rotation.z = rot;
      mm.position.set(x, 0.008, z);
      scene.add(mm);
    };
    // crosswalk at north gate
    for (let i = 0; i < 6; i++) stripe(-2.9 + i * 1.16, -20.4, 0.62, 5.2, 0, 0.22);
    for (let i = 0; i < 6; i++) stripe(-2.9 + i * 1.16, 20.4, 0.62, 5.2, 0, 0.2);
    // parking bays
    for (let i = 0; i < 5; i++) stripe(-17 + i * 3.6, 7.5, 0.12, 4.4, 0, 0.15);
    stripe(-8.6, 7.5, 18, 0.12, 0, 0.12);
    // keep clear
    const stencilTex = makeStencil('KEEP CLEAR', 'rgba(225,220,205,0.9)', 78, 640, 300);
    const stencil = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 3.5),
      new THREE.MeshBasicMaterial({ map: stencilTex, transparent: true, opacity: 0.18, depthWrite: false })
    );
    stencil.rotation.x = -Math.PI / 2;
    stencil.rotation.z = 0.08;
    stencil.position.set(1, 0.01, 2.5);
    scene.add(stencil);

    // manhole + steam
    const mh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.72, 0.72, 0.04, 24),
      new THREE.MeshStandardMaterial({ map: T.metalDark.map, color: 0x4a4d50, roughness: 0.7, metalness: 0.8 })
    );
    mh.position.set(-4.5, 0.021, 11.5);
    mh.receiveShadow = true;
    scene.add(mh);
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: T.smoke, color: 0x9fb4c4, transparent: true, opacity: 0.1,
        depthWrite: false, blending: THREE.NormalBlending,
      }));
      s.position.set(-4.5 + rand(-0.3, 0.3), 0.4 + i * 0.5, 11.5 + rand(-0.3, 0.3));
      s.scale.setScalar(1.4 + i * 0.5);
      s.userData.base = s.position.y;
      s.userData.phase = rand(0, 6.28);
      s.userData.rise = rand(0.3, 0.6);
      scene.add(s);
      this.steams.push(s);
    }
  }

  // --------------------------------------------------------------------- walls
  _buildWalls() {
    const { scene, T } = this;
    const wallMat = new THREE.MeshStandardMaterial({
      map: T.concrete.map, bumpMap: T.concrete.bump, bumpScale: 0.06,
      color: 0x8e8c82, roughness: 0.92, metalness: 0.04, envMapIntensity: 0.5,
    });
    const capMat = new THREE.MeshStandardMaterial({
      map: T.concreteDark.map, color: 0x6c6a62, roughness: 0.8, metalness: 0.12,
    });
    const H = 3.3, TH = 0.9;
    const segments = [
      // north (z=-24), gap in middle
      { x: -13.5, z: -24, w: 21, d: TH },
      { x: 13.5, z: -24, w: 21, d: TH },
      // south
      { x: -13.5, z: 24, w: 21, d: TH },
      { x: 13.5, z: 24, w: 21, d: TH },
      // east (x=24)
      { x: 24, z: -13.5, w: TH, d: 21 },
      { x: 24, z: 13.5, w: TH, d: 21 },
      // west
      { x: -24, z: -13.5, w: TH, d: 21 },
      { x: -24, z: 13.5, w: TH, d: 21 },
    ];
    for (const s of segments) {
      const geo = new THREE.BoxGeometry(s.w, H, s.d);
      // scale texture uv per segment via material map repeat on a clone
      const mat = wallMat.clone();
      mat.map = T.concrete.map.clone();
      mat.map.repeat.set(Math.max(s.w, s.d) / 4, H / 4);
      mat.map.needsUpdate = true;
      mat.bumpMap = T.concrete.bump.clone();
      mat.bumpMap.repeat.copy(mat.map.repeat);
      mat.bumpMap.needsUpdate = true;
      const m = new THREE.Mesh(geo, mat);
      m.position.set(s.x, H / 2, s.z);
      m.castShadow = true; m.receiveShadow = true;
      scene.add(m);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(s.w + 0.18, 0.16, s.d + 0.18), capMat);
      cap.position.set(s.x, H + 0.06, s.z);
      cap.castShadow = true;
      scene.add(cap);
      this._addCollider(s.x - s.w / 2, s.x + s.w / 2, s.z - s.d / 2, s.z + s.d / 2, H, true);

      // rusted spikes / razor wire silhouettes along the top
      const spikeCount = Math.floor(Math.max(s.w, s.d) / 0.7);
      const spikeGeo = new THREE.ConeGeometry(0.045, 0.34, 4);
      const spikeMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.6, metalness: 0.85 });
      const inst = new THREE.InstancedMesh(spikeGeo, spikeMat, spikeCount);
      const mtx = new THREE.Matrix4();
      for (let i = 0; i < spikeCount; i++) {
        const t = -Math.max(s.w, s.d) / 2 + 0.4 + i * 0.7;
        const px = s.w > s.d ? s.x + t : s.x;
        const pz = s.w > s.d ? s.z : s.z + t;
        mtx.makeRotationZ(rand(-0.25, 0.25));
        mtx.setPosition(px, H + 0.32, pz);
        inst.setMatrixAt(i, mtx);
      }
      scene.add(inst);
    }

    // gate frames with hazard stripes
    const gateMat = new THREE.MeshStandardMaterial({
      map: T.metalDark.map, color: 0x4b4d50, roughness: 0.55, metalness: 0.8,
    });
    const hazardMat = new THREE.MeshStandardMaterial({
      map: T.hazard.map, roughness: 0.7, metalness: 0.2, emissive: 0x2a2208, emissiveIntensity: 0.35,
    });
    const gates = [
      { x: -3.35, z: -24, ry: 0 }, { x: 3.35, z: -24, ry: 0 },
      { x: -3.35, z: 24, ry: 0 }, { x: 3.35, z: 24, ry: 0 },
      { x: -24, z: -3.35, ry: Math.PI / 2 }, { x: -24, z: 3.35, ry: Math.PI / 2 },
      { x: 24, z: -3.35, ry: Math.PI / 2 }, { x: 24, z: 3.35, ry: Math.PI / 2 },
    ];
    for (const g of gates) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.34, 4.1, 0.34), gateMat);
      post.position.set(g.x, 2.05, g.z);
      post.rotation.y = g.ry;
      post.castShadow = true;
      scene.add(post);
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.37, 0.5, 0.37), hazardMat);
      band.position.set(g.x, 3.1, g.z);
      band.rotation.y = g.ry;
      scene.add(band);
      const light = new THREE.PointLight(0xff3b2f, 4, 9, 2);
      light.position.set(g.x * 0.985, 4.15, g.z * 0.985);
      scene.add(light);
      const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xff4a3a, toneMapped: false })
      );
      bulb.position.copy(light.position);
      scene.add(bulb);
      this.neonMats.push({ mat: bulb.material, base: new THREE.Color(0xff4a3a), phase: rand(0, 9) });
    }

    // hanging chain-link gate leaves, swung open
    const chainMat = new THREE.MeshStandardMaterial({
      color: 0x3a3f42, metalness: 0.8, roughness: 0.55, transparent: true, opacity: 0.55,
      side: THREE.DoubleSide,
    });
    for (const g of gates) {
      const leaf = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.0, 6, 6), chainMat);
      leaf.position.set(g.x, 1.5, g.z);
      leaf.rotation.y = g.ry + (g.x > 0 ? 0.9 : -0.9) + (g.z > 0 ? Math.PI : 0);
      scene.add(leaf);
    }
  }

  // ----------------------------------------------------------------- buildings
  _buildBuildings() {
    const { scene, T } = this;
    const defs = [
      { x: -17, z: -33, w: 17, d: 14, h: 22, f: 0, sign: null },
      { x: 1, z: -35, w: 15, d: 15, h: 30, f: 1, sign: { text: 'HOTEL', color: '#ff2f7d', tall: true, x: 5.6, y: 13, z: -27.4, ry: 0 } },
      { x: 18, z: -33, w: 16, d: 14, h: 18, f: 2, sign: { text: '24/7', color: '#3ff0ff', x: 18, y: 8, z: -25.8, ry: 0 } },
      { x: -34, z: -12, w: 14, d: 18, h: 26, f: 1, sign: null },
      { x: -35, z: 13, w: 15, d: 16, h: 16, f: 2, sign: { text: 'MOTEL', color: '#ff7b2f', x: -27.4, y: 8.5, z: 13, ry: Math.PI / 2 } },
      { x: 34, z: -11, w: 14, d: 17, h: 24, f: 0, sign: null },
      { x: 35, z: 14, w: 16, d: 15, h: 19, f: 1, sign: { text: 'PHARMACY', color: '#4dff9e', x: 27, y: 7.2, z: 14, ry: -Math.PI / 2 } },
      { x: -18, z: 34, w: 18, d: 15, h: 21, f: 2, sign: null },
      { x: 2, z: 36, w: 17, d: 16, h: 27, f: 0, sign: null },
      { x: 20, z: 34, w: 15, d: 14, h: 17, f: 1, sign: { text: 'NO VACANCY', color: '#ffd23f', x: 20, y: 7, z: 26.8, ry: 0 } },
      { x: -47, z: -30, w: 20, d: 18, h: 34, f: 2, sign: null },
      { x: 46, z: 31, w: 20, d: 18, h: 29, f: 0, sign: null },
    ];
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x2b2e31, roughness: 0.95, metalness: 0.1 });
    for (const b of defs) {
      const f = T.facade[b.f];
      const map = f.map.clone();
      const em = f.emissive.clone();
      const rx = Math.max(1, Math.round(b.w / 12));
      const ry = Math.max(1, b.h / 27);
      map.repeat.set(rx, ry); em.repeat.set(rx, ry);
      map.offset.set(rand(0, 1), rand(0, 1)); em.offset.copy(map.offset);
      map.needsUpdate = true; em.needsUpdate = true;
      const mat = new THREE.MeshStandardMaterial({
        map, emissiveMap: em, emissive: 0xffffff, emissiveIntensity: 1.25,
        roughness: 0.86, metalness: 0.08, color: 0x9aa0a6, envMapIntensity: 0.4,
      });
      const m = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), mat);
      m.position.set(b.x, b.h / 2, b.z);
      m.castShadow = true; m.receiveShadow = true;
      scene.add(m);
      // roof slab
      const roof = new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.5, 0.5, b.d + 0.5), roofMat);
      roof.position.set(b.x, b.h + 0.25, b.z);
      roof.castShadow = true;
      scene.add(roof);
      // roof clutter
      for (let i = 0; i < 3; i++) {
        const box = new THREE.Mesh(
          new THREE.BoxGeometry(rand(1, 2.6), rand(0.7, 1.4), rand(1, 2.2)),
          new THREE.MeshStandardMaterial({ map: T.metalDark.map, color: 0x565a5e, roughness: 0.7, metalness: 0.6 })
        );
        box.position.set(b.x + rand(-b.w * 0.32, b.w * 0.32), b.h + 1.1, b.z + rand(-b.d * 0.32, b.d * 0.32));
        box.castShadow = true;
        scene.add(box);
      }
      // blinking aircraft beacon
      if (b.h > 24) {
        const bulb = new THREE.Mesh(
          new THREE.SphereGeometry(0.14, 8, 8),
          new THREE.MeshBasicMaterial({ color: 0xff2a1a, toneMapped: false })
        );
        bulb.position.set(b.x, b.h + 1.4, b.z);
        scene.add(bulb);
        this.neonMats.push({ mat: bulb.material, base: new THREE.Color(0xff2a1a), phase: rand(0, 9), beacon: true });
      }
      if (b.sign) this._addSign(b.sign);
    }

    // fire escapes on two close buildings
    this._addFireEscape(-26.6, 13, 8, 1);
    this._addFireEscape(-26.6, -12, 10, 1);

    // distant skyline silhouettes
    const skyMat = new THREE.MeshStandardMaterial({ color: 0x0a0f14, roughness: 1, metalness: 0, emissive: 0x05080c, emissiveIntensity: 1 });
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * Math.PI * 2 + rand(-0.05, 0.05);
      const r = rand(62, 125);
      const w = rand(8, 22), d = rand(8, 22), h = rand(16, 60);
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), skyMat);
      m.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
      m.rotation.y = rand(0, 3.14);
      scene.add(m);
    }

    // large billboard on south building
    const bb = new THREE.Mesh(
      new THREE.PlaneGeometry(11, 5.5),
      new THREE.MeshStandardMaterial({
        map: makeBillboard('QUARANTINE', 'ZONE — NO ENTRY'), emissive: 0xffffff, emissiveIntensity: 0.55,
        roughness: 0.8, metalness: 0.1,
      })
    );
    bb.position.set(2, 12, 27.9);
    bb.rotation.y = Math.PI;
    scene.add(bb);
    // billboard frame
    const frame = new THREE.Mesh(new THREE.BoxGeometry(11.5, 6, 0.3), roofMat);
    frame.position.set(2, 12, 28.15);
    scene.add(frame);
    const bbLight = new THREE.PointLight(0xffcf6a, 12, 18, 2);
    bbLight.position.set(2, 10, 25);
    scene.add(bbLight);
  }

  _addSign(s) {
    const { scene } = this;
    const texture = makeNeonSign(s.text, s.color, {
      tall: s.tall, border: s.color,
      font: s.tall ? 'bold 110px "Teko", sans-serif' : 'bold 118px "Rajdhani", sans-serif',
    });
    const aspect = s.tall ? 1 : 2;
    const h = s.tall ? 4.4 : 2.2;
    const w = h * aspect;
    const mat = new THREE.MeshBasicMaterial({
      map: texture, transparent: true, side: THREE.DoubleSide,
      toneMapped: false, depthWrite: false,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(s.x, s.y, s.z);
    m.rotation.y = s.ry;
    scene.add(m);
    // back plate
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.94, h * 0.9, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x101214, roughness: 0.8, metalness: 0.3 })
    );
    plate.position.set(s.x, s.y, s.z);
    plate.rotation.y = s.ry;
    plate.translateZ(-0.09);
    scene.add(plate);
    const col = new THREE.Color(s.color);
    const light = new THREE.PointLight(col, 16, 15, 2);
    light.position.set(s.x, s.y, s.z);
    light.translateOnAxis(new THREE.Vector3(Math.sin(s.ry), 0, Math.cos(s.ry)), 1.2);
    scene.add(light);
    this.neonMats.push({ mat, base: col, phase: rand(0, 9), light, baseIntensity: 16 });
  }

  _addFireEscape(x, z, h, side) {
    const { scene, T } = this;
    const mat = new THREE.MeshStandardMaterial({ color: 0x2e3236, roughness: 0.65, metalness: 0.8, map: T.metalDark.map });
    const levels = Math.max(2, Math.floor(h / 3.2));
    for (let i = 1; i <= levels; i++) {
      const y = i * 3.1;
      const plat = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.1, 1.4), mat);
      plat.position.set(x + side * 0.7, y, z);
      plat.castShadow = true;
      scene.add(plat);
      // rail
      for (const dz of [-0.65, 0.65]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.06, 0.06), mat);
        rail.position.set(x + side * 0.7, y + 0.95, z + dz);
        scene.add(rail);
      }
      for (const dx of [-1.5, 0, 1.5]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1, 0.05), mat);
        post.position.set(x + side * 0.7 + dx, y + 0.5, z + 0.65);
        scene.add(post);
      }
      // ladder
      if (i < levels) {
        const lad = new THREE.Mesh(new THREE.BoxGeometry(0.7, 3.2, 0.06), mat);
        lad.position.set(x + side * 0.7 + (i % 2 ? 1.1 : -1.1), y + 1.55, z + 0.66);
        scene.add(lad);
      }
    }
  }

  // --------------------------------------------------------------------- props
  _buildProps() {
    this._addCar(-9.5, 6.5, 0.35, 0x5a1f1f);
    this._addCar(10.5, -8.5, -0.6, 0x1d3a44);
    this._addCar(-14.5, 16.5, 1.9, 0x3d3d2a);
    this._addDumpster(19.5, 9, 0.1);
    this._addDumpster(-19.8, -8, 1.7);
    this._addBarrier(-4.5, -9.5, 0.25);
    this._addBarrier(4.2, 9.6, -0.2);
    this._addBarrier(13.5, 3.2, 1.35);
    this._addBarrier(-14.5, -2.5, 1.55);
    this._addSandbags(6.2, -18.5, 0);
    this._addSandbags(-7.2, 18.6, Math.PI);
    this._addCrates(14, 14, 2);
    this._addCrates(-16.5, -15.5, 3);
    this._addBarrelFire(-15.5, -12.5);
    this._addBarrelFire(15.5, 6.5);
    this._addBarrelFire(-6.5, 16.5);
    this._addBarrelFire(6.5, -5.5, false);
    this._addPowerPole(20.5, -17);
    this._addScaffold(-20.6, 2.5);
    this._addStreetLamp(-12, -12);
    this._addStreetLamp(13, 12);
    this._addStreetLamp(12, -16);
    this._addStreetLamp(-13, 12.5);
    this._addDebris();
  }

  _addCollider(minX, maxX, minZ, maxZ, height, climbable = false, tag = '') {
    const c = { minX, maxX, minZ, maxZ, height, climbable, tag };
    this.colliders.push(c);
    if (climbable && height <= 4.2) this.climbables.push(c);
    return c;
  }

  _addCar(x, z, rot, color) {
    const { scene, T } = this;
    const g = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({
      color, roughness: 0.42, metalness: 0.75, envMapIntensity: 1.2,
    });
    const glass = new THREE.MeshStandardMaterial({ color: 0x0a1014, roughness: 0.08, metalness: 0.9, envMapIntensity: 2 });
    const trim = new THREE.MeshStandardMaterial({ map: T.metalDark.map, color: 0x2a2c2e, roughness: 0.6, metalness: 0.8 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.72, 1.82), paint);
    body.position.y = 0.72; body.castShadow = true; body.receiveShadow = true; g.add(body);
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.22, 1.7), paint);
    hood.position.set(1.5, 1.06, 0); hood.castShadow = true; g.add(hood);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.72, 1.62), paint);
    cabin.position.set(-0.35, 1.35, 0); cabin.castShadow = true; g.add(cabin);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.08, 1.55), paint);
    roof.position.set(-0.35, 1.73, 0); g.add(roof);
    const windshield = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.58, 1.5), glass);
    windshield.position.set(0.72, 1.38, 0); windshield.rotation.z = -0.32; g.add(windshield);
    const rear = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.52, 1.48), glass);
    rear.position.set(-1.43, 1.38, 0); rear.rotation.z = 0.28; g.add(rear);
    for (const sx of [-0.85, 0.85]) {
      for (const sz of [-0.78, 0.78]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.22, 16), trim);
        wheel.rotation.x = Math.PI / 2;
        wheel.position.set(sx, 0.36, sz);
        wheel.castShadow = true;
        g.add(wheel);
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.24, 12), new THREE.MeshStandardMaterial({ color: 0x777b7e, metalness: 0.9, roughness: 0.35 }));
        hub.rotation.x = Math.PI / 2; hub.position.set(sx, 0.36, sz * 1.02); g.add(hub);
      }
    }
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffe6b0, emissive: 0xffcc77, emissiveIntensity: 1.6, roughness: 0.2 });
    for (const sz of [-0.62, 0.62]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.34), headMat);
      hl.position.set(2.16, 0.82, sz); g.add(hl);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.3), new THREE.MeshStandardMaterial({ color: 0x5a0c0c, emissive: 0xff2211, emissiveIntensity: 0.55 }));
      tl.position.set(-2.16, 0.84, sz); g.add(tl);
    }
    // grime overlay
    const grime = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 0.5), new THREE.MeshBasicMaterial({ color: 0x0a0806, transparent: true, opacity: 0.3 }));
    grime.position.set(0, 0.5, 0.92); g.add(grime);
    g.position.set(x, 0, z);
    g.rotation.y = rot;
    scene.add(g);
    const r = 2.5;
    this._addCollider(x - r, x + r, z - r * 0.7, z + r * 0.7, 1.8, false, 'car');
  }

  _addDumpster(x, z, rot) {
    const { scene, T } = this;
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ map: T.metal.map, color: 0x2f4a36, roughness: 0.62, metalness: 0.72, envMapIntensity: 0.9 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.5, 1.35, 1.55), mat);
    body.position.y = 0.78; body.castShadow = true; body.receiveShadow = true; g.add(body);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(2.58, 0.12, 1.62), mat);
    lid.position.set(0, 1.48, -0.1); lid.rotation.x = -0.12; lid.castShadow = true; g.add(lid);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.9 });
    for (const sx of [-0.9, 0.9]) for (const sz of [-0.6, 0.6]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.1, 10), wheelMat);
      w.rotation.x = Math.PI / 2; w.position.set(sx, 0.13, sz); g.add(w);
    }
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.18), new THREE.MeshBasicMaterial({ map: T.hazard.map, transparent: true, opacity: 0.55 }));
    stripe.position.set(0, 1.05, 0.79); g.add(stripe);
    g.position.set(x, 0, z); g.rotation.y = rot;
    scene.add(g);
    this._addCollider(x - 1.4, x + 1.4, z - 1.0, z + 1.0, 1.6, true, 'dumpster');
  }

  _addBarrier(x, z, rot) {
    const { scene, T } = this;
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      map: T.concrete.map, color: 0x8d8b80, roughness: 0.9, metalness: 0.05,
    });
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.42, 0.72), mat);
    base.position.y = 0.21; base.castShadow = true; base.receiveShadow = true; g.add(base);
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.72, 0.34), mat);
    top.position.y = 0.78; top.castShadow = true; top.receiveShadow = true; g.add(top);
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.22), new THREE.MeshStandardMaterial({
      map: T.hazard.map, roughness: 0.75, metalness: 0.15, emissive: 0x1a1404, emissiveIntensity: 0.4,
    }));
    stripe.position.set(0, 0.82, 0.176); g.add(stripe);
    g.position.set(x, 0, z); g.rotation.y = rot;
    scene.add(g);
    this._addCollider(x - 1.2, x + 1.2, z - 0.5, z + 0.5, 1.15, true, 'barrier');
  }

  _addSandbags(x, z, rot) {
    const { scene, T } = this;
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x6b6248, roughness: 1, metalness: 0 });
    const geo = new THREE.BoxGeometry(0.62, 0.24, 0.36);
    const inst = new THREE.InstancedMesh(geo, mat, 30);
    const mtx = new THREE.Matrix4();
    let i = 0;
    for (let row = 0; row < 3; row++) {
      for (let c = 0; c < 10; c++) {
        const xx = -2.7 + c * 0.6 + (row % 2 ? 0.3 : 0);
        mtx.makeRotationY(rand(-0.15, 0.15));
        mtx.setPosition(xx, 0.13 + row * 0.24, (rand() - 0.5) * 0.05);
        inst.setMatrixAt(i++, mtx);
      }
    }
    inst.castShadow = true; inst.receiveShadow = true;
    g.add(inst);
    g.position.set(x, 0, z); g.rotation.y = rot;
    scene.add(g);
    this._addCollider(x - 3.1, x + 3.1, z - 0.55, z + 0.55, 0.8, true, 'sandbags');
  }

  _addCrates(x, z, count) {
    const { scene, T } = this;
    const mat = new THREE.MeshStandardMaterial({ map: T.wood.map, color: 0x9b8055, roughness: 0.9, metalness: 0.02 });
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0x3c2f1d, roughness: 0.9 });
    const g = new THREE.Group();
    const spots = [[0, 0, 0], [1.05, 0, 0.1], [0.5, 1, -0.05], [0, 0, 1.05], [1.02, 0, 1.1], [0.45, 2, 0.02]];
    for (let i = 0; i < Math.min(count + 2, spots.length); i++) {
      const s = spots[i];
      const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
      box.position.set(s[0], 0.5 + s[1], s[2]);
      box.castShadow = true; box.receiveShadow = true;
      g.add(box);
      for (const yy of [0.02, 0.98]) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.05, 1.02), edgeMat);
        band.position.set(s[0], 0.5 + s[1] + yy - 0.5, s[2]);
        g.add(band);
      }
    }
    g.position.set(x, 0, z);
    g.rotation.y = rand(-0.3, 0.3);
    scene.add(g);
    this._addCollider(x - 1.7, x + 1.7, z - 1.7, z + 1.7, 3.0, true, 'crates');
  }

  _addBarrelFire(x, z, lit = true) {
    const { scene, T } = this;
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ map: T.rust.map, color: 0x8a5a3a, roughness: 0.85, metalness: 0.45 });
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.95, 16), mat);
    barrel.position.y = 0.48; barrel.castShadow = true; barrel.receiveShadow = true; g.add(barrel);
    for (const y of [0.15, 0.48, 0.81]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.365, 0.025, 6, 18), new THREE.MeshStandardMaterial({ color: 0x3a2a20, roughness: 0.8, metalness: 0.6 }));
      ring.rotation.x = Math.PI / 2; ring.position.y = y; g.add(ring);
    }
    g.position.set(x, 0, z);
    scene.add(g);
    this._addCollider(x - 0.42, x + 0.42, z - 0.42, z + 0.42, 1.0, true, 'barrel');
    if (!lit) return;

    const light = new THREE.PointLight(0xff7a28, 22, 14, 2);
    light.position.set(x, 1.6, z);
    scene.add(light);
    const sprites = [];
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: T.flame, color: i === 0 ? 0xfff0c0 : 0xff8a2a, transparent: true,
        opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      s.position.set(x + rand(-0.12, 0.12), 1.05 + i * 0.12, z + rand(-0.12, 0.12));
      s.scale.setScalar(0.6 + i * 0.18);
      scene.add(s);
      sprites.push(s);
    }
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: T.smoke, color: 0x2a2c2c, transparent: true, opacity: 0.12,
        depthWrite: false,
      }));
      s.position.set(x + rand(-0.2, 0.2), 1.7 + i * 0.7, z + rand(-0.2, 0.2));
      s.scale.setScalar(1.2 + i * 0.4);
      s.userData.baseY = s.position.y;
      s.userData.phase = rand(0, 6.28);
      scene.add(s);
      sprites.push(s);
    }
    this.fires.push({ x, z, light, sprites, phase: rand(0, 6.28) });
  }

  _addPowerPole(x, z) {
    const { scene, T } = this;
    const mat = new THREE.MeshStandardMaterial({ map: T.wood.map, color: 0x4a3b2a, roughness: 0.95 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.19, 9, 8), mat);
    pole.position.set(x, 4.5, z); pole.castShadow = true; scene.add(pole);
    for (const y of [7.4, 8.2]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 0.12), mat);
      arm.position.set(x, y, z); scene.add(arm);
      for (const dx of [-1.1, 0, 1.1]) {
        const ins = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.16, 8), new THREE.MeshStandardMaterial({ color: 0x5a6a5a, roughness: 0.4, metalness: 0.2 }));
        ins.position.set(x + dx, y + 0.14, z); scene.add(ins);
      }
    }
    // sagging wires
    const wireMat = new THREE.LineBasicMaterial({ color: 0x0a0b0c, transparent: true, opacity: 0.8 });
    const targets = [[-26, 6.8, -10], [-26, 7.2, 12], [x - 12, 6.4, z + 14]];
    for (let t = 0; t < 3; t++) {
      const p0 = new THREE.Vector3(x + (t - 1) * 1.1, 8.3, z);
      const p1 = new THREE.Vector3(targets[t][0], targets[t][1], targets[t][2]);
      const mid = p0.clone().lerp(p1, 0.5); mid.y -= 1.4;
      const curve = new THREE.QuadraticBezierCurve3(p0, mid, p1);
      const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(24));
      scene.add(new THREE.Line(geo, wireMat));
    }
    this._addCollider(x - 0.3, x + 0.3, z - 0.3, z + 0.3, 9, false, 'pole');
  }

  _addScaffold(x, z) {
    const { scene, T } = this;
    const mat = new THREE.MeshStandardMaterial({ map: T.metalDark.map, color: 0x565b5f, roughness: 0.55, metalness: 0.85 });
    const plankMat = new THREE.MeshStandardMaterial({ map: T.wood.map, color: 0x7a6244, roughness: 0.95 });
    const g = new THREE.Group();
    for (const dz of [-1.8, 1.8]) {
      for (const dx of [-1.2, 1.2]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 4.4, 8), mat);
        pole.position.set(dx, 2.2, dz); pole.castShadow = true; g.add(pole);
      }
    }
    for (const y of [1.4, 2.8, 4.2]) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.1, 3.7), plankMat);
      plank.position.set(0, y, 0); plank.castShadow = true; plank.receiveShadow = true; g.add(plank);
      for (const dz of [-1.8, 1.8]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.06, 0.06), mat);
        rail.position.set(0, y + 0.9, dz); g.add(rail);
      }
      // diagonal brace
      const brace = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.2, 0.05), mat);
      brace.position.set(-1.2, y - 0.7, 0); brace.rotation.z = 0.55; g.add(brace);
    }
    g.position.set(x, 0, z);
    scene.add(g);
    this._addCollider(x - 1.4, x + 1.4, z - 1.95, z + 1.95, 4.3, true, 'scaffold');
  }

  _addStreetLamp(x, z) {
    const { scene, T } = this;
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a3e42, roughness: 0.6, metalness: 0.8, map: T.metalDark.map });
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 6.4, 10), mat);
    pole.position.y = 3.2; pole.castShadow = true; g.add(pole);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.1, 0.12), mat);
    arm.position.set(0.8, 6.35, 0); arm.rotation.z = 0.08; g.add(arm);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.16, 0.34), mat);
    head.position.set(1.65, 6.25, 0); g.add(head);
    const bulb = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.03, 0.26),
      new THREE.MeshBasicMaterial({ color: 0xffe2b0, toneMapped: false })
    );
    bulb.position.set(1.65, 6.16, 0); g.add(bulb);
    g.position.set(x, 0, z);
    g.rotation.y = rand(0, Math.PI * 2);
    scene.add(g);
    const wx = x + Math.cos(g.rotation.y) * 1.65;
    const wz = z - Math.sin(g.rotation.y) * 1.65;
    const light = new THREE.PointLight(0xffb15c, 34, 20, 2);
    light.position.set(wx, 6.0, wz);
    scene.add(light);
    // fake volumetric cone
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(3.4, 6.1, 20, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffb15c, transparent: true, opacity: 0.028,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      })
    );
    cone.position.set(wx, 3.0, wz);
    scene.add(cone);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: T.glow, color: 0xffc070, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    halo.position.set(wx, 6.1, wz); halo.scale.setScalar(2.2);
    scene.add(halo);
    this._addCollider(x - 0.22, x + 0.22, z - 0.22, z + 0.22, 6.4, false, 'lamp');
  }

  _addDebris() {
    const { scene, T } = this;
    const rnd = mulberry32(4242);
    const mats = [
      new THREE.MeshStandardMaterial({ map: T.concreteDark.map, color: 0x6c6a62, roughness: 0.95 }),
      new THREE.MeshStandardMaterial({ map: T.metalDark.map, color: 0x3d4044, roughness: 0.6, metalness: 0.7 }),
      new THREE.MeshStandardMaterial({ map: T.wood.map, color: 0x5a4830, roughness: 0.95 }),
    ];
    for (let i = 0; i < 34; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 6 + rnd() * 16;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const s = 0.12 + rnd() * 0.42;
      const m = new THREE.Mesh(new THREE.BoxGeometry(s * (1 + rnd()), s * (0.3 + rnd()), s * (1 + rnd())), pick(mats));
      m.position.set(x, s * 0.3, z);
      m.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      m.castShadow = true; m.receiveShadow = true;
      scene.add(m);
    }
    // scattered papers
    const paperMat = new THREE.MeshStandardMaterial({ color: 0xb9b4a4, roughness: 1, side: THREE.DoubleSide });
    for (let i = 0; i < 18; i++) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.42), paperMat);
      p.rotation.x = -Math.PI / 2;
      p.rotation.z = rnd() * 6;
      p.position.set((rnd() - 0.5) * 38, 0.015, (rnd() - 0.5) * 38);
      scene.add(p);
    }
  }

  // -------------------------------------------------------------------- lights
  _buildLights() {
    const { scene } = this;
    const hemi = new THREE.HemisphereLight(0x35506b, 0x0a0b0d, 0.55);
    scene.add(hemi);
    this.hemi = hemi;

    const moon = new THREE.DirectionalLight(0x9cb8e8, 1.35);
    moon.position.set(-45, 70, -60);
    moon.target.position.set(0, 0, 0);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    moon.shadow.camera.near = 1;
    moon.shadow.camera.far = 160;
    moon.shadow.camera.left = -34;
    moon.shadow.camera.right = 34;
    moon.shadow.camera.top = 34;
    moon.shadow.camera.bottom = -34;
    moon.shadow.bias = -0.0005;
    moon.shadow.normalBias = 0.03;
    scene.add(moon);
    scene.add(moon.target);
    this.moonLight = moon;

    // warm rim from the burning city
    const rim = new THREE.DirectionalLight(0xff6a2a, 0.28);
    rim.position.set(60, 20, 40);
    scene.add(rim);

    const light = new THREE.DirectionalLight(0xcfe0ff, 0);
    light.position.set(20, 80, 20);
    scene.add(light);
    this.lightning.light = light;

    // soft fill from the arena centre
    const fill = new THREE.PointLight(0x2f5a7a, 12, 45, 2);
    fill.position.set(0, 9, 0);
    scene.add(fill);
  }

  // ---------------------------------------------------------------------- rain
  _buildRain() {
    const { scene, T } = this;
    this.rainCount = 1900;
    const positions = new Float32Array(this.rainCount * 6);
    this.rainDrops = [];
    for (let i = 0; i < this.rainCount; i++) {
      this.rainDrops.push({
        x: rand(-35, 35), y: rand(0, 28), z: rand(-35, 35),
        len: rand(0.5, 1.3), speed: rand(22, 34), drift: rand(-0.4, 0.4),
      });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      color: 0x9fc4e8, transparent: true, opacity: 0.34,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: true,
    });
    this.rain = new THREE.LineSegments(geo, mat);
    this.rain.frustumCulled = false;
    scene.add(this.rain);

    // splash rings
    this.splashes = [];
    const ringGeo = new THREE.RingGeometry(0.06, 0.09, 12);
    for (let i = 0; i < 34; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        color: 0xa8c8e8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      }));
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      scene.add(m);
      this.splashes.push({ mesh: m, life: 0, max: 0.45 });
    }
    this._splashTimer = 0;
  }

  _buildDust() {
    const { scene, T } = this;
    const n = 220;
    const pos = new Float32Array(n * 3);
    this.dustData = [];
    for (let i = 0; i < n; i++) {
      const x = rand(-22, 22), y = rand(0.4, 7), z = rand(-22, 22);
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      this.dustData.push({ x, y, z, phase: rand(0, 6.28), speed: rand(0.06, 0.22) });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xc8b890, size: 0.045, map: T.glow, transparent: true, opacity: 0.35,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    }));
    scene.add(this.dust);
  }

  // ------------------------------------------------------------------- queries
  collideCircle(x, z, r) {
    let nx = x, nz = z;
    for (const c of this.colliders) {
      const cx = Math.max(c.minX, Math.min(nx, c.maxX));
      const cz = Math.max(c.minZ, Math.min(nz, c.maxZ));
      let dx = nx - cx, dz = nz - cz;
      let d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (d2 < 1e-6) {
          // inside: push toward nearest face
          const dl = Math.abs(nx - c.minX), dr = Math.abs(c.maxX - nx);
          const dt = Math.abs(nz - c.minZ), db = Math.abs(c.maxZ - nz);
          const m = Math.min(dl, dr, dt, db);
          if (m === dl) nx = c.minX - r; else if (m === dr) nx = c.maxX + r;
          else if (m === dt) nz = c.minZ - r; else nz = c.maxZ + r;
        } else {
          const d = Math.sqrt(d2);
          nx = cx + (dx / d) * r;
          nz = cz + (dz / d) * r;
        }
      }
    }
    return { x: nx, z: nz };
  }

  // returns nearest climbable surface point for a zombie
  nearestClimb(x, z, maxDist = 1.5) {
    let best = null, bestD = maxDist;
    for (const c of this.climbables) {
      const cx = Math.max(c.minX, Math.min(x, c.maxX));
      const cz = Math.max(c.minZ, Math.min(z, c.maxZ));
      const d = Math.hypot(x - cx, z - cz);
      if (d < bestD) {
        bestD = d;
        // determine outward face
        let nx = 0, nz = 0, px = cx, pz = cz;
        if (x < c.minX) { nx = -1; px = c.minX; pz = Math.max(c.minZ, Math.min(z, c.maxZ)); }
        else if (x > c.maxX) { nx = 1; px = c.maxX; pz = Math.max(c.minZ, Math.min(z, c.maxZ)); }
        else if (z < c.minZ) { nz = -1; px = Math.max(c.minX, Math.min(x, c.maxX)); pz = c.minZ; }
        else if (z > c.maxZ) { nz = 1; px = Math.max(c.minX, Math.min(x, c.maxX)); pz = c.maxZ; }
        else {
          // inside footprint, pick closest face
          const dl = Math.abs(x - c.minX), dr = Math.abs(c.maxX - x);
          const dt = Math.abs(z - c.minZ), db = Math.abs(c.maxZ - z);
          const m = Math.min(dl, dr, dt, db);
          if (m === dl) { nx = -1; px = c.minX; } else if (m === dr) { nx = 1; px = c.maxX; }
          else if (m === dt) { nz = -1; pz = c.minZ; } else { nz = 1; pz = c.maxZ; }
        }
        best = { collider: c, x: px + nx * 0.42, z: pz + nz * 0.42, nx, nz, height: c.height, dist: d };
      }
    }
    return best;
  }

  getSpawnPoint(angle, radius = 30) {
    return new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
  }

  // -------------------------------------------------------------------- update
  update(dt, time, camera) {
    this.time = time;
    const { scene } = this;

    // rain follows camera
    const camX = camera.position.x, camZ = camera.position.z;
    const posAttr = this.rain.geometry.attributes.position;
    const arr = posAttr.array;
    for (let i = 0; i < this.rainCount; i++) {
      const d = this.rainDrops[i];
      d.y -= d.speed * dt;
      d.x += d.drift * dt;
      if (d.y < 0) {
        d.y = rand(22, 32);
        d.x = camX + rand(-32, 32);
        d.z = camZ + rand(-32, 32);
      }
      if (Math.abs(d.x - camX) > 38) d.x = camX + rand(-32, 32);
      if (Math.abs(d.z - camZ) > 38) d.z = camZ + rand(-32, 32);
      const o = i * 6;
      arr[o] = d.x; arr[o + 1] = d.y; arr[o + 2] = d.z;
      arr[o + 3] = d.x - d.drift * 0.06; arr[o + 4] = d.y + d.len; arr[o + 5] = d.z;
    }
    posAttr.needsUpdate = true;

    // splashes
    this._splashTimer -= dt;
    if (this._splashTimer <= 0) {
      this._splashTimer = 0.03;
      const s = this.splashes.find((x) => x.life <= 0);
      if (s) {
        s.life = s.max;
        s.mesh.visible = true;
        s.mesh.position.set(camX + rand(-14, 14), 0.02, camZ + rand(-14, 14));
        s.mesh.scale.setScalar(rand(0.5, 1.4));
      }
    }
    for (const s of this.splashes) {
      if (s.life > 0) {
        s.life -= dt;
        const k = Math.max(0, s.life / s.max);
        s.mesh.material.opacity = k * 0.35;
        s.mesh.scale.multiplyScalar(1 + dt * 2.6);
        if (s.life <= 0) s.mesh.visible = false;
      }
    }

    // fire flicker
    for (const f of this.fires) {
      const fl = 0.75 + Math.sin(time * 17 + f.phase) * 0.15 + Math.random() * 0.18;
      f.light.intensity = 22 * fl;
      f.sprites.forEach((s, i) => {
        if (i < 4) {
          const k = 0.85 + Math.sin(time * 12 + i * 2 + f.phase) * 0.2 + Math.random() * 0.12;
          s.scale.setScalar((0.55 + i * 0.16) * k);
          s.position.y = 1.02 + i * 0.14 + Math.sin(time * 9 + i) * 0.04;
          s.material.opacity = 0.65 + Math.random() * 0.3;
        } else {
          const t = (time * 0.35 + i * 0.25) % 1;
          s.position.y = 1.7 + t * 3.2;
          s.material.opacity = (1 - t) * 0.16;
          s.scale.setScalar(1.1 + t * 1.7);
        }
      });
    }

    // steam
    for (const s of this.steams) {
      const t = (time * s.userData.rise + s.userData.phase) % 4;
      s.position.y = 0.5 + t * 1.6;
      s.material.opacity = Math.sin((t / 4) * Math.PI) * 0.14;
      s.scale.setScalar(1.2 + t * 0.8);
    }

    // neon flicker
    for (const n of this.neonMats) {
      if (n.beacon) {
        const on = (Math.sin(time * 3 + n.phase) > 0.72) ? 1 : 0.06;
        n.mat.color.copy(n.base).multiplyScalar(on);
      } else {
        const f = 0.9 + Math.sin(time * 2.1 + n.phase) * 0.06;
        if (n.mat.color) n.mat.color.copy(n.base).multiplyScalar(f);
        if (n.light) n.light.intensity = n.baseIntensity * f;
      }
    }

    // dust drift
    if (this.dust) {
      const da = this.dust.geometry.attributes.position.array;
      for (let i = 0; i < this.dustData.length; i++) {
        const d = this.dustData[i];
        da[i * 3] = d.x + Math.sin(time * d.speed + d.phase) * 0.6;
        da[i * 3 + 1] = d.y + Math.sin(time * d.speed * 0.7 + d.phase * 2) * 0.3;
        da[i * 3 + 2] = d.z + Math.cos(time * d.speed * 0.8 + d.phase) * 0.6;
      }
      this.dust.geometry.attributes.position.needsUpdate = true;
    }

    // lightning
    const L = this.lightning;
    L.next -= dt;
    if (L.next <= 0) {
      L.next = rand(18, 40);
      L.t = 1.4;
      this.audio?.thunder?.();
    }
    if (L.t > 0) {
      L.t -= dt;
      const k = Math.max(0, L.t / 1.4);
      const flash = (Math.sin(k * 40) > 0.2 ? 1 : 0.15) * k;
      L.light.intensity = flash * 5;
      this.hemi.intensity = 0.55 + flash * 2.2;
      this.sky.material.uniforms.mid.value.copy(this.skyBase.mid).multiplyScalar(1 + flash * 2.4);
      this.sky.material.uniforms.horizon.value.copy(this.skyBase.horizon).multiplyScalar(1 + flash * 1.6);
    } else {
      L.light.intensity = 0;
      this.hemi.intensity = 0.55;
      this.sky.material.uniforms.mid.value.copy(this.skyBase.mid);
      this.sky.material.uniforms.horizon.value.copy(this.skyBase.horizon);
    }
  }
}

// The texture helpers are created lazily to keep this module focused.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
