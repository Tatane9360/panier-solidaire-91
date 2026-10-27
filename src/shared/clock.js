// Seul endroit qui lit l'heure système ; les tests passent leur propre horloge.
export const systemClock = { now: () => new Date() };
