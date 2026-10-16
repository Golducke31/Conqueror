import { describe, expect, it } from 'vitest';

import { planConquest } from './conquest.js';
import { SPECTACLE_PROFILES, type SpectacleLevel } from '../spectacle.js';

const LEVELS: readonly SpectacleLevel[] = ['fast', 'tactical', 'cinematic'];

describe('planConquest — estructura', () => {
  it('las fases van en serie y sin solaparse', () => {
    const plan = planConquest({ timing: SPECTACLE_PROFILES.tactical.conquest });
    expect(plan.advance.start).toBe(0);
    expect(plan.plant.start).toBeCloseTo(plan.advance.start + plan.advance.duration);
    expect(plan.wave.start).toBeCloseTo(plan.plant.start + plan.plant.duration);
    expect(plan.hold.start).toBeCloseTo(plan.wave.start + plan.wave.duration);
    expect(plan.close.start).toBeCloseTo(plan.hold.start + plan.hold.duration);
  });

  it('la duracion total es la suma de las fases', () => {
    for (const level of LEVELS) {
      const timing = SPECTACLE_PROFILES[level].conquest;
      const plan = planConquest({ timing });
      const suma = timing.advance + timing.plant + timing.wave + timing.hold + timing.close;
      expect(plan.duration).toBeCloseTo(suma);
    }
  });

  it('la onda arranca despues de plantar el estandarte', () => {
    const plan = planConquest({ timing: SPECTACLE_PROFILES.tactical.conquest });
    expect(plan.wave.start).toBeGreaterThan(plan.plant.start);
  });
});

describe('planConquest — duraciones por nivel', () => {
  it('Rapido entra en su conquestSeconds (0.9 s)', () => {
    const profile = SPECTACLE_PROFILES.fast;
    const plan = planConquest({ timing: profile.conquest });
    expect(plan.duration / profile.conquestTimeScale).toBeLessThanOrEqual(
      profile.conquestSeconds + 1e-9,
    );
  });

  it('Tactico entra en su conquestSeconds (1.9 s)', () => {
    const profile = SPECTACLE_PROFILES.tactical;
    const plan = planConquest({ timing: profile.conquest });
    expect(plan.duration / profile.conquestTimeScale).toBeLessThanOrEqual(
      profile.conquestSeconds + 1e-9,
    );
  });

  it('Cinemático, con la cámara lenta, también entra en conquestSeconds (3 s)', () => {
    const profile = SPECTACLE_PROFILES.cinematic;
    const plan = planConquest({ timing: profile.conquest });
    expect(plan.duration / profile.conquestTimeScale).toBeCloseTo(profile.conquestSeconds, 1);
  });

  it('cada nivel es mas lento que el anterior en duración real', () => {
    const real = (level: SpectacleLevel): number => {
      const profile = SPECTACLE_PROFILES[level];
      // timeScale < 1 enlentece: la duracion real es duration / timeScale.
      return planConquest({ timing: profile.conquest }).duration / profile.conquestTimeScale;
    };
    expect(real('tactical')).toBeGreaterThan(real('fast'));
    expect(real('cinematic')).toBeGreaterThan(real('tactical'));
  });
});
