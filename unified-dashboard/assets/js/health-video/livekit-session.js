/**
 * LiveKit session helper for consumer health video.
 */
export async function connectLiveKit({ url, token, videoEl, onStatus }) {
  const { Room, RoomEvent, Track } = await import('https://cdn.jsdelivr.net/npm/livekit-client@2.9.0/+esm');
  const room = new Room({ adaptiveStream: true, dynacast: true });

  room.on(RoomEvent.Connected, async () => {
    onStatus?.('connected');
    await room.localParticipant.setCameraEnabled(true);
    await room.localParticipant.setMicrophoneEnabled(true);
    const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
    if (pub?.track && videoEl) pub.track.attach(videoEl);
  });
  room.on(RoomEvent.Disconnected, () => onStatus?.('disconnected'));
  room.on(RoomEvent.Reconnecting, () => onStatus?.('reconnecting'));
  room.on(RoomEvent.Reconnected, () => onStatus?.('connected'));

  await room.connect(url, token);
  return room;
}

export async function toggleMic(room, enabled) {
  if (!room) return;
  await room.localParticipant.setMicrophoneEnabled(enabled);
}

export async function toggleCamera(room, enabled) {
  if (!room) return;
  await room.localParticipant.setCameraEnabled(enabled);
}

export async function disconnectRoom(room) {
  if (room) await room.disconnect();
}
