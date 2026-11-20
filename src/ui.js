const $ = (id) => document.getElementById(id);

/** Menu, affichage minimal en vol, messages furtifs et écran de pause. */
export class UI {
  constructor(starts, labels) {
    this.handlers = {};
    this.toastT = 0; this.hintT = 0;
    this.hudCache = ['', '', '', '', ''];

    const box = $('starts');
    this.chips = starts.map((s, i) => {
      const b = document.createElement('button');
      b.className = 'chip';
      b.textContent = s.name;
      b.addEventListener('click', () => this.emit('start-select', i));
      box.appendChild(b);
      return b;
    });
    $('prev').addEventListener('click', () => this.emit('plane', -1));
    $('next').addEventListener('click', () => this.emit('plane', 1));
    $('go').addEventListener('click', () => this.emit('go'));
    $('invert').addEventListener('click', () => this.emit('invert'));
    $('resume').addEventListener('click', () => this.emit('resume'));
    $('tomenu').addEventListener('click', () => this.emit('menu'));
    // un clic ne doit pas laisser le focus sur un bouton (Espace/Entrée le réactiveraient)
    document.addEventListener('click', (e) => { if (e.target.closest('button')) e.target.closest('button').blur(); });

    const L = labels, k = (...t) => t.map((x) => `<kbd>${x}</kbd>`).join(' ');
    this.keysHtml = [
      [`${k(L.KeyW, L.KeyS)} ou ${k('↑', '↓')}`, `Piquer / cabrer (${L.KeyS} tire le manche)`],
      [`${k(L.KeyA, L.KeyD)} ou ${k('←', '→')}`, 'Incliner à gauche / à droite'],
      [k(L.KeyQ, L.KeyE), 'Palonnier (et direction au sol)'],
      [k(L.KeyR, L.KeyF), 'Plus / moins de gaz'],
      [k('Espace'), 'Freins au sol, aérofreins en vol'],
      [k('G'), 'Rentrer / sortir le train'],
      [k('V'), 'Volets (3 crans) : on vole plus lentement, idéal pour se poser'],
      [k('X'), 'Armes : missile (jet, vise ~1 s pour verrouiller) · mitrailleuses (chasseur, maintenir)'],
      [k('C'), 'Changer de vue (glisser la souris pour regarder autour)'],
      [k('T'), 'Heure du jour'],
      [k('Retour arrière'), 'Réapparaître en vol'],
      [k('H', 'M'), "Masquer l'interface / couper le son"],
    ];
    this.keysHtml.push(['🎮 Manette', 'Stick gauche : piloter · RT / LT : gaz · LB / RB : palonnier · stick droit : regarder']);
    this.keysHtml.push(['', 'A : freins · B : volets · X : train · Y : vue · Start : pause · Select : réapparaître']);
    this.keysHtml.push(['', 'Clic stick droit (R3) ou croix bas : missile / mitrailleuse (maintenir)']);
    $('keys').innerHTML = this.keysHtml.map(([a, b]) => `<span>${a}</span><span>${b}</span>`).join('');
    this.flightHint = `${k(L.KeyR)} mettre les gaz · ${k(L.KeyS)} cabrer pour décoller · ${k(L.KeyA, L.KeyD)} incliner · ${k('C')} vue · ${k('Échap')} toutes les commandes`;
  }

  on(name, fn) { this.handlers[name] = fn; }
  emit(name, arg) { if (this.handlers[name]) this.handlers[name](arg); }

  loaded() { $('loading').classList.add('done'); }

  showPlane(spec) {
    $('pname').textContent = spec.name;
    $('pdesc').textContent = spec.desc;
    $('s-vit').style.width = `${spec.stats[0] * 100}%`;
    $('s-agi').style.width = `${spec.stats[1] * 100}%`;
    $('s-fac').style.width = `${spec.stats[2] * 100}%`;
  }
  showStart(i) { this.chips.forEach((c, n) => c.classList.toggle('on', n === i)); }
  setInvert(v) { $('invert').textContent = `Tangage : ${v ? 'inversé' : 'normal'}`; }

  menu(show) { $('menu').classList.toggle('off', !show); }
  pause(show) { $('pause').hidden = !show; }
  hud(show) { $('hud').hidden = !show; $('compass').hidden = !show; if (!show) this.approach(null); }

