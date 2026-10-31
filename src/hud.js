const $ = (id) => document.getElementById(id);
const pad = (n, l = 2) => String(n).padStart(l, '0');

export class HUD {
  constructor() {
    this.el = {
      hud: $('hud'), menu: $('menu'), pause: $('pause'), gameover: $('gameover'),
      settings: $('settings'), howto: $('howto'), boot: $('boot'),
      hp: $('hp'), hpFill: $('hp-fill'), healthState: $('health-state'),
      stamFill: $('stam-fill'),
      ammoMag: $('ammo-mag'), ammoRes: $('ammo-res'), weaponName: $('weapon-name'),
      slot1: $('slot-1'), slot2: $('slot-2'),
      grenCount: $('gren-count'), grenPips: $('gren-pips'),
      waveNum: $('wave-num'), waveTag: $('wave-tag'), enemyCount: $('enemy-count'), enemyBar: $('enemy-bar'),
      score: $('score'), kills: $('kills'), best: $('best'),
      killfeed: $('killfeed'), crosshair: $('crosshair'), hitmarker: $('hitmarker'),
      damageArc: $('damage-arc'), damageOverlay: $('damage-overlay'), toxicOverlay: $('toxic-overlay'),
      lowhp: $('lowhp-overlay'), reloadWrap: $('reload-wrap'), reloadFill: $('reload-fill'),
      banner: $('wave-banner'), bannerKicker: $('banner-kicker'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
      toast: $('toast'), bossWrap: $('boss-wrap'), bossFill: $('boss-fill'),
      compass: $('compass'),
      menuBest: $('menu-best'), menuBestWave: $('menu-best-wave'),
      goWave: $('go-wave'), goScore: $('go-score'), goKills: $('go-kills'), goHeads: $('go-heads'),
      goAcc: $('go-acc'), goTime: $('go-time'), goSub: $('go-sub'),
      grain: $('grain'),
    };
    this.ctx = this.el.compass.getContext('2d');
    this.compassW = 440;
    this.compassH = 50;
    this._hitTimer = null;
    this._toastTimer = null;
    this._bannerTimer = null;
    this._killTimers = [];
    this._lastBoss = -1;
    this._makeGrain();
    this._grenPips = [];
    this.setGrenades(3);
    this._resizeCompass();
    window.addEventListener('resize', () => this._resizeCompass());
  }

  _makeGrain() {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 120 + Math.random() * 135;
      img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v;
      img.data[i + 3] = Math.random() * 255;
    }
    ctx.putImageData(img, 0, 0);
    this.el.grain.style.backgroundImage = `url(${c.toDataURL()})`;
  }

