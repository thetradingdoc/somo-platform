import * as THREE from 'three';
import React, { useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { RoundedBox, Text } from '@react-three/drei';
import { easing } from 'maath';

const IDLE_CARDS = [
  { code: 'J06.9', label: 'Upper respiratory infection', category: 'Diagnosis', color: '#2D6A4F' },
  { code: 'M54.5', label: 'Low back pain', category: 'Diagnosis', color: '#2D6A4F' },
  { code: '99213', label: 'Office visit, established patient', category: 'Procedure', color: '#1B4F72' },
  { code: 'R05.9', label: 'Cough, unspecified', category: 'Diagnosis', color: '#2D6A4F' },
  { code: 'Z00.00', label: 'General adult medical exam', category: 'Procedure', color: '#1B4F72' },
  { code: 'I10', label: 'Essential hypertension', category: 'Diagnosis', color: '#2D6A4F' },
  { code: '99385', label: 'Preventive medicine, 18–39 yrs', category: 'Procedure', color: '#1B4F72' },
  { code: 'E11.9', label: 'Type 2 diabetes mellitus', category: 'Diagnosis', color: '#2D6A4F' },
  { code: 'R50.9', label: 'Fever, unspecified', category: 'Diagnosis', color: '#2D6A4F' },
  { code: '93000', label: 'Electrocardiogram routine', category: 'Procedure', color: '#1B4F72' }
];

function MedCard({ position, baseRotation, cardData, active, hovered, onOver, onOut }) {
  const meshRef = useRef();
  const groupRef = useRef();

  useFrame((_, delta) => {
    if (!meshRef.current || !groupRef.current) return;

    const targetScale = hovered ? 1.2 : active ? 1.05 : 1;
    easing.damp3(meshRef.current.scale, [targetScale, targetScale, targetScale], 0.18, delta);

    const tiltX = hovered ? -0.18 : 0;
    const tiltY = hovered ? 0.2 : 0;
    easing.dampE(
      groupRef.current.rotation,
      [tiltX + baseRotation[0], tiltY + baseRotation[1], baseRotation[2]],
      0.2,
      delta
    );
  });

  const color = cardData?.color || '#333';
  const code = cardData?.code || '—';
  const label = cardData?.label || '';
  const category = cardData?.category || '';

  return (
    <group ref={groupRef} position={position} rotation={baseRotation}>
      <group
        ref={meshRef}
        onPointerOver={(e) => {
          e.stopPropagation();
          onOver?.();
        }}
        onPointerOut={() => onOut?.()}
      >
        <RoundedBox args={[1.7, 1, 0.05]} radius={0.08} smoothness={4}>
          <meshStandardMaterial color={color} roughness={0.3} metalness={0.1} />
        </RoundedBox>

        <Text
          fontSize={0.2}
          position={[0, 0.25, 0.03]}
          anchorX="center"
          color="white"
          maxWidth={1.5}
        >
          {code}
        </Text>

        <Text
          fontSize={0.085}
          position={[0, 0.02, 0.03]}
          anchorX="center"
          color="rgba(255,255,255,0.9)"
          maxWidth={1.6}
          textAlign="center"
        >
          {label.length > 70 ? `${label.slice(0, 67)}…` : label}
        </Text>

        <Text
          fontSize={0.07}
          position={[0, -0.34, 0.03]}
          anchorX="center"
          color="rgba(255,255,255,0.6)"
        >
          {category}
        </Text>
      </group>
    </group>
  );
}

function Scene({ cards }) {
  const groupRef = useRef();
  const [hovered, setHovered] = useState(null);
  const displayCards = useMemo(
    () => (cards.length > 0 ? cards : IDLE_CARDS).slice(0, 18),
    [cards]
  );

  // Precompute layered ring layout for performance
  const layout = useMemo(() => {
    if (displayCards.length === 0) return [];
    const rings = [
      { radius: 4.2, y: 0.4, speed: 0.18 },
      { radius: 5.5, y: 0, speed: 0.12 },
      { radius: 6.6, y: -0.4, speed: 0.08 }
    ];
    const perRing = Math.ceil(displayCards.length / rings.length);

    return displayCards.map((card, index) => {
      const ringIndex = Math.min(rings.length - 1, Math.floor(index / perRing));
      const ring = rings[ringIndex];
      const angle = ((index % perRing) / perRing) * Math.PI * 2;
      return { card, ringIndex, ring, angle };
    });
  }, [displayCards]);

  useFrame((state, delta) => {
    if (!groupRef.current) return;

    const t = state.clock.getElapsedTime();
    const orbitSpeed = 0.12;

    groupRef.current.children.forEach((child, index) => {
      const layoutEntry = layout[index];
      if (!layoutEntry) return;
      const { ring, angle } = layoutEntry;
      const a = angle + t * ring.speed * orbitSpeed;
      const bob = Math.sin(t * 1.4 + angle * 2) * 0.25;

      const x = Math.sin(a) * ring.radius;
      const z = Math.cos(a) * ring.radius;
      const y = ring.y + bob;

      easing.damp3(child.position, [x, y, z], 0.22, delta);
    });

    easing.damp3(
      state.camera.position,
      [-state.pointer.x * 1.4, 3.8 + state.pointer.y * 0.8, 10.2],
      0.35,
      delta
    );
    state.camera.lookAt(0, 0, 0);
  });

  return (
    <group ref={groupRef} position={[0, 0.8, 0]}>
      {layout.map(({ card }, i) => {
        return (
          <MedCard
            key={card.id || card.code || i}
            cardData={card}
            position={[0, 0, 0]}
            baseRotation={[0, 0, 0]}
            active={hovered !== null}
            hovered={hovered === i}
            onOver={() => setHovered(i)}
            onOut={() => setHovered(null)}
          />
        );
      })}
    </group>
  );
}

export function App({ cards }) {
  return (
    <Canvas
      dpr={[1, 1.5]}
      camera={{ position: [0, 4, 10], fov: 50 }}
      gl={{ antialias: true }}
    >
      <color attach="background" args={['#ffffff']} />
      <fog attach="fog" args={['#ffffff', 18, 30]} />

      <ambientLight intensity={0.55} />
      <directionalLight
        position={[6, 10, 6]}
        intensity={1.1}
        color="#ffffff"
        castShadow
      />
      <directionalLight position={[-6, 5, -4]} intensity={0.4} color="#c4d4ff" />
      <spotLight
        position={[0, 12, 4]}
        intensity={0.45}
        angle={0.8}
        penumbra={0.4}
        color="#f5e0c3"
      />
      <Scene cards={cards} />
    </Canvas>
  );
}