  /** Bandeau de cap en haut de l'écran (heading en radians, 0 = nord). */
  compass(heading) {
    const c = $('compass'), g = c.getContext('2d'), W = c.width, H = c.height;
    const deg = ((heading * 180) / Math.PI + 360) % 360;
    if (this.lastHdg !== undefined && Math.abs(this.lastHdg - deg) < 0.15) return;
    this.lastHdg = deg;
    g.clearRect(0, 0, W, H);
    const px = 6; // pixels par degré
    g.save();
    g.shadowColor = 'rgba(0,20,40,.6)'; g.shadowBlur = 4;
    g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    for (let d = Math.floor(deg - 60); d <= deg + 60; d++) {
      if (d % 5) continue;
      const x = W / 2 + (d - deg) * px, dd = ((d % 360) + 360) % 360;
      const fade = 1 - Math.abs(x - W / 2) / (W / 2);
      g.globalAlpha = Math.max(0, fade) * 0.95;
      const big = dd % 30 === 0;
      g.lineWidth = big ? 3 : 1.6;
      g.beginPath(); g.moveTo(x, H - 4); g.lineTo(x, H - (big ? 22 : dd % 10 === 0 ? 15 : 9)); g.stroke();
      if (big) {
        const t = { 0: 'N', 90: 'E', 180: 'S', 270: 'O' }[dd] || String(dd).padStart(3, '0');
        g.font = t.length === 1 ? '800 26px sans-serif' : '600 20px sans-serif';
        g.fillStyle = t === 'N' ? '#ffd34d' : '#fff';
        g.fillText(t, x, H - 28);
      }
    }
    g.globalAlpha = 1; g.fillStyle = '#ffd34d';
    g.beginPath(); g.moveTo(W / 2, H - 2); g.lineTo(W / 2 - 9, H + 10); g.lineTo(W / 2 + 9, H + 10); g.fill();
    g.fillRect(W / 2 - 2, H - 30, 4, 28);
    g.restore();
  }

  /** Aide à l'approche (feux PAPI) ; a = null pour la masquer. */
  approach(a) {
    const box = $('papi');
    if (!a) { if (!box.hidden) box.hidden = true; return; }
    box.hidden = false;
    box.querySelectorAll('i').forEach((el, k) => el.classList.toggle('w', k < a.white));
    const off = Math.abs(a.dev) > 25 + a.dist * 0.03;
    $('papi-l').textContent = off && a.dev > 0 ? '◀' : '';
    $('papi-r').textContent = off && a.dev < 0 ? '▶' : '';
    const km = a.dist >= 1000 ? `${(a.dist / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(a.dist / 10) * 10} m`;
    const tip = a.white >= 4 ? 'TROP HAUT' : a.white <= 0 ? 'TROP BAS' : a.white === 2 ? 'BON PLAN' : a.white > 2 ? 'UN PEU HAUT' : 'UN PEU BAS';
    $('papi-t').textContent = `${a.name} ${km} · ${tip}`;
  }

  gamepad(on) { $('pad').hidden = !on; }

  /** Réticule des mitrailleuses (x, y en pixels) ; null pour le cacher. */
  sight(x, y) {
    const el = $('sight');
    if (x === null) { if (!el.hidden) el.hidden = true; return; }
    el.hidden = false;
    el.style.transform = `translate(${x}px, ${y}px)`;
  }

  /** Cadre de visée autour de la cible (x, y en pixels) ; null pour le cacher. */
  lock(x, y, dist, progress = 1) {
    const el = $('lock');
    if (x === null) { if (!el.hidden) el.hidden = true; return; }
    el.hidden = false;
    const locked = progress >= 1;
    // le cadre se resserre pendant l'acquisition, puis devient jaune une fois verrouillé
    el.style.transform = `translate(${x}px, ${y}px) scale(${locked ? 1 : 1.9 - 0.9 * progress})`;
    el.classList.toggle('locking', !locked);
    $('lock-s').textContent = locked ? 'VERROUILLÉ' : 'VISÉE…';
    $('lock-t').textContent = `${(dist / 1000).toFixed(1).replace('.', ',')} km`;
  }
  toggleHud() { return document.body.classList.toggle('off-ui'); }

  setHud(spd, alt, thr, flags, vs = '') {
    const v = [spd, alt, thr, flags, vs], ids = ['h-spd', 'h-alt', 'h-thr', 'h-flags', 'h-vs'];
    for (let i = 0; i < 5; i++) {
      if (v[i] !== this.hudCache[i]) { this.hudCache[i] = v[i]; $(ids[i]).textContent = v[i]; }
    }
  }

  toast(text, ms = 2000) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('on');
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => t.classList.remove('on'), ms);
  }

  hint(html, ms = 9000) {
    const h = $('hint');
    h.innerHTML = html;
    h.classList.add('on');
    clearTimeout(this.hintT);
    this.hintT = setTimeout(() => h.classList.remove('on'), ms);
  }
  clearHint() { clearTimeout(this.hintT); $('hint').classList.remove('on'); }
}
