import type { Finger, JointName } from '../istep/index';

const SIDE: Record<string, string> = { l: 'left', r: 'right' };
const PART: Record<string, string> = {
  shoulder: 'arm',
  elbow: 'elbow',
  hip: 'hip',
  knee: 'knee',
  ankle: 'heel',
};

/** Human hint for a signed joint error (user − target, degrees). Kind, imperative, no numbers. */
export function jointHint(joint: JointName, err: number): string {
  const more = err > 0; // user angle larger than target
  if (joint === 'torso') return more ? 'stand up a little straighter' : 'lean forward a little';
  const [s, p] = joint.split('_') as [string, string];
  const side = SIDE[s]!;
  switch (p) {
    case 'shoulder':
      return more ? `lower your ${side} arm a little` : `raise your ${side} arm higher`;
    case 'elbow':
      return more ? `bend your ${side} elbow more` : `straighten your ${side} elbow`;
    case 'hip':
      return more ? `bend a little more at your ${side} hip` : `straighten up at your ${side} hip`;
    case 'knee':
      return more ? `bend your ${side} knee more` : `straighten your ${side} knee`;
    default:
      return more ? `lower your ${side} heel a little` : `lift your ${side} heel higher`;
  }
}

export function jointDisplayName(joint: JointName): string {
  if (joint === 'torso') return 'Back';
  const [s, p] = joint.split('_') as [string, string];
  const name = `${SIDE[s]} ${PART[p]}`;
  return name[0]!.toUpperCase() + name.slice(1);
}

export function fingerHint(finger: Finger, hint: 'curl' | 'extend'): string {
  const name = finger === 'pinky' ? 'little finger' : finger === 'thumb' ? 'thumb' : `${finger} finger`;
  return hint === 'curl' ? `curl your ${name} down` : `stretch your ${name} up`;
}
