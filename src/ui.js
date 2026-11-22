const $ = (id) => document.getElementById(id);

/** Menu, affichage minimal en vol, messages furtifs et écran de pause. */
export class UI {
  constructor(starts, labels, planes) {
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
    $('go').addEventListener('click', () => this.emit('go'));
    $('invert').addEventListener('click', () => this.emit('invert'));
    $('daytime').addEventListener('click', () => this.emit('daytime'));
    $('mutebtn').addEventListener('click', () => this.emit('mute'));
    $('fuelbtn').addEventListener('click', () => this.emit('fuel'));
    $('logbtn').addEventListener('click', () => this.emit('career'));
    $('c-close').addEventListener('click', () => this.career(null));
    $('career').addEventListener('click', (e) => { if (e.target.id === 'career') this.career(null); });
    $('mapbtn').addEventListener('click', () => this.emit('bigmap'));
    $('r-again').addEventListener('click', () => this.emit('again'));
    $('r-menu').addEventListener('click', () => this.emit('menu'));
    $('firesbtn').addEventListener('click', () => this.emit('fires'));
    this.liveryChips = [];

    // liste des appareils (vignettes ajoutées plus tard par setThumb)
    this.planes = planes; this.cat = 'all'; this.sel = 0;
    // un appareil décliné en plusieurs versions n'apparaît qu'une fois dans la liste
    this.lastVariant = {}; this.thumbs = [];
    this.items = planes.map((p, i) => {
      const b = document.createElement('button');
      b.className = 'item';
      const versions = p.family ? planes.filter((q) => q.family === p.family).length : 1;
      const sub = versions > 1 ? `${versions} versions` : this.tagsOf(p).slice(0, 2).join(' · ') || p.label || (p.heli ? 'Hélicoptère' : 'Avion');
      b.innerHTML = `<span class="ph"></span><span><b>${p.name}</b><small>${sub}</small></span>`;
      b.addEventListener('click', () => this.emit('plane-select', p.family && this.lastVariant[p.family] !== undefined ? this.lastVariant[p.family] : i));
      $('list').appendChild(b);
      return b;
    });
    this.items.forEach((b, n) => { if (this.head(n) !== n) b.hidden = true; });
    this.tabs = [...document.querySelectorAll('#tabs button')];
    this.tabs.forEach((t) => t.addEventListener('click', () => this.setCat(t.dataset.cat, true)));
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
      [k('N'), "Carte de l'île (croix ← à la manette)"],
      [k('B'), 'Sauter en parachute (croix → à la manette)'],
      [k('T'), 'Heure du jour'],
      [k('Retour arrière'), 'Réapparaître en vol'],
      [k('H', 'M'), "Masquer l'interface / couper le son"],
    ];
    this.keysHtml.push(['🎮 Manette', 'Stick gauche : piloter · RT / LT : gaz · LB / RB : palonnier · stick droit : regarder']);
    this.keysHtml.push(['', 'A : freins · B : volets · X : train · Y : vue · Start : pause · Select : réapparaître']);
    this.keysHtml.push(['', 'Clic stick droit (R3) ou croix bas : missile / mitrailleuse (maintenir)']);
    this.L = L; this.k = k;
    $('keys').innerHTML = this.keysHtml.map(([a, b]) => `<span>${a}</span><span>${b}</span>`).join('');
    this.gliderHint = `Pas de moteur : cherche les thermiques sous les gros nuages ronds et tourne dedans · le vario bipe quand ça monte · ${k('Espace')} aérofreins`;
    this.footHint = `Maintiens ${k(L.KeyR)} pour courir jusqu'au bout de la rampe, puis relâche · ${k(L.KeyA, L.KeyD)} virer · ${k('Espace')} freiner pour se poser · le vario bipe quand ça monte`;
    this.balloonHint = `${k(L.KeyR)} brûleur : monter · ${k(L.KeyF)} soupape : descendre · le vent change avec l'altitude : choisis ta hauteur pour choisir ta route`;
    this.hoverHint = `${k(L.KeyR)} gaz au-dessus de 50 % pour monter · ${k(L.KeyW, L.KeyS)} avancer / reculer · de la vitesse puis ${k('V')} : tuyères vers l'arrière · ${k('V')} encore pour se poser`;
    this.heliHint = `${k(L.KeyR)} gaz au-dessus de 50 % pour décoller · ${k(L.KeyW, L.KeyS)} avancer / reculer · ${k(L.KeyA, L.KeyD)} tourner · ${k(L.KeyQ, L.KeyE)} pivoter · ${k('Espace')} stationnaire`;
    this.shipHint = `${k(L.KeyR)} gaz pour avancer · ${k(L.KeyS)} monter · ${k(L.KeyW)} descendre · ${k(L.KeyA, L.KeyD)} virer · ${k('Espace')} s'arrêter et rester suspendu`;
    this.flightHint = `${k(L.KeyR)} mettre les gaz · ${k(L.KeyS)} cabrer pour décoller · ${k(L.KeyA, L.KeyD)} incliner · ${k('C')} vue · ${k('Échap')} toutes les commandes`;
  }

  on(name, fn) { this.handlers[name] = fn; }
  emit(name, arg) { if (this.handlers[name]) this.handlers[name](arg); }

  loaded() { $('loading').classList.add('done'); }

  /** Atouts affichés en étiquettes. */
  tagsOf(p) {
    const t = [];
    if (p.id === 'helico' || p.id === 'canadair') t.push("Bombardier d'eau");
    if (p.hover) t.push('Décollage vertical');
    if (p.radar) t.push('Radar');
    if (p.tundra) t.push('Se pose partout');
    if (p.foot) t.push('Décollage à pied');
    if (p.balloon) t.push('Va où va le vent');
    if (p.crane) t.push('Charges très lourdes');
    if (p.rescue) t.push('Treuil de secours');
    if (p.sling && !p.crane) t.push('Élingue');
    if (p.paras) t.push('Parachutistes');
    if (p.drops) t.push('Largage de matériel');
    if (p.airship) t.push("Plus léger que l'air");
    if (p.missiles && p.afterburner) t.push('Ravitaillement en vol');
    if (p.heli) t.push('Vol stationnaire');
    if (p.missiles) t.push('Missiles');
    if (p.guns) t.push('Mitrailleuses');
    if (p.amphibian) t.push('Amphibie'); else if (p.floats) t.push('Flotteurs');
    if (p.afterburner) t.push('Postcombustion');
    if (p.engine && p.engine.count > 1) t.push(p.heli ? `${p.engine.count} rotors` : `${p.engine.count} moteurs`);
    if (p.retract && !p.amphibian) t.push('Train rentrant');
    if (p.reverser) t.push('Inverseurs');
    if (p.drogue) t.push('Parachute-frein');
    if (p.flaps && !p.hover) t.push('Volets');
    return t;
  }

  /** Commandes propres à l'appareil (clavier, puis manette). */
  controlsOf(p) {
    const L = this.L, k = this.k, rows = [];
    if (p.heli) {
      rows.push([k(L.KeyR, L.KeyF), 'Gaz : 50 % = vol stationnaire, plus pour monter']);
      rows.push([k(L.KeyW, L.KeyS), 'Avancer / reculer']);
      rows.push([k(L.KeyA, L.KeyD), 'Tourner']);
      rows.push([k(L.KeyQ, L.KeyE), 'Pivoter sur place']);
      rows.push([k('Espace'), 'Retour au vol stationnaire']);
    } else if (p.balloon) {
      rows.push([k(L.KeyR, L.KeyF), 'Brûleur (monter) / soupape (descendre)']);
      rows.push([k(L.KeyW, L.KeyS, L.KeyA, L.KeyD), 'Petit ventilateur : avancer un peu, pivoter']);
    } else if (p.airship) {
      rows.push([k(L.KeyR, L.KeyF), 'Gaz : vitesse']);
      rows.push([k(L.KeyW, L.KeyS), 'Descendre / monter']);
      rows.push([k(L.KeyA, L.KeyD), 'Virer (lentement)']);
      rows.push([k('Espace'), "S'arrêter, rester suspendu"]);
    } else {
      rows.push([k(L.KeyR, L.KeyF), 'Gaz']);
      rows.push([k(L.KeyW, L.KeyS), 'Piquer / cabrer']);
      rows.push([k(L.KeyA, L.KeyD), 'Incliner (et virer)']);
      if (p.foot) rows.push([k(L.KeyR), 'Courir pour décoller (au sol)']);
      if (p.hover) rows.push([k('V'), 'Tuyères : vers le bas (vol vertical) / vers l\'arrière (avion)']);
      else if (p.flaps) rows.push([k('V'), 'Volets']);
      if (p.reverser || p.drogue) rows.push([k('Espace'), p.drogue ? 'Au sol, gaz réduits : freins et parachute-frein' : 'Au sol, gaz réduits : freins et inverseurs']);
      if (p.retract) rows.push([k('G'), p.amphibian ? 'Roues : piste (sorties) / eau (rentrées)' : 'Train']);
    }
    if (p.missiles) rows.push([k('X'), 'Missile : vise ~1 s pour verrouiller']);
    if (p.guns) rows.push([k('X'), 'Mitrailleuses (maintenir)']);
    if (p.id === 'helico') rows.push([k('X'), "Larguer l'eau (maintenir) · écope en stationnaire au ras de l'eau"]);
    if (p.rescue) rows.push([k('X'), 'Treuil : maintenir pour descendre le câble, relâcher pour remonter']);
    if (p.sling) rows.push([k('X'), "Accrocher / décrocher la charge (crochet près de l'anneau jaune)"]);
    if (p.paras) rows.push([k('X'), 'Faire sauter 4 parachutistes (plus de 250 m de haut)']);
    if (p.drops) rows.push([k('X'), 'Larguer une charge (plus de 120 m de haut)']);
    if (p.missiles && p.afterburner) rows.push(['Ravitailleur', 'Place-toi sous sa perche, derrière lui, à la même vitesse']);
    if (p.id === 'canadair') rows.push([k('X'), "Larguer l'eau (maintenir) · écope en rasant l'eau"]);
    if (p.gate) rows.push([k('X'), "À la porte de l'aéroport : demander le repoussage"]);
    rows.push([k('B'), 'Sauter en parachute']);
    rows.push(['🎮', p.heli ? 'Stick gauche · RT / LT gaz · LB / RB pivot' : 'Stick gauche · RT / LT gaz · LB / RB palonnier']);
    return rows.map(([a, b]) => `<span>${a}</span><span>${b}</span>`).join('');
  }

  showPlane(spec, index = this.sel) {
    this.sel = index;
    $('pkind').textContent = spec.label || (spec.heli ? 'Hélicoptère' : 'Avion');
    $('pname').textContent = spec.variant ? `${spec.name} · ${spec.variant}` : spec.name;
    this.showVariants(spec, index);
    $('pdesc').textContent = spec.desc;
    $('tags').innerHTML = this.tagsOf(spec).map((t) => `<span>${t}</span>`).join('');
    $('s-vit').style.width = `${spec.stats[0] * 100}%`;
    $('s-agi').style.width = `${spec.stats[1] * 100}%`;
    $('s-fac').style.width = `${spec.stats[2] * 100}%`;
    $('pctrl').innerHTML = this.controlsOf(spec);
    // l'appareil choisi doit être visible dans le filtre courant
    if (!this.inCat(spec)) this.setCat('all');
    const h = this.head(index);
    this.items.forEach((b, n) => b.classList.toggle('on', n === h));
    if (this.thumbs[index]) this.putThumb(h, this.thumbs[index]);
    this.items[h].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /** Premier appareil de la famille (celui qui figure dans la liste). */
  head(i) {
    const f = this.planes[i].family;
    return f ? this.planes.findIndex((p) => p.family === f) : i;
  }
  /** Boutons « Version » pour un appareil décliné (classique, postier, hydravion…). */
  showVariants(spec, index) {
    const box = $('variantbox'), row = $('variants');
    box.hidden = !spec.family;
    row.innerHTML = '';
    if (!spec.family) return;
    this.lastVariant[spec.family] = index;
    this.planes.forEach((p, i) => {
      if (p.family !== spec.family) return;
      const b = document.createElement('button');
      b.className = 'chip' + (i === index ? ' on' : '');
      b.textContent = p.variant;
      b.addEventListener('click', () => this.emit('plane-select', i));
      row.appendChild(b);
    });
  }

  inCat(p) { return this.cat === 'all' || (this.cat === 'helico') === !!p.heli; }
  setCat(cat, pick) {
    this.cat = cat;
    this.tabs.forEach((t) => t.classList.toggle('on', t.dataset.cat === cat));
    this.items.forEach((b, n) => { b.hidden = !this.inCat(this.planes[n]) || this.head(n) !== n; });
    if (pick && !this.inCat(this.planes[this.sel])) this.emit('plane-select', this.planes.findIndex((p) => this.inCat(p)));
  }
  /** Catégorie suivante / précédente (manette LB / RB). */
  cycleCat(d) {
    const cats = this.tabs.map((t) => t.dataset.cat);
    this.setCat(cats[(cats.indexOf(this.cat) + d + cats.length) % cats.length], true);
  }
  /** Appareil suivant / précédent dans le filtre courant. */
  step(d) {
    const n = this.planes.length, from = this.head(this.sel);
    for (let k = 1; k <= n; k++) {
      const i = (from + d * k + n * 4) % n;
      if (this.inCat(this.planes[i]) && this.head(i) === i) {
        const f = this.planes[i].family;
        return f && this.lastVariant[f] !== undefined ? this.lastVariant[f] : i;
      }
    }
    return this.sel;
  }
  setThumb(i, url) {
    this.thumbs[i] = url;
    // la vignette d'une famille montre la version choisie
    const h = this.head(i), f = this.planes[i].family;
    if (h === i ? !(f && this.lastVariant[f] !== undefined && this.lastVariant[f] !== i) : this.lastVariant[f] === i) this.putThumb(h, url);
  }
  putThumb(i, url) {
    const ph = this.items[i].querySelector('.ph, img');
    const img = document.createElement('img');
    img.src = url; img.alt = '';
    ph.replaceWith(img);
  }
  /** Option « incendies », visible seulement pour l'hélicoptère bombardier d'eau. */
  showFires(visible, on) {
    $('waterbox').hidden = !visible;
    $('firesbtn').textContent = `Incendies : ${on ? 'oui' : 'non'}`;
    $('firesbtn').classList.toggle('on', on);
    $('firesdesc').textContent = on
      ? "Des feux se déclarent sur l'île : écope au ras de l'eau et largue sur les flammes avec X. Une fois tous éteints, d'autres se déclarent."
      : "Pas d'incendie : tu peux quand même écoper au ras de l'eau et larguer où tu veux avec X.";
  }
  /** Livrées, avec une pastille de leurs couleurs (sur l'appareil choisi). */
  showLiveries(spec, liveries, sel) {
    const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;
    // chaque appareil a ses propres livrées : on recrée les pastilles quand il en faut d'autres
    while (this.liveryChips.length < liveries.length) {
      const b = document.createElement('button'), i = this.liveryChips.length;
      b.className = 'chip';
      b.addEventListener('click', () => this.emit('livery-select', i));
      $('liveries').appendChild(b);
      this.liveryChips.push(b);
    }
    this.liveryChips.forEach((b, i) => {
      const l = liveries[i];
      b.hidden = !l;
      if (!l) return;
      const cols = (l.colors || spec.paint || []).slice(0, (spec.paint || []).length || 2);
      b.innerHTML = `<span class="sw">${cols.map((c) => `<i style="background:${hex(c)}"></i>`).join('')}</span>${l.name}`;
      b.classList.toggle('on', i === sel);
    });
  }
  setFuel(on) {
    $('fuelbtn').textContent = `Carburant : ${on ? 'oui' : 'non'}`;
    $('fuelbtn').title = on ? "Le plein se fait à l'arrêt sur la station devant les hangars de l'aéroport" : '';
    $('fuelbtn').classList.toggle('on', on);
  }
  setBigMap(big) {
    $('mapbtn').textContent = `Carte : ${big ? 'grande' : 'petite'}`;
    $('mapbtn').title = big ? "L'île, deux grandes îles voisines et des îlots, 4 pistes (cliquer recharge le jeu)" : "L'île seule (cliquer recharge le jeu)";
  }
  setDaytime(name) { $('daytime').textContent = `Heure : ${name}`; }
  setMute(m) { $('mutebtn').textContent = `Son : ${m ? 'coupé' : 'activé'}`; }
  showStart(i) { this.chips.forEach((c, n) => c.classList.toggle('on', n === i)); }
  setInvert(v) { $('invert').textContent = `Tangage : ${v ? 'inversé' : 'normal'}`; }

  menu(show) { $('menu').classList.toggle('off', !show); }
  pause(show) { $('pause').hidden = !show; }
  hud(show) {
    $('hud').hidden = !show; $('compass').hidden = !show; $('minimap').hidden = !show;
    if (!show) { this.approach(null); this.bigMap(false); }
  }
  /** Carnet de vol : contenu HTML, ou null pour fermer. */
  career(html) { $('career').hidden = !html; if (html) { $('c-body').innerHTML = html; $('c-body').scrollTop = 0; } }
  get careerOpen() { return !$('career').hidden; }
  bigMap(show) { $('bigmap').hidden = !show; }
  get bigMapOpen() { return !$('bigmap').hidden; }

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

  /** Jauge de carburant (fraction 0..1) ; null pour la cacher. */
  fuel(f) {
    const b = $('h-fuel'), u = $('h-fuel-u');
    if (f === null) { if (!b.hidden) { b.hidden = true; u.hidden = true; } return; }
    b.hidden = false; u.hidden = false;
    const t = String(Math.ceil(f * 100));
    if (b.textContent !== t) b.textContent = t;
    b.style.color = f < 0.15 ? '#ff6b5e' : '';
  }

  /** Panneau de mission en haut à gauche ; null pour le cacher. */
  mission(h) {
    const el = $('mission');
    if (!h) { el.hidden = true; return; }
    el.hidden = false;
    const html = `<div class="t">${h.title}</div><div class="b">${h.big}<small>${h.unit || ''}</small></div>`
      + h.lines.filter(Boolean).map((l) => `<div class="l">${l}</div>`).join('')
      + (h.bar !== undefined ? `<div class="bar"><i style="width:${Math.round(h.bar * 100)}%"></i></div>` : '');
    if (html !== this.missionHtml) { this.missionHtml = html; el.innerHTML = html; }
  }
  /** Écran de fin de mission ; null pour le cacher. */
  result(r) {
    $('result').hidden = !r;
    if (!r) return;
    $('r-title').textContent = r.title; $('r-big').textContent = r.big;
    $('r-rec').textContent = r.line; $('r-rec').classList.toggle('new', !!r.isNew);
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
