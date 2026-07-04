import { useEffect, useRef } from 'react';

const SPHERE_SIZE = 352;
const PARTICLE_COUNT = 1000;
const RING_COUNT = 40;
const DEFAULT_COLORS = ['#b5e930', '#9fd628', '#238108', '#164437', '#d4ed6a', '#1f5a47'];

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function readPalette(host) {
  if (typeof window === 'undefined' || !host) return DEFAULT_COLORS;
  const s = getComputedStyle(host);
  const lizard = s.getPropertyValue('--somo-lizard').trim();
  const hover = s.getPropertyValue('--somo-lizard-hover').trim();
  const grass = s.getPropertyValue('--somo-grass').trim();
  const msu = s.getPropertyValue('--somo-msu').trim();
  const colors = [lizard, hover, grass, msu, '#d4ed6a', '#1f5a47'].filter((c) => /^#[0-9a-f]{3,8}$/i.test(c));
  return colors.length >= 4 ? colors : DEFAULT_COLORS;
}

/**
 * Three.js particle sphere — Image 1 palette, voice-agent motion.
 * @param {{ impulseToken?: number|string, agentState?: 'idle'|'loading'|'success'|'error', className?: string }} props
 */
export default function ParticleSphere({
  impulseToken = 0,
  agentState = 'idle',
  className = ''
}) {
  const hostRef = useRef(null);
  const cleanupRef = useRef(null);
  const agentStateRef = useRef(agentState);
  const reduced = useRef(prefersReducedMotion());

  useEffect(() => {
    agentStateRef.current = agentState;
    const host = hostRef.current;
    if (!host) return;

    if (agentState === 'success') host._triggerSuccessPulse?.();
    if (agentState === 'error') host._triggerErrorFlash?.();
  }, [agentState]);

  useEffect(() => {
    if (reduced.current || !hostRef.current) return;

    let destroyed = false;
    const host = hostRef.current;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || cleanupRef.current) return;
        observer.disconnect();
        initSphere();
      },
      { rootMargin: '100px' }
    );
    observer.observe(host);

    async function initSphere() {
      const THREE = await import('three');
      if (destroyed || !host) return;

      const palette = readPalette(host);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
      camera.position.z = 3.2;

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(SPHERE_SIZE, SPHERE_SIZE);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      host.appendChild(renderer.domElement);

      const positions = new Float32Array(PARTICLE_COUNT * 3);
      const colors = new Float32Array(PARTICLE_COUNT * 3);
      const baseColors = new Float32Array(PARTICLE_COUNT * 3);
      const velocities = [];
      const errorTint = new Array(PARTICLE_COUNT).fill(false);

      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const phi = Math.acos(2 * Math.random() - 1);
        const theta = 2 * Math.PI * Math.random();
        const r = 1;
        positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        positions[i * 3 + 2] = r * Math.cos(phi);

        const hex = palette[Math.floor(Math.random() * palette.length)];
        const c = new THREE.Color(hex);
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
        baseColors[i * 3] = c.r;
        baseColors[i * 3 + 1] = c.g;
        baseColors[i * 3 + 2] = c.b;

        if (Math.random() < 0.15) errorTint[i] = true;

        velocities.push({
          x: (Math.random() - 0.5) * 0.002,
          y: (Math.random() - 0.5) * 0.002,
          z: (Math.random() - 0.5) * 0.002
        });
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

      const baseMaterialSize = 0.035;
      const material = new THREE.PointsMaterial({
        size: baseMaterialSize,
        vertexColors: true,
        transparent: true,
        opacity: 0.88,
        sizeAttenuation: true
      });

      const points = new THREE.Points(geometry, material);
      scene.add(points);

      const ringPositions = new Float32Array(RING_COUNT * 3);
      const ringColors = new Float32Array(RING_COUNT * 3);
      const ringBaseY = new Float32Array(RING_COUNT);
      for (let i = 0; i < RING_COUNT; i++) {
        const angle = (i / RING_COUNT) * Math.PI * 2;
        const r = 1.15;
        ringPositions[i * 3] = Math.cos(angle) * r;
        ringPositions[i * 3 + 1] = 0;
        ringPositions[i * 3 + 2] = Math.sin(angle) * r;
        ringBaseY[i] = ringPositions[i * 3 + 1];
        const c = new THREE.Color(palette[0]);
        ringColors[i * 3] = c.r;
        ringColors[i * 3 + 1] = c.g;
        ringColors[i * 3 + 2] = c.b;
      }
      const ringGeometry = new THREE.BufferGeometry();
      ringGeometry.setAttribute('position', new THREE.BufferAttribute(ringPositions, 3));
      ringGeometry.setAttribute('color', new THREE.BufferAttribute(ringColors, 3));
      const ringMaterial = new THREE.PointsMaterial({
        size: 0.02,
        vertexColors: true,
        transparent: true,
        opacity: 0.45,
        sizeAttenuation: true
      });
      const ringPoints = new THREE.Points(ringGeometry, ringMaterial);
      ringPoints.visible = false;
      scene.add(ringPoints);

      let burstUntil = 0;
      let errorFlashUntil = 0;
      let lastSuccessPulse = 0;
      let frameId;
      let pointerX = 0;
      let pointerY = 0;
      let rotX = 0;
      let rotY = 0;
      let targetRotX = 0;
      let targetRotY = 0;
      let autoRotY = 0;

      const onPointerMove = (e) => {
        const rect = host.getBoundingClientRect();
        pointerX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointerY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
        targetRotY = pointerX * 0.35;
        targetRotX = pointerY * 0.28;
      };

      const onPointerLeave = () => {
        targetRotX = 0;
        targetRotY = 0;
      };

      host.addEventListener('pointermove', onPointerMove);
      host.addEventListener('pointerleave', onPointerLeave);

      const animate = (time) => {
        if (destroyed) return;
        frameId = requestAnimationFrame(animate);

        const state = agentStateRef.current;
        const spin =
          state === 'loading' ? 0.008 : state === 'success' ? 0.005 : 0.003;
        const targetRadius = state === 'loading' ? 0.92 : 1;
        const pullStrength = state === 'loading' ? 0.055 : 0.04;

        rotX += (targetRotX - rotX) * 0.06;
        rotY += (targetRotY - rotY) * 0.06;
        autoRotY += spin;
        points.rotation.x = rotX + Math.sin(time * 0.0004) * 0.02;
        points.rotation.y = autoRotY + rotY;

        const breath = 1 + Math.sin(time * 0.0015) * 0.08;
        material.size = baseMaterialSize * breath * (state === 'success' ? 1.05 : 1);

        ringPoints.visible = state === 'success';
        if (state === 'success') {
          ringPoints.rotation.y = points.rotation.y;
          const ringPos = ringGeometry.attributes.position.array;
          for (let i = 0; i < RING_COUNT; i++) {
            const wave = Math.sin(time * 0.008 + i * 0.4) * 0.06;
            ringPos[i * 3 + 1] = ringBaseY[i] + wave;
          }
          ringGeometry.attributes.position.needsUpdate = true;
          if (time - lastSuccessPulse > 1200) {
            lastSuccessPulse = time;
            burstUntil = time + 500;
          }
        }

        const pos = geometry.attributes.position.array;
        const col = geometry.attributes.color.array;
        const burst = time < burstUntil;
        const errorFlash = time < errorFlashUntil;

        if (errorFlash) {
          const red = new THREE.Color('#ef4444');
          for (let i = 0; i < PARTICLE_COUNT; i++) {
            if (!errorTint[i]) continue;
            const ix = i * 3;
            col[ix] = red.r;
            col[ix + 1] = red.g;
            col[ix + 2] = red.b;
          }
          geometry.attributes.color.needsUpdate = true;
        } else {
          for (let i = 0; i < PARTICLE_COUNT; i++) {
            const ix = i * 3;
            col[ix] = baseColors[ix];
            col[ix + 1] = baseColors[ix + 1];
            col[ix + 2] = baseColors[ix + 2];
          }
          geometry.attributes.color.needsUpdate = true;
        }

        for (let i = 0; i < PARTICLE_COUNT; i++) {
          const ix = i * 3;
          if (burst) {
            pos[ix] += velocities[i].x * 8;
            pos[ix + 1] += velocities[i].y * 8;
            pos[ix + 2] += velocities[i].z * 8;
          }

          const x = pos[ix];
          const y = pos[ix + 1];
          const z = pos[ix + 2];
          const len = Math.sqrt(x * x + y * y + z * z) || 1;
          const pull = burst ? 0.02 : pullStrength;
          pos[ix] += (x / len) * (targetRadius - len) * pull;
          pos[ix + 1] += (y / len) * (targetRadius - len) * pull;
          pos[ix + 2] += (z / len) * (targetRadius - len) * pull;
        }
        geometry.attributes.position.needsUpdate = true;

        renderer.render(scene, camera);
      };

      frameId = requestAnimationFrame(animate);

      host._triggerBurst = () => {
        burstUntil = performance.now() + 600;
      };

      host._triggerSuccessPulse = () => {
        burstUntil = performance.now() + 700;
        lastSuccessPulse = performance.now();
      };

      host._triggerErrorFlash = () => {
        errorFlashUntil = performance.now() + 400;
      };

      cleanupRef.current = () => {
        cancelAnimationFrame(frameId);
        host.removeEventListener('pointermove', onPointerMove);
        host.removeEventListener('pointerleave', onPointerLeave);
        geometry.dispose();
        material.dispose();
        ringGeometry.dispose();
        ringMaterial.dispose();
        renderer.dispose();
        if (renderer.domElement.parentNode) {
          renderer.domElement.parentNode.removeChild(renderer.domElement);
        }
      };
    }

    return () => {
      destroyed = true;
      observer.disconnect();
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (reduced.current || impulseToken === 0) return;
    hostRef.current?._triggerBurst?.();
  }, [impulseToken]);

  if (reduced.current) {
    return (
      <div
        className={`dc-sphere-wrap dc-sphere-static ${className}`.trim()}
        aria-hidden="true"
      />
    );
  }

  return (
    <div className={`dc-sphere-wrap ${className}`.trim()}>
      <div ref={hostRef} className="dc-sphere-host" aria-hidden="true" />
    </div>
  );
}
