import { save } from './save.js';
import { heightAt, BIG, VOLCANO } from './world/terrain.js';
import { runwayAt, runways } from './world/airfields.js';
import { city, islets } from './world/places.js';

// Carnet de vol (heures, kilomètres, décollages, atterrissages par appareil) et badges. Tout est gardé dans le navigateur.

/** Badges : [identifiant, nom, comment l'obtenir, groupe]. */
export const BADGES = [
  ['envol', 'Premier envol', 'Décoller pour la première fois', 'Vol'],
  ['douceur', 'Comme une plume', 'Se poser sur une piste à moins de 0,8 m/s de descente', 'Vol'],
  ['nuit', 'Oiseau de nuit', 'Se poser sur une piste de nuit', 'Vol'],
  ['panne', 'Moteur coupé', "Se poser sur une piste après 20 s de vol sans gaz ou en panne", 'Vol'],
  ['pont', 'Appontage', 'Se poser sur le porte-avions', 'Vol'],
  ['eau', 'Amerrissage', "Se poser sur l'eau", 'Vol'],
  ['altiport', 'Montagnard', "Se poser à l'altiport", 'Vol'],
  ['terrains', 'Tour des terrains', 'Se poser sur toutes les pistes de la carte', 'Vol'],
  ['plafond', 'Tutoyer les nuages', 'Monter à plus de 2 500 m', 'Vol'],
  ['vitesse', 'Boulet de canon', 'Dépasser 900 km/h', 'Vol'],
  ['looping', 'Premier looping', 'Faire un looping', 'Voltige'],
  ['tonneau', 'Premier tonneau', 'Faire un tonneau', 'Voltige'],
  ['vrille', 'Tire-bouchon', "Enchaîner trois tonneaux", 'Voltige'],
  ['dos', 'Tête en bas', 'Voler sur le dos trois secondes', 'Voltige'],
  ['arche', "Sous l'arche", "Passer sous l'arche rocheuse", 'Voltige'],
  ['canyon', 'Pilote de canyon', 'Voler au fond du canyon', 'Voltige'],
  ['cratere', 'Dans le cratère', 'Descendre dans le cratère du volcan', 'Voltige'],
  ['rasmottes', 'Rase-mottes', 'Voler au ras du sol ou des vagues', 'Voltige'],
  ['sauveteur', 'Sauveteur', 'Mettre trois blessés à l\'abri en un vol', 'Missions'],
  ['pompier', 'Pompier du ciel', 'Éteindre tous les feux', 'Missions'],
  ['facteur', 'Facteur', 'Livrer cinq sacs de courrier en un vol', 'Missions'],
  ['grutier', 'Grutier', "Livrer deux charges à l'élingue en un vol", 'Missions'],
  ['paras', 'Maître de saut', 'Poser quatre parachutistes sur la croix', 'Missions'],
  ['largage', 'Dans le mille', 'Larguer deux charges en plein dans la cible', 'Missions'],
  ['plein', 'Plein en vol', 'Ravitailler le Jet en vol', 'Missions'],
  ['ballons', 'Chasseur de ballons', 'Abattre cinq montgolfières', 'Missions'],
  ['thermique', 'Roi des thermiques', 'Dix minutes de planeur sans se poser', 'Voyages'],
  ['ilots', "D'île en île", 'Survoler tous les îlots aménagés à moins de 300 m', 'Voyages'],
  ['eruption', 'Aux premières loges', 'Voler près du volcan pendant une éruption', 'Voyages'],
  ['ville', 'Entre les tours', 'Voler à moins de 70 m du sol dans la Grande Ville', 'Voyages'],
  ['ballade', "Plus léger que l'air", 'Cinq minutes de vol en dirigeable', 'Voyages'],
  ['collection', 'Collectionneur', 'Voler avec dix appareils différents', 'Voyages'],
  ['mille', 'Grand voyageur', 'Parcourir 1 000 km en tout', 'Voyages'],
];
/** Figures reconnues par tricks.js -> badge. */
const TRICK = [[/^Looping/, 'looping'], [/^Tonneau/, 'tonneau'], [/^Tonneau ×([3-9])/, 'vrille'], [/^Vol dos/, 'dos'], [/arche/, 'arche'], [/canyon/, 'canyon'], [/cratère/, 'cratere'], [/^Rase/, 'rasmottes']];

export class Career {
  constructor(onBadge) {
    this.onBadge = onBadge;
    this.log = save.get('log') || {};
    this.badges = save.get('badges') || {};
    this.seen = save.get('seen') || {}; // terrains et îlots visités
    this.dirty = false; this.saveT = 0; this.idle = 0; this.pollT = 0; this.air = 0;
    this.prev = null;
  }
  entry(id) { return this.log[id] || (this.log[id] = { t: 0, km: 0, up: 0, down: 0 }); }
  get total() { return Object.values(this.log).reduce((a, e) => ({ t: a.t + e.t, km: a.km + e.km, up: a.up + e.up, down: a.down + e.down }), { t: 0, km: 0, up: 0, down: 0 }); }
  give(id) {
    if (this.badges[id]) return;
    this.badges[id] = Date.now();
    this.flush(); save.set('badges', this.badges);
    const b = BADGES.find((x) => x[0] === id);
    if (b && this.onBadge) this.onBadge(b[1]);
  }
  mark(key) { if (!this.seen[key]) { this.seen[key] = 1; save.set('seen', this.seen); } }
  flush() { if (this.dirty) { this.dirty = false; save.set('log', this.log); } }

