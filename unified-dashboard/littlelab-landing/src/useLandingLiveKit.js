import { useCallback, useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track } from 'livekit-client';
import { fetchLiveKitToken, landingLiveKitIdentity, landingTryRoomName, publishVisionCaptureEvent } from './landingLiveKitApi';

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
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const roomRef = useRef(null);
  const previewStreamRef = useRef(null);
  const intentionalLeaveRef = useRef(false);
  const connectAbortRef = useRef(null);
  const recoveringCameraRef = useRef(false);
  const desiredCameraOnRef = useRef(false);

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

  const hasActiveLocalCameraTrack = useCallback((room) => {
    const pub = room?.localParticipant?.getTrackPublication(Track.Source.Camera);
    const mediaTrack = pub?.track?.mediaStreamTrack;
    return !!(pub?.track && !pub.isMuted && mediaTrack && mediaTrack.readyState === 'live');
  }, []);

  const hasLivePreviewTrack = useCallback(() => {
    const stream = previewStreamRef.current;
    if (!stream || typeof stream.getVideoTracks !== 'function') return false;
    return stream.getVideoTracks().some((t) => t && t.readyState === 'live' && t.enabled !== false);
  }, []);

  const hasRenderableLocalVideo = useCallback(() => {
    const el = localVideoRef?.current;
    const stream = el?.srcObject;
    if (!stream || typeof stream.getVideoTracks !== 'function') return false;
    return stream.getVideoTracks().some((t) => t && t.readyState === 'live' && t.enabled !== false);
  }, [localVideoRef]);

  const recoverPreviewCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) return false;
    try {
      const next = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true
      });
      const prev = previewStreamRef.current;
      if (prev) {
        try { prev.getTracks().forEach((t) => t.stop()); } catch (_) {}
      }
      previewStreamRef.current = next;
      const el = localVideoRef?.current;
      if (el) {
        el.srcObject = next;
        el.muted = true;
        if (typeof el.play === 'function') {
          el.play().catch(() => {});
        }
      }
      return true;
    } catch (_) {
      return false;
    }
  }, [localVideoRef]);

  const ensureLocalCameraAttached = useCallback(
    async (room, reason = 'sync') => {
      if (!room) return;
      if (!desiredCameraOnRef.current) return;
      if (hasActiveLocalCameraTrack(room)) {
        attachLocalVideo(room);
        setCameraEnabled(true);
        return;
      }
      if (recoveringCameraRef.current) return;
      recoveringCameraRef.current = true;
      try {
        await room.localParticipant.setCameraEnabled(true);
        attachLocalVideo(room);
        setCameraEnabled(true);
      } catch (e) {
        if (/Permission|denied|NotAllowed|NotReadable|in use|busy/i.test(String(e?.message || ''))) {
          setPermissionHint('Camera feed dropped. Re-enable camera permissions, then tap Start camera.');
        } else if (reason === 'watchdog') {
          setPermissionHint('Camera feed dropped. Tap Start camera to resume.');
        }
      } finally {
        recoveringCameraRef.current = false;
      }
    },
    [attachLocalVideo, hasActiveLocalCameraTrack]
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
          if (intentionalLeaveRef.current) {
            if (v) v.srcObject = null;
            intentionalLeaveRef.current = false;
            setPhase('idle');
            setErrorMessage('');
            setPermissionHint('');
            return;
          }
          const previewStream = previewStreamRef.current;
          const previewLive = hasLivePreviewTrack();
          if (v) {
            if (previewLive && previewStream) {
              v.srcObject = previewStream;
              v.muted = true;
            } else {
              v.srcObject = null;
            }
          }
          if (!previewLive) {
            setEntryStep('invite');
          }
          setPhase('failed');
          setErrorMessage('Live video disconnected.');
        });

        room.on(RoomEvent.LocalTrackPublished, (pub) => {
          if (pub.track?.kind !== Track.Kind.Video) return;
          attachLocalVideo(room);
          desiredCameraOnRef.current = true;
          setCameraEnabled(true);
          setPermissionHint('');
          const prev = previewStreamRef.current;
          if (prev) {
            prev.getTracks().forEach((t) => t.stop());
            previewStreamRef.current = null;
          }
        });
        room.on(RoomEvent.LocalTrackUnpublished, (pub) => {
          if (pub?.kind === Track.Kind.Video) {
            setCameraEnabled(false);
            if (desiredCameraOnRef.current) void ensureLocalCameraAttached(room, 'local-track-unpublished');
          }
        });
        room.on(RoomEvent.TrackMuted, (_pub, participant) => {
          if (participant?.isLocal) {
            setCameraEnabled(false);
            if (desiredCameraOnRef.current) void ensureLocalCameraAttached(room, 'local-track-muted');
          }
        });
        room.on(RoomEvent.TrackUnmuted, (pub, participant) => {
          if (!participant?.isLocal) return;
          if (pub?.source === Track.Source.Camera || pub?.kind === Track.Kind.Video) {
            desiredCameraOnRef.current = true;
            setCameraEnabled(true);
            attachLocalVideo(room);
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
          // Start in "camera off" mode; user explicitly enables video from UI.
          await room.localParticipant.setMicrophoneEnabled(true);
          await room.localParticipant.setCameraEnabled(!!desiredCameraOnRef.current);
          setCameraEnabled(!!desiredCameraOnRef.current);
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
        await ensureLocalCameraAttached(room, 'post-connect');

        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
        lastErr = e;
      }
    }

    setPhase('failed');
    setErrorMessage(lastErr?.message || 'Could not connect to live video.');
  }, [apiBase, getSessionId, attachLocalVideo, attachRemoteTrack, clearRemoteVideos, removeRemoteParticipantVideo, localVideoRef, ensureLocalCameraAttached]);

  const setCameraOn = useCallback(async (on) => {
    desiredCameraOnRef.current = !!on;
    const room = roomRef.current;
    if (room) {
      try {
        await room.localParticipant.setCameraEnabled(on);
        if (on) {
          // Ensure first "Video On" click actually yields a renderable track.
          await ensureLocalCameraAttached(room, 'manual-toggle');
          attachLocalVideo(room);
          const el = localVideoRef?.current;
          if (el && typeof el.play === 'function') {
            el.play().catch(() => {});
          }
          // Retry once if track publication is slightly delayed.
          if (!hasRenderableLocalVideo()) {
            window.setTimeout(() => {
              void ensureLocalCameraAttached(room, 'manual-toggle-retry');
            }, 280);
          }
          // Some mobile browsers report camera "on" but render black frames.
          // If we still cannot render shortly after retries, force a fresh preview stream.
          window.setTimeout(() => {
            if (!hasRenderableLocalVideo()) {
              void recoverPreviewCamera().then((ok) => {
                if (ok) setPermissionHint('Camera recovered from black frame. Continuing with refreshed preview.');
              });
            }
          }, 900);
          setCameraEnabled(true);
        } else {
          setCameraEnabled(false);
        }
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
    let s = previewStreamRef.current;
    if (s) {
      s.getVideoTracks().forEach((t) => {
        t.enabled = on;
      });
      const el = localVideoRef?.current;
      if (on && el && typeof el.play === 'function') {
        el.play().catch(() => {});
      }
      if (on && !hasRenderableLocalVideo()) {
        const recovered = await recoverPreviewCamera();
        if (recovered) {
          s = previewStreamRef.current;
          if (s) s.getVideoTracks().forEach((t) => { t.enabled = true; });
        }
      }
      setCameraEnabled(on);
    } else {
      if (on) {
        const recovered = await recoverPreviewCamera();
        if (recovered) {
          setCameraEnabled(true);
          return;
        }
      }
      setPermissionHint('No camera preview stream available yet. Tap Video On again in a moment.');
    }
  }, [attachLocalVideo, ensureLocalCameraAttached, hasRenderableLocalVideo, localVideoRef, recoverPreviewCamera]);

  const beginTryNow = useCallback(async () => {
    desiredCameraOnRef.current = false;
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
      // Keep preview/session in a consistent initial "Video Off" state.
      stream.getVideoTracks().forEach((t) => {
        t.enabled = false;
      });
      previewStreamRef.current = stream;
      const el = localVideoRef?.current;
      if (el) {
        el.srcObject = stream;
        el.muted = true;
      }
      setEntryStep('session');
      setCameraEnabled(false);
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
      desiredCameraOnRef.current = false;
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
    if (phase !== 'connected') return;
    const room = roomRef.current;
    if (!room) return;
    const id = setInterval(() => {
      if (phase !== 'connected') return;
      const r = roomRef.current;
      if (!r) return;
      if (!desiredCameraOnRef.current) return;
      if (!hasActiveLocalCameraTrack(r) || !hasRenderableLocalVideo()) {
        void ensureLocalCameraAttached(r, 'watchdog');
      }
    }, 1800);
    return () => clearInterval(id);
  }, [phase, hasActiveLocalCameraTrack, hasRenderableLocalVideo, ensureLocalCameraAttached]);

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

  const requestCaptureNow = useCallback(async (requestedRegion = 'other') => {
    const sid = getSessionId() || '';
    if (!sid || !apiBase) return;
    try {
      await publishVisionCaptureEvent({
        apiBase,
        eventType: 'vision_capture_requested',
        actor: 'manual',
        idempotencyKey: `manual:${sid}:${requestedRegion}:${Date.now()}`,
        payload: {
          session_id: sid,
          requested_region: requestedRegion,
          reason: 'manual_capture',
          attempt_index: 1
        }
      });
    } catch (_) {}
  }, [apiBase, getSessionId]);

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
    requestCaptureNow,
    syncMicWithVoice,
    isConnected: phase === 'connected',
    inSession: entryStep === 'session' && (
      hasLivePreviewTrack() ||
      hasRenderableLocalVideo()
    )
  };
}