  _resizeCompass() {
    const rect = this.el.compass.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.compassW = Math.max(120, rect.width);
    this.compassH = Math.max(30, rect.height);
    this.el.compass.width = this.compassW * dpr;
    this.el.compass.height = this.compassH * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ------------------------------------------------------------------ state
  setHealth(hp, max) {
    const v = Math.max(0, Math.round(hp));
    this.el.hp.textContent = v;
    this.el.hpFill.style.width = Math.max(0, Math.min(100, (hp / max) * 100)) + '%';
    let state = 'STABLE';
    let cls = '';
    if (hp < 30) { state = 'CRITICAL'; cls = 'hurt'; }
    else if (hp < 62) { state = 'WOUNDED'; cls = 'hurt'; }
    this.el.healthState.textContent = state;
    this.el.healthState.className = 'state ' + cls;
  }

  setStamina(v) {
    this.el.stamFill.style.width = Math.max(0, Math.min(100, v)) + '%';
    this.el.stamFill.style.opacity = v < 20 ? 0.5 : 1;
  }

  setWeapon(name, mag, reserve) {
    this.el.weaponName.textContent = name;
    this.el.ammoMag.textContent = mag;
    this.el.ammoRes.textContent = reserve;
    const low = mag <= (name.includes('BREACHER') ? 2 : 6);
    this.el.ammoMag.classList.toggle('low', low);
    const shotty = name.includes('BREACHER');
    this.el.slot1.classList.toggle('active', !shotty);
    this.el.slot2.classList.toggle('active', shotty);
  }

  setGrenades(n) {
    this.el.grenCount.textContent = n;
    this.el.grenPips.innerHTML = '';
    this._grenPips = [];
    for (let i = 0; i < 4; i++) {
      const s = document.createElement('span');
      s.className = 'pip';
      s.style.opacity = i < n ? '1' : '0.15';
      this.el.grenPips.appendChild(s);
      this._grenPips.push(s);
    }
  }

  setWave(wave, total) {
    this.el.waveNum.textContent = pad(wave);
    this.el.waveTag.textContent = 'ACTIVE';
    this._waveTotal = total;
  }

  setEnemies(remaining, total) {
    this.el.enemyCount.textContent = remaining;
    const p = total ? Math.max(0, Math.min(1, 1 - remaining / total)) : 0;
    this.el.enemyBar.style.width = (p * 100) + '%';
  }

  setScore(score, kills, best) {
    this.el.score.textContent = score.toLocaleString('en-US');
    this.el.kills.textContent = kills;
    this.el.best.textContent = best.toLocaleString('en-US');
  }

  setReloading(active, k = 0) {
    this.el.reloadWrap.classList.toggle('on', !!active);
    this.el.reloadFill.style.width = Math.max(0, Math.min(100, k * 100)) + '%';
  }

  setCrosshair(spread) {
    const gap = 5 + Math.min(26, spread * 34);
    this.el.crosshair.style.setProperty('--gap', gap.toFixed(1) + 'px');
  }

  setADS(on) {
    this.el.crosshair.classList.toggle('ads', !!on);
  }

  setLowHealth(on) {
    this.el.lowhp.classList.toggle('on', !!on);
  }

  setBoss(frac, name) {
    if (frac === null || frac === undefined) {
      this.el.bossWrap.classList.remove('on');
      this._lastBoss = -1;
      return;
    }
    this.el.bossWrap.classList.add('on');
    this.el.bossFill.style.width = Math.max(0, Math.min(1, frac)) * 100 + '%';
  }

  hitmarker(headshot, kill) {
    const el = this.el.hitmarker;
    el.classList.remove('show', 'kill');
    void el.offsetWidth;
    el.classList.add('show');
    if (kill) el.classList.add('kill');
    clearTimeout(this._hitTimer);
    this._hitTimer = setTimeout(() => el.classList.remove('show', 'kill'), 180);
  }

  pulseCrosshair() {
    const el = this.el.crosshair;
    el.classList.add('pulse');
    clearTimeout(this._pulseTimer);
    this._pulseTimer = setTimeout(() => el.classList.remove('pulse'), 70);
  }

  damageFrom(deg, toxic = false) {
    const arc = this.el.damageArc;
    arc.style.transform = `rotate(${deg}deg)`;
    arc.style.borderTopColor = toxic ? 'rgba(120,255,60,0.95)' : 'rgba(255,55,40,0.95)';
    arc.animate([{ opacity: 0.95 }, { opacity: 0 }], { duration: 950, easing: 'ease-out' });
  }

  flashDamage(intensity = 0.5, toxic = false) {
    const el = toxic ? this.el.toxicOverlay : this.el.damageOverlay;
    el.style.transition = 'none';
    el.style.opacity = String(Math.min(1, intensity));
    requestAnimationFrame(() => {
      el.style.transition = 'opacity 0.55s ease-out';
      el.style.opacity = '0';
    });
  }

  killfeed(text, points, headshot = false) {
    const div = document.createElement('div');
    div.className = 'kf' + (headshot ? ' head' : '');
    div.innerHTML = text + (points ? `<span class="pts">+${points}</span>` : '');
    this.el.killfeed.prepend(div);
    while (this.el.killfeed.children.length > 5) this.el.killfeed.lastChild.remove();
    setTimeout(() => { div.style.opacity = '0'; div.style.transition = 'opacity .4s'; setTimeout(() => div.remove(), 420); }, 3600);
  }

  banner(kicker, title, sub, duration = 2400) {
    this.el.bannerKicker.textContent = kicker;
    this.el.bannerTitle.textContent = title;
    this.el.bannerSub.textContent = sub;
    this.el.banner.classList.add('on');
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => this.el.banner.classList.remove('on'), duration);
  }