  takeoff(plane) { this.entry(plane.spec.id).up++; this.dirty = true; this.give('envol'); }
  /** Atterrissage : e est l'événement « touchdown » du modèle de vol. */
  touchdown(e, plane, night) {
    this.entry(plane.spec.id).down++; this.dirty = true; this.flush();
    if (e.surface === 'carrier') this.give('pont');
    if (e.surface === 'water') this.give('eau');
    if (e.surface === 'runway') {
      const rw = runwayAt(plane.pos.x, plane.pos.z);
      if (rw) {
        this.mark(`${BIG ? 'G' : 'P'}:${rw.id}`);
        if (rw.id === 'altiport') this.give('altiport');
        if (runways.every((r) => this.seen[`${BIG ? 'G' : 'P'}:${r.id}`])) this.give('terrains');
      }
      if (e.sink < 0.8 && !plane.spec.heli && !plane.spec.airship) this.give('douceur');
      if (night > 0.5) this.give('nuit');
      if (this.idle > 20 && !plane.spec.heli && !plane.spec.glider && !plane.spec.airship) this.give('panne');
    }
    this.idle = 0; this.air = 0;
  }
  trick(msg) { for (const [re, id] of TRICK) if (re.test(msg)) this.give(id); }

  /** À chaque image de vol. ctx : { mission, kills, refuels, erupting }. */
  update(dt, plane, ctx) {
    const s = plane.spec;
    if (!plane.onGround && !plane.crashed) {
      const e = this.entry(s.id);
      e.t += dt; e.km += (plane.speed * dt) / 1000; this.dirty = true; this.air += dt;
      this.idle = plane.throttle < 0.03 || !plane.engineRunning ? this.idle + dt : 0;
    } else if (plane.crashed) { this.idle = 0; this.air = 0; }
    if ((this.saveT += dt) > 20) { this.saveT = 0; this.flush(); }
    if ((this.pollT += dt) < 0.5) return;
    this.pollT = 0;
    const p = plane.pos, m = ctx.mission;
    if (p.y > 2500) this.give('plafond');
    if (plane.speed > 250) this.give('vitesse');
    if (s.glider && this.air > 600) this.give('thermique');
    if (ctx.refuels) this.give('plein');
    if (ctx.kills >= 5) this.give('ballons');
    if (m) {
      if (m.rescued >= 3) this.give('sauveteur');
      if (s.mail && m.delivered >= 5) this.give('facteur');
      if (s.sling && m.delivered >= 2) this.give('grutier');
      if (s.paras && m.onTarget >= 4) this.give('paras');
      if (s.drops && m.bulls >= 2) this.give('largage');
      if (m.fires && m.fires.length && m.fires.every((f) => f.out)) this.give('pompier');
    }
    if (!plane.onGround) {
      if (ctx.erupting && Math.hypot(p.x - VOLCANO.x, p.z - VOLCANO.z) < VOLCANO.baseR * 1.7) this.give('eruption');
      if (city.active && Math.abs(p.x - city.x) < city.halfWid * 0.8 && Math.abs(p.z - city.z) < city.halfLen * 0.8 && p.y - heightAt(p.x, p.z) < 70) this.give('ville');
      for (const o of islets) if (Math.hypot(p.x - o.x, p.z - o.z) < o.r * 1.1 && p.y < 420) { this.mark(`${BIG ? 'G' : 'P'}:${o.kind}`); if (islets.every((q) => this.seen[`${BIG ? 'G' : 'P'}:${q.kind}`])) this.give('ilots'); }
      if (s.airship && this.entry(s.id).t > 300) this.give('ballade');
      if (Object.values(this.log).filter((e) => e.t > 30).length >= 10) this.give('collection');
      if (this.total.km > 1000) this.give('mille');
    }
  }

  /** Contenu du panneau (HTML). */
  html(planes) {
    const hm = (t) => (t >= 3600 ? `${Math.floor(t / 3600)} h ${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}` : t >= 60 ? `${Math.floor(t / 60)} min` : `${Math.round(t)} s`);
    const km = (v) => (v < 10 ? v.toFixed(1).replace('.', ',') : Math.round(v).toLocaleString('fr-FR'));
    const T = this.total, got = BADGES.filter((b) => this.badges[b[0]]).length;
    const rows = planes.filter((p) => this.log[p.id]).map((p) => [p, this.log[p.id]]).sort((a, b) => b[1].t - a[1].t)
      .map(([p, e]) => `<tr><td>${p.variant ? `${p.name} · ${p.variant}` : p.name}</td><td>${hm(e.t)}</td><td>${km(e.km)}</td><td>${e.up}</td><td>${e.down}</td></tr>`).join('');
    const groups = [...new Set(BADGES.map((b) => b[3]))].map((g) => `<h4>${g}</h4><div class="badges">${BADGES.filter((b) => b[3] === g).map((b) => {
      const d = this.badges[b[0]];
      return `<div class="badge${d ? ' on' : ''}"><b>${b[1]}</b><span>${b[2]}</span>${d ? `<i>obtenu le ${new Date(d).toLocaleDateString('fr-FR')}</i>` : ''}</div>`;
    }).join('')}</div>`).join('');
    return `<div class="sums"><div><b>${hm(T.t)}</b>en vol</div><div><b>${km(T.km)} km</b>parcourus</div><div><b>${T.up}</b>décollages</div><div><b>${T.down}</b>atterrissages</div><div><b>${got}/${BADGES.length}</b>badges</div></div>`
      + (rows ? `<table><thead><tr><th>Appareil</th><th>Temps</th><th>km</th><th>Décoll.</th><th>Atterr.</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="none">Le carnet se remplit tout seul dès le premier vol.</p>')
      + groups;
  }
}
