// Réglages et records, gardés dans le navigateur (localStorage) d'une partie à l'autre.
// Si le navigateur refuse (navigation privée…), tout marche quand même, sans mémoire.

const KEY = 'airgame.v1';
const data = { invert: false, fuel: false, liveries: {}, records: {}, plane: 0, start: 0, mode: 'libre' };
try { Object.assign(data, JSON.parse(localStorage.getItem(KEY)) || {}); } catch { /* rien de sauvegardé */ }

function write() {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* stockage indisponible */ }
}

export const save = {
  get(k) { return data[k]; },
  set(k, v) { data[k] = v; write(); },
  livery(id) { return data.liveries[id] || 0; },
  setLivery(id, i) { data.liveries[id] = i; write(); },
  best(key) { return data.records[key]; },
  /** Enregistre un score ; lower = true quand le plus petit gagne (un temps). Renvoie { best, isNew }. */
  record(key, value, lower = false) {
    const old = data.records[key];
    const isNew = old === undefined || (lower ? value < old : value > old);
    if (isNew) { data.records[key] = value; write(); }
    return { best: isNew ? value : old, isNew };
  },
};