  toast(text, duration = 1800) {
    this.el.toast.textContent = text;
    this.el.toast.classList.add('on');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.el.toast.classList.remove('on'), duration);
  }

  // ---------------------------------------------------------------- compass
  updateCompass(yaw, zombies, playerPos, pickups) {
    const ctx = this.ctx;
    const W = this.compassW, H = this.compassH;
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2;
    const fov = 80 * Math.PI / 180;

    // backdrop
    ctx.save();
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, 'rgba(4,7,9,0)');
    grad.addColorStop(0.14, 'rgba(4,7,9,0.52)');
    grad.addColorStop(0.86, 'rgba(4,7,9,0.52)');
    grad.addColorStop(1, 'rgba(4,7,9,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 8, W, H - 12);

    const forward = yaw + Math.PI;
    const rel = (worldBearing) => {
      let a = forward - worldBearing;
      while (a > Math.PI) a -= Math.PI * 2;
      while (a < -Math.PI) a += Math.PI * 2;
      return a;
    };
    const xFor = (a) => cx + (a / fov) * (W / 2);

    // degree ticks
    for (let deg = 0; deg < 360; deg += 10) {
      const a = rel(deg * Math.PI / 180);
      if (Math.abs(a) > fov * 1.02) continue;
      const x = xFor(a);
      const major = deg % 30 === 0;
      ctx.strokeStyle = major ? 'rgba(230,235,230,0.5)' : 'rgba(230,235,230,0.18)';
      ctx.lineWidth = major ? 1.4 : 1;
      ctx.beginPath();
      ctx.moveTo(x, H - 10);
      ctx.lineTo(x, H - 10 - (major ? 6 : 3));
      ctx.stroke();
      if (deg % 90 === 0) {
        const labels = { 0: 'S', 90: 'E', 180: 'N', 270: 'W' };
        ctx.fillStyle = 'rgba(240,240,232,0.82)';
        ctx.font = '700 10px Rajdhani, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(labels[deg], x, 17);
      }
    }

    // threat pips
    if (zombies) {
      for (const z of zombies) {
        if (z.dead) continue;
        const dx = z.pos.x - playerPos.x, dz = z.pos.z - playerPos.z;
        const d = Math.hypot(dx, dz);
        if (d > 55) continue;
        const a = rel(Math.atan2(dx, dz));
        if (Math.abs(a) > fov) continue;
        const x = xFor(a);
        const y = H - 18;
        let col = 'rgba(255,70,55,0.95)';
        let size = 3;
        if (z.type === 'runner') { col = 'rgba(255,150,50,0.95)'; size = 3.4; }
        if (z.type === 'climber') { col = 'rgba(255,75,216,0.98)'; size = 4.6; }
        if (z.type === 'boomer') { col = 'rgba(125,255,77,0.95)'; size = 5.6; }
        if (z.type === 'boss') { col = 'rgba(255,40,20,1)'; size = 7.5; }
        const pulse = z.type === 'climber' ? 0.65 + Math.sin(performance.now() * 0.008) * 0.35 : 1;
        ctx.globalAlpha = pulse;
        ctx.fillStyle = col;
        ctx.beginPath();
        if (z.type === 'climber') {
          ctx.moveTo(x, y - size * 1.6);
          ctx.lineTo(x + size, y + size * 0.8);
          ctx.lineTo(x, y + size * 0.2);
          ctx.lineTo(x - size, y + size * 0.8);
        } else {
          ctx.moveTo(x, y - size);
          ctx.lineTo(x + size, y + size);
          ctx.lineTo(x - size, y + size);
        }
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // pickups
    if (pickups) {
      for (const p of pickups) {
        const dx = p.pos.x - playerPos.x, dz = p.pos.z - playerPos.z;
        if (Math.hypot(dx, dz) > 55) continue;
        const a = rel(Math.atan2(dx, dz));
        if (Math.abs(a) > fov) continue;
        ctx.fillStyle = p.kind === 'health' ? 'rgba(90,255,180,0.9)' : 'rgba(255,200,90,0.9)';
        ctx.fillRect(xFor(a) - 1.5, H - 15, 3, 5);
      }
    }

    // center marker
    ctx.fillStyle = 'rgba(255,181,74,0.95)';
    ctx.beginPath();
    ctx.moveTo(cx, H - 2);
    ctx.lineTo(cx - 4, H - 8);
    ctx.lineTo(cx + 4, H - 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ----------------------------------------------------------------- menus
  showHUD(on) { this.el.hud.classList.toggle('on', !!on); }
  showMenu(on) { this.el.menu.classList.toggle('hidden', !on); }
  bootDone() { this.el.boot.classList.add('hide'); }
  pause(on) { this.el.pause.classList.toggle('on', !!on); }
  settings(on) { this.el.settings.classList.toggle('on', !!on); }
  howto(on) { this.el.howto.classList.toggle('on', !!on); }

  gameOver({ wave, score, kills, heads, accuracy, time, best, record }) {
    this.el.goWave.textContent = pad(wave);
    this.el.goScore.textContent = score.toLocaleString('en-US');
    this.el.goKills.textContent = kills;
    this.el.goHeads.textContent = heads;
    this.el.goAcc.textContent = Math.round(accuracy * 100) + '%';
    const m = Math.floor(time / 60), s = Math.floor(time % 60);
    this.el.goTime.textContent = `${pad(m)}:${pad(s)}`;
    this.el.goSub.textContent = record ? 'NEW RECORD — THE NIGHT REMEMBERS' : 'The city claims another';
    this.el.gameover.classList.add('on');
  }

  hideGameOver() { this.el.gameover.classList.remove('on'); }

  setBest(score, wave) {
    this.el.menuBest.textContent = pad(score, 6);
    this.el.menuBestWave.textContent = pad(wave);
    this.el.best.textContent = score.toLocaleString('en-US');
  }

  reset() {
    this.setHealth(100, 100);
    this.setStamina(100);
    this.setGrenades(3);
    this.setReloading(false, 0);
    this.setBoss(null);
    this.setLowHealth(false);
    this.setADS(false);
    this.el.killfeed.innerHTML = '';
    this.el.hitmarker.classList.remove('show', 'kill');
    this.el.banner.classList.remove('on');
    this.el.toast.classList.remove('on');
    this.el.damageOverlay.style.opacity = '0';
    this.el.toxicOverlay.style.opacity = '0';
  }
}
