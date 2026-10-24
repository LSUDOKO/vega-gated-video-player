/**
 * Demo: drives <GatedPlayer> with a synthetic landmark stream (no camera needed).
 * The learner "bends their knees" 3 s after the video pauses, so the gate passes and the video resumes.
 */
import React, { useEffect, useMemo } from 'react';
import { Text, View } from 'react-native';
import { makePose } from '../src/engine/fixtures';
import { GatedPlayer, IstepTrack, createFrameStream } from '../src/react-native';

const track = IstepTrack.parse({
  istep: '1.0',
  id: 'demo',
  title: 'Demo',
  channel: 'kids',
  language: 'en-US',
  video: { src: 'video.mp4', durationSec: 20 },
  tracking: ['pose'],
  camera: { view: 'front', hint: 'Stand back' },
  gates: [
    {
      id: 'squat',
      t: 5,
      type: 'pose_match',
      label: 'Bend your knees',
      target: { source: 'angles', angles: { l_knee: 120, r_knee: 120 } },
      joints: ['l_knee', 'r_knee'],
      fallbackTip: 'Bend your knees a little.',
    },
  ],
});

export function App() {
  const frames$ = useMemo(() => createFrameStream(), []);
  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => {
      const bent = Date.now() - start > 8000;
      frames$.push({
        ts: Date.now(),
        mirrored: false,
        pose: makePose(bent ? { l_knee: 120, r_knee: 120 } : {}),
      });
    }, 33);
    return () => clearInterval(id);
  }, [frames$]);
  return (
    <GatedPlayer
      // Vega's media player only plays HTTPS sources (plain http:// fails with a media error).
      source={{ uri: 'https://example.com/your-lesson/video.mp4' }}
      track={track}
      frames$={frames$}
      style={{ flex: 1 }}
      renderOverlay={(s) => (
        <View style={{ position: 'absolute', bottom: 40, left: 40 }}>
          <Text style={{ color: 'white', fontSize: 32 }}>
            {s.gate ? `${s.gate.label} — ${s.phase}` : s.phase}
          </Text>
        </View>
      )}
    />
  );
}
