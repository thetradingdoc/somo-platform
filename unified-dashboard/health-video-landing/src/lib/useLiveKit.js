import { useRef, useCallback } from 'react';

let TrackRef = null;

async function loadTrack() {
  if (!TrackRef) {
    const { Track } = await import('https://cdn.jsdelivr.net/npm/livekit-client@2.9.0/+esm');
    TrackRef = Track;
  }
  return TrackRef;
}


export function useLiveKit() {
  const roomRef = useRef(null);

  const connect = useCallback(async ({ url, token, videoEl, videoEls, onStatus, cameraEnabled = true, micEnabled = true }) => {
    const { Room, RoomEvent, Track } = await import('https://cdn.jsdelivr.net/npm/livekit-client@2.9.0/+esm');
    TrackRef = Track;

    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;

    const els = videoEls?.length ? videoEls : [videoEl];

    room.on(RoomEvent.Connected, async () => {
      onStatus?.('connected');
      await room.localParticipant.setMicrophoneEnabled(micEnabled);
      await room.localParticipant.setCameraEnabled(cameraEnabled);
      if (cameraEnabled) {
        const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
        if (pub?.track) {
          els.filter(Boolean).forEach((el) => pub.track.attach(el));
        }
      }
    });

    room.on(RoomEvent.Disconnected, () => onStatus?.('disconnected'));
    room.on(RoomEvent.Reconnecting, () => onStatus?.('reconnecting'));
    room.on(RoomEvent.Reconnected, () => onStatus?.('connected'));

    onStatus?.('connecting');
    await room.connect(url, token);
    return room;
  }, []);

  const toggleMic = useCallback(async (enabled) => {
    if (roomRef.current) await roomRef.current.localParticipant.setMicrophoneEnabled(enabled);
  }, []);

  const toggleCamera = useCallback(async (enabled, ...videoEls) => {
    if (!roomRef.current) return;
    const Track = await loadTrack();
    await roomRef.current.localParticipant.setCameraEnabled(enabled);
    const pub = roomRef.current.localParticipant.getTrackPublication(Track.Source.Camera);
    const els = videoEls.filter(Boolean);

    if (enabled && pub?.track) {
      els.forEach((el) => pub.track.attach(el));
    } else if (!enabled && pub?.track) {
      els.forEach((el) => {
        try { pub.track.detach(el); } catch (_) {}
      });
    }
  }, []);

  const disconnect = useCallback(async () => {
    if (roomRef.current) {
      await roomRef.current.disconnect();
      roomRef.current = null;
    }
  }, []);

  return { connect, toggleMic, toggleCamera, disconnect, roomRef };
}
