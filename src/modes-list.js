// Modes de jeu proposés au menu, et les appareils qui y ont droit.
export const MODES = [
  { id: 'libre', name: 'Vol libre', desc: 'Aucun but, juste voler.', ok: () => true },
  { id: 'voltige', name: 'Voltige notée', desc: '3 minutes pour marquer un maximum de points : loopings, tonneaux, vol dos, passages sous l\'arche… Enchaîner les figures multiplie les points.', ok: (p) => !p.heli },
  { id: 'chasse', name: 'Chasse', desc: '3 minutes pour abattre un maximum de montgolfières (elles réapparaissent vite).', ok: (p) => !!(p.missiles || p.guns), why: 'jet ou chasseur à hélice' },
  { id: 'feux', name: 'Feux de forêt', desc: 'Des feux se déclarent sur l\'île : écope de l\'eau (au ras de la mer ou d\'un lac) et largue-la sur les flammes avec X.', ok: (p) => !!(p.heli || p.amphibian), why: 'hélicoptères ou hydravion' },
];
