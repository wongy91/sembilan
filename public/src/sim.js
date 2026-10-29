import { bearing, pointAt } from './geo.js';

export function simulate(route, onFix, { speedup = 3, interval = 1000 } = {}) {
  let along = 0;
  let timer = null;
  let k = 0;
  const tick = () => {
    while (k + 1 < route.steps.length && route.steps[k + 1].along <= along) k++;
    const step = route.steps[k];
    const v = Math.min(33, Math.max(5, step.duration > 0 ? step.length / step.duration : 12));
    along = Math.min(route.distance, along + v * (interval / 1000) * speedup);
    const p = pointAt(route.coords, route.cum, along);
    const ahead = pointAt(route.coords, route.cum, Math.min(route.distance, along + 10));
    onFix({ lon: p[0], lat: p[1], accuracy: 5, speed: v, heading: bearing(p, ahead), time: Date.now(), simulated: true });
    if (along < route.distance) timer = setTimeout(tick, interval);
  };
  timer = setTimeout(tick, 300);
  return () => clearTimeout(timer);
}
