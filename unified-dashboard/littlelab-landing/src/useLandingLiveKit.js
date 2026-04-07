import { useCallback, useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track } from 'livekit-client';
import { fetchLiveKitToken, landingLiveKitIdentity, landingTryRoomName } from './landingLiveKitApi';

function safeDomId(s) {
  return String(s || 'p').replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Landing Try-now LiveKit: token, connect/reconnect UI phases, local/remote video, mic sync hook.
 * @param {{ apiBase: string, getSessionId: () => string, localVideoRef: React.RefObject<HTMLVideoElement|null>, remoteVideoContainerRef?: React.RefObject<HTMLElement|null>, assistantPage?: string }} opts
 */
export function useLandingLiveKit({ apiBase, getSessionId, localVideoRef, remoteVideoContainerRef, assistantPage }) {
  const [phase, setPhase] = useState('idle');
  /** 'invite' = pre-camera gate; 'session' = user in full-screen preview or LiveKit */
  const [entryStep, setEntryStep] = useState('invite');
  const [errorMessage, setErrorMessage] = useState('');
  const [permissionHint, setPermissionHint] = useState('');
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const roomRef = useRef(null);
  const previewStreamRef = useRef(null);
  const intentionalLeaveRef = useRef(false);
  const connectAbortRef = useRef(null);

  const attachLocalVideo = useCallback(
    (room) => {
      const el = localVideoRef?.current;
      if (!el || !room) return;
      const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
      if (pub?.track) {
        pub.track.attach(el);
      }
    },
    [localVideoRef]
  );

  const clearRemoteVideos = useCallback(() => {
    const c = remoteVideoContainerRef?.current;
    if (c) c.innerHTML = '';
  }, [remoteVideoContainerRef]);

  const attachRemoteTrack = useCallback(
    (track, participant) => {
      const c = remoteVideoContainerRef?.current;
      if (!c || track.kind !== Track.Kind.Video) return;
      const id = `lk-remote-${safeDomId(participant.identity)}`;
      let wrap = c.querySelector(`#${id}`);
      if (!wrap) {
        wrap = document.createElement('div');
        wrap.className = 'ax-lk-remote-tile';
        wrap.id = id;
        const vid = document.createElement('video');
        vid.setAttribute('playsinline', '');
        vid.setAttribute('autoplay', '');
        vid.title = participant.name || participant.identity;
        const label = document.createElement('span');
        label.className = 'ax-lk-remote-label';
        label.textContent = participant.name || participant.identity;
        wrap.appendChild(vid);
        wrap.appendChild(label);
        c.appendChild(wrap);
      }
      const videoEl = wrap.querySelector('video');
      if (videoEl) {
        track.attach(videoEl);
        videoEl.play().catch(() => {});
      }
    },
    [remoteVideoContainerRef]
  );

  const removeRemoteParticipantVideo = useCallback(
    (identity) => {
      const c = remoteVideoContainerRef?.current;
      if (!c) return;
      const el = c.querySelector(`#lk-remote-${safeDomId(identity)}`);
      if (el) el.remove();
    },
    [remoteVideoContainerRef]
  );

  const leaveRoom = useCallback(() => {
    connectAbortRef.current?.abort();
    connectAbortRef.current = null;
    intentionalLeaveRef.current = true;
    const r = roomRef.current;
    const el = localVideoRef?.current;
    if (r && el) {
      const pub = r.localParticipant.getTrackPublication(Track.Source.Camera);
      try {
        pub?.track?.detach(el);
      } catch (_) {}
    }
    if (el) el.srcObject = null;
    const ps = previewStreamRef.current;
    if (ps) {
      ps.getTracks().forEach((t) => t.stop());
      previewStreamRef.current = null;
    }
    setPermissionHint('');
    setEntryStep('invite');
    if (r) {
      try {
        r.disconnect();
      } catch (_) {}
    } else {
      roomRef.current = null;
      clearRemoteVideos();
      intentionalLeaveRef.current = false;
      setPhase('idle');
      setErrorMessage('');
    }
  }, [clearRemoteVideos, localVideoRef]);

  const connect = useCallback(async () => {
    if (roomRef.current) return;
    if (!apiBase) {
      setPhase('failed');
      setErrorMessage('Set REACT_APP_API_BASE to connect live video.');
      return;
    }
    const sid = getSessionId() || '';
    const roomName = landingTryRoomName(sid);
    const identity = landingLiveKitIdentity(sid);

    setPhase('connecting');
    setErrorMessage('');
    setPermissionHint('');
    connectAbortRef.current?.abort();
    const ac = new AbortController();
    connectAbortRef.current = ac;

    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (ac.signal.aborted) return;
      try {
        if (attempt > 0) {
          await new Promise((r) => setTimeout(r, 500 * attempt));
        }
        const { token, url } = await fetchLiveKitToken({
          apiBase,
          room: roomName,
          identity,
          name: 'Skin & Care visitor',
          signal: ac.signal
        });
        if (ac.signal.aborted) return;

        intentionalLeaveRef.current = false;
        const room = new Room({ adaptiveStream: true, dynacast: true });

        room.on(RoomEvent.Reconnecting, () => {
          if (!intentionalLeaveRef.current) setPhase('reconnecting');
        });
        room.on(RoomEvent.Reconnected, () => setPhase('connected'));
        room.on(RoomEvent.Disconnected, () => {
          roomRef.current = null;
          clearRemoteVideos();
          const v = localVideoRef?.current;
          if (v) v.srcObject = null;
          if (intentionalLeaveRef.current) {
            intentionalLeaveRef.current = false;
            setPhase('idle');
            setErrorMessage('');
            setPermissionHint('');
            return;
          }
          setPhase('failed');
          setErrorMessage('Live video disconnected.');
        });

        room.on(RoomEvent.LocalTrackPublished, (pub) => {
          if (pub.track?.kind !== Track.Kind.Video) return;
          attachLocalVideo(room);
          const prev = previewStreamRef.current;
          if (prev) {
            prev.getTracks().forEach((t) => t.stop());
            previewStreamRef.current = null;
          }
        });

        room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
          if (participant.isLocal) return;
          attachRemoteTrack(track, participant);
        });

        room.on(RoomEvent.TrackUnsubscribed, (_track, pub, participant) => {
          if (participant.isLocal) return;
          if (pub.kind === Track.Kind.Video) removeRemoteParticipantVideo(participant.identity);
        });

        room.on(RoomEvent.ParticipantDisconnected, (participant) => {
          removeRemoteParticipantVideo(participant.identity);
        });

        await room.connect(url, token);
        if (ac.signal.aborted) {
          room.disconnect();
          return;
        }

        roomRef.current = room;
        setPhase('connected');

        try {
          await room.localParticipant.enableCameraAndMicrophone();
          setCameraEnabled(true);
        } catch (e) {
          const msg = e?.message || String(e);
          if (/Permission|denied|NotAllowed/i.test(msg)) {
            setPermissionHint('Camera or microphone access was blocked. Check browser permissions and try again.');
          } else if (/NotReadable|in use|busy/i.test(msg)) {
            setPermissionHint('Camera or microphone may be in use by another app.');
          } else {
            setPermissionHint(msg);
          }
        }
        attachLocalVideo(room);
        const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
        if (camPub?.track) {
          const prev = previewStreamRef.current;
          if (prev) {
            prev.getTracks().forEach((t) => t.stop());
            previewStreamRef.current = null;
          }
        }

        room.remoteParticipants.forEach((p) => {
          p.trackPublications.forEach((pub) => {
            if (pub.track && pub.kind === Track.Kind.Video) attachRemoteTrack(pub.track, p);
          });
        });

        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
        lastErr = e;
      }
    }

    setPhase('failed');
    setErrorMessage(lastErr?.message || 'Could not connect to live video.');
  }, [apiBase, getSessionId, attachLocalVideo, attachRemoteTrack, clearRemoteVideos, removeRemoteParticipantVideo, localVideoRef]);

  const setCameraOn = useCallback(async (on) => {
    const room = roomRef.current;
    if (room) {
      try {
        await room.localParticipant.setCameraEnabled(on);
        setCameraEnabled(on);
        if (on) attachLocalVideo(room);
      } catch (e) {
        const msg = e?.message || String(e);
        if (/Permission|denied|NotAllowed/i.test(msg)) {
          setPermissionHint('Camera access was blocked.');
        } else if (/NotReadable|in use/i.test(msg)) {
          setPermissionHint('Camera may be in use by another app.');
        } else {
          setPermissionHint(msg);
        }
      }
      return;
    }
    const s = previewStreamRef.current;
    if (s) {
      s.getVideoTracks().forEach((t) => {
        t.enabled = on;
      });
      setCameraEnabled(on);
    }
  }, [attachLocalVideo]);

  const beginTryNow = useCallback(async () => {
    setPermissionHint('');
    setErrorMessage('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setPermissionHint('Camera is not available in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true
      });
      previewStreamRef.current = stream;
      const el = localVideoRef?.current;
      if (el) {
        el.srcObject = stream;
        el.muted = true;
      }
      setEntryStep('session');
      setCameraEnabled(true);
    } catch (e) {
      const msg = e?.message || String(e);
      if (/Permission|denied|NotAllowed/i.test(msg)) {
        setPermissionHint('Camera access was blocked. Allow camera in your browser settings to continue.');
      } else if (/NotReadable|in use|busy/i.test(msg)) {
        setPermissionHint('Camera may be in use by another app.');
      } else {
        setPermissionHint(msg || 'Could not access camera.');
      }
      return;
    }
    if (apiBase) {
      await connect();
    } else {
      setPermissionHint('Preview only — set REACT_APP_API_BASE to connect a live session.');
    }
  }, [apiBase, connect, localVideoRef]);

  /** When LiveKit is connected, mirror voice UI: publish mic only while user mic is "on". */
  const syncMicWithVoice = useCallback((voiceActive) => {
    const room = roomRef.current;
    if (!room) return;
    room.localParticipant.setMicrophoneEnabled(!!voiceActive).catch(() => {});
  }, []);

  useEffect(() => {
    return () => {
      intentionalLeaveRef.current = true;
      const r = roomRef.current;
      roomRef.current = null;
      try {
        r?.disconnect();
      } catch (_) {}
      const ps = previewStreamRef.current;
      if (ps) {
        ps.getTracks().forEach((t) => t.stop());
        previewStreamRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const el = localVideoRef?.current;
    if (!el) return;
    if (phase === 'connected' && roomRef.current) {
      attachLocalVideo(roomRef.current);
      return;
    }
    const s = previewStreamRef.current;
    if (entryStep === 'session' && s) {
      el.srcObject = s;
      el.muted = true;
    }
  }, [assistantPage, phase, entryStep, attachLocalVideo, localVideoRef]);

  const retryConnect = useCallback(() => {
    void connect();
  }, [connect]);

  return {
    phase,
    entryStep,
    errorMessage,
    permissionHint,
    clearPermissionHint: () => setPermissionHint(''),
    cameraEnabled,
    connect,
    beginTryNow,
    leaveRoom,
    retryConnect,
    setCameraOn,
    syncMicWithVoice,
    isConnected: phase === 'connected',
    inSession: entryStep === 'session'
  };
}
