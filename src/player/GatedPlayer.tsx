import { KeplerVideoSurfaceView, VideoPlayer } from '@amazon-devices/react-native-w3cmedia';
import type { Frame } from '../engine/index';
import type { IstepTrack, ReferenceTimeline } from '../istep/index';
import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import {
  createGatedPlayer,
  type GatedPlayer as Controller,
  type MediaAdapter,
  type PlayerEvent,
  type SessionSummary,
  type Snapshot,
} from './controller';

export type FrameStream = {
  /** Calls back with every landmarks frame; returns an unsubscribe function. */
  subscribe(
    cb: (frame: Frame, peer: { peerId: string; role: 'host' | 'guest'; name?: string }) => void,
  ): () => void;
};

export type GatedPlayerProps = {
  source: { uri: string };
  track: IstepTrack;
  reference?: ReferenceTimeline;
  frames$: FrameStream;
  onGateEvent?: (e: PlayerEvent) => void;
  onEnd?: (summary: SessionSummary) => void;
  renderOverlay?: (state: Snapshot) => ReactNode;
  style?: ViewStyle;
  /** gives the parent the controller for remote keys: control('toggle_pause' | 'repeat' | 'next' | 'easier' | 'ok') */
  controllerRef?: React.MutableRefObject<Controller | null>;
  options?: { affectedHand?: 'left' | 'right'; tickMs?: number };
};

/**
 * Vega (Fire TV) video player that pauses at `.istep` gates and resumes when live landmarks pass them.
 * Uses the W3C media VideoPlayer on a KeplerVideoSurfaceView. No server dependency.
 */
export function GatedPlayer({
  source,
  track,
  reference,
  frames$,
  onGateEvent,
  onEnd,
  renderOverlay,
  style,
  controllerRef,
  options,
}: GatedPlayerProps) {
  const [state, setState] = useState<Snapshot | null>(null);
  const player = useRef<VideoPlayer | null>(null);
  const surface = useRef<string | null>(null);
  const ctl = useRef<Controller | null>(null);
  const events = useRef({ onGateEvent, onEnd });
  events.current = { onGateEvent, onEnd };

  useEffect(() => {
    const v = new VideoPlayer();
    player.current = v;
    let tick: ReturnType<typeof setInterval> | undefined;
    let unsub: (() => void) | undefined;
    let alive = true;
    void v.initialize().then(() => {
      if (!alive) return;
      v.autoplay = false;
      if (surface.current) v.setSurfaceHandle(surface.current);
      v.src = source.uri;
      v.load();
      const media: MediaAdapter = {
        play: () => void v.play(),
        pause: () => v.pause(),
        seek: (s) => {
          v.currentTime = s;
        },
        currentTime: () => v.currentTime,
        setRate: (r) => {
          v.playbackRate = r;
          return Math.abs(v.playbackRate - r) < 0.01;
        },
        setMuted: (m) => {
          v.muted = m;
        },
      };
      const c = createGatedPlayer({
        track,
        media,
        now: Date.now,
        ...(reference ? { reference } : {}),
        ...(options?.affectedHand ? { affectedHand: options.affectedHand } : {}),
        onEvent: (e) => {
          events.current.onGateEvent?.(e);
          if (e.type === 'ended') events.current.onEnd?.(e.summary);
        },
      });
      ctl.current = c;
      if (controllerRef) controllerRef.current = c;
      const joined = new Set<string>();
      unsub = frames$.subscribe((frame, peer) => {
        if (!joined.has(peer.peerId)) {
          joined.add(peer.peerId);
          c.join(peer);
        }
        c.pushFrame(peer.peerId, frame);
      });
      v.addEventListener('ended', () => c.end());
      c.start();
      tick = setInterval(() => {
        c.tick();
        setState(c.snapshot());
      }, options?.tickMs ?? 50);
    });
    return () => {
      alive = false;
      clearInterval(tick);
      unsub?.();
      void v.deinitialize().catch(() => undefined);
    };
    // the player is created once per source/track
  }, [source.uri, track]);

  return (
    <View style={[styles.box, style]}>
      <KeplerVideoSurfaceView
        style={StyleSheet.absoluteFill}
        onSurfaceViewCreated={(h: string) => {
          surface.current = h;
          player.current?.setSurfaceHandle(h);
        }}
        onSurfaceViewDestroyed={(h: string) => player.current?.clearSurfaceHandle(h)}
      />
      {state && renderOverlay ? <View style={StyleSheet.absoluteFill}>{renderOverlay(state)}</View> : null}
    </View>
  );
}

/** A frame stream you push into yourself (from a WebSocket, a replay file or a demo generator). */
export function createFrameStream(): FrameStream & {
  push(frame: Frame, peer?: { peerId: string; role: 'host' | 'guest' }): void;
} {
  const subs = new Set<Parameters<FrameStream['subscribe']>[0]>();
  return {
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    push(frame, peer = { peerId: 'local', role: 'host' }) {
      subs.forEach((cb) => cb(frame, peer));
    },
  };
}

const styles = StyleSheet.create({ box: { backgroundColor: '#000', overflow: 'hidden' } });
