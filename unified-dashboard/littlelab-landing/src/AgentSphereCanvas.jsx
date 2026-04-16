import React, { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { MagicPlasmaScene } from './MagicPlasmaSphere';

function detectWebglSupport() {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const gl =
      canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: true }) ||
      canvas.getContext('webgl', { failIfMajorPerformanceCaveat: true }) ||
      canvas.getContext('experimental-webgl', { failIfMajorPerformanceCaveat: true });
    return !!gl;
  } catch (_) {
    return false;
  }
}

/**
 * Shared WebGL agent sphere — hero (voice) or compact (chat) via className.
 * When `paused`, skip useFrame-driven work inside MagicPlasmaScene (batch 5).
 */
export default function AgentSphereCanvas({ speechLevelRef, prefersReducedMotion, className, paused = false }) {
  const hasWebgl = useMemo(() => detectWebglSupport(), []);
  const useCanvas = !prefersReducedMotion && hasWebgl;
  return (
    <div className={className || ''} aria-hidden="true">
      {useCanvas ? (
        <Canvas
          className="axv-canvas"
          camera={{ position: [0, 0, 1.52], fov: 75, near: 0.1, far: 100 }}
          gl={{ alpha: true, antialias: true, premultipliedAlpha: false }}
          dpr={[1, 2]}
          onCreated={({ gl }) => {
            gl.setPixelRatio(Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, 2));
            gl.setClearColor(0x000000, 0);
            const canvas = gl.domElement;
            canvas.addEventListener(
              'webglcontextlost',
              (e) => {
                e.preventDefault();
              },
              false
            );
            canvas.addEventListener(
              'webglcontextrestored',
              () => {
                try {
                  gl.setPixelRatio(Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, 2));
                  gl.setClearColor(0x000000, 0);
                } catch (_) {}
              },
              false
            );
          }}
        >
          <MagicPlasmaScene speechLevelRef={speechLevelRef} paused={paused} />
        </Canvas>
      ) : (
        <div className="axv-sphere-fallback" />
      )}
    </div>
  );
}
