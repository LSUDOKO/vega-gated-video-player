import { describe, expect, it } from 'vitest';
import { fingerHint, jointDisplayName, jointHint } from './hints';

describe('hints are kind, imperative and number-free', () => {
  it.each([
    ['l_shoulder', 5, 'lower your left arm a little'],
    ['r_shoulder', -5, 'raise your right arm higher'],
    ['l_elbow', 5, 'bend your left elbow more'],
    ['r_elbow', -5, 'straighten your right elbow'],
    ['l_hip', 5, 'bend a little more at your left hip'],
    ['r_hip', -5, 'straighten up at your right hip'],
    ['l_knee', 5, 'bend your left knee more'],
    ['r_knee', -5, 'straighten your right knee'],
    ['l_ankle', 5, 'lower your left heel a little'],
    ['r_ankle', -5, 'lift your right heel higher'],
    ['torso', 5, 'stand up a little straighter'],
    ['torso', -5, 'lean forward a little'],
  ] as const)('%s %d', (j, e, text) => {
    expect(jointHint(j, e)).toBe(text);
    expect(jointHint(j, e)).not.toMatch(/\d/);
  });
  it('display names', () => {
    expect(jointDisplayName('l_knee')).toBe('Left knee');
    expect(jointDisplayName('r_shoulder')).toBe('Right arm');
    expect(jointDisplayName('torso')).toBe('Back');
  });
  it('finger hints', () => {
    expect(fingerHint('pinky', 'extend')).toBe('stretch your little finger up');
    expect(fingerHint('thumb', 'curl')).toBe('curl your thumb down');
    expect(fingerHint('middle', 'curl')).toBe('curl your middle finger down');
  });
});
