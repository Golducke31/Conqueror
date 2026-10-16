import { describe, expect, it } from 'vitest';

import { planSeaCrossing } from './sea.js';
import { SPECTACLE_PROFILES } from '../spectacle.js';

describe('planSeaCrossing — estructura', () => {
  it('las fases van en serie', () => {
    const plan = planSeaCrossing({
      timing: SPECTACLE_PROFILES.tactical.sea,
      shipCount: 2,
    });
    expect(plan.sail.start).toBe(0);
    expect(plan.broadside.start).toBeCloseTo(plan.sail.start + plan.sail.duration);
    expect(plan.landing.start).toBeCloseTo(plan.broadside.start + plan.broadside.duration);
    expect(plan.duration).toBeCloseTo(
      plan.sail.duration + plan.broadside.duration + plan.landing.duration,
    );
  });

  it('la duración no depende de la cantidad de navíos', () => {
    const uno = planSeaCrossing({ timing: SPECTACLE_PROFILES.tactical.sea, shipCount: 1 });
    const cuatro = planSeaCrossing({ timing: SPECTACLE_PROFILES.tactical.sea, shipCount: 4 });
    expect(cuatro.duration).toBeCloseTo(uno.duration);
  });

  it('en Rápido se omiten la navegación y la andanada', () => {
    const plan = planSeaCrossing({ timing: SPECTACLE_PROFILES.fast.sea, shipCount: 1 });
    expect(plan.sail.duration).toBe(0);
    expect(plan.broadside.duration).toBe(0);
    // El desembarco queda instantáneo: la escena coloca las tropas ya listas.
    expect(plan.duration).toBeLessThanOrEqual(0.2);
  });
});
