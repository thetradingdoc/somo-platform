import React from 'react';
import { Canvas } from '@react-three/fiber';
import { MagicPlasmaScene } from './MagicPlasmaSphere';

/**
 * Shared WebGL agent sphere — hero (voice) or compact (chat) via className.
 * When `paused`, skip useFrame-driven work inside MagicPlasmaScene (batch 5).
 */
export default function AgentSphereCanvas({ speechLevelRef, prefersReducedMotion, className, paused = false }) {
  return (
    <div className={className || ''} aria-hidden="true">
      {!prefersReducedMotion ? (
        <Canvas
          className="axv-canvas"
          camera={{ position: [0, 0, 1.52], fov: 75, near: 0.1, far: 100 }}
          gl={{ alpha: true, antialias: true, premultipliedAlpha: false }}
          dpr={[1, 2]}
          onCreated={({ gl }) => {
            gl.setPixelRatio(Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, 2));
            gl.setClearColor(0x000000, 0);
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
