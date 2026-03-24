import * as THREE from 'three';
import React, { useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { RoundedBox, Text } from '@react-three/drei';
import { easing } from 'maath';

const IDLE_CARDS = [
  {
    code: 'J06.9',
    label: 'Upper respiratory infection',
    category: 'Diagnosis',
    type: 'Diagnosis',
    urgency: 'Important',
    relevance: 0.81,
    summary: 'Upper respiratory infection affects the nose or throat and is often viral.',
    nextStep: 'Book a same-week primary care visit if symptoms persist.',
    related: ['R05.9', 'R50.9'],
    color: '#c7904e'
  },
  {
    code: '99213',
    label: 'Office visit, established patient',
    category: 'Procedure',
    type: 'Procedure',
    urgency: 'Routine',
    relevance: 0.72,
    summary: 'Standard outpatient follow-up visit for an established patient.',
    nextStep: 'Choose a slot and continue to patient checkout.',
    related: ['Z00.00', '99385'],
    color: '#5d84c4'
  },
  {
    code: 'R05.9',
    label: 'Cough, unspecified',
    category: 'Symptom',
    type: 'Symptom',
    urgency: 'Routine',
    relevance: 0.66,
    summary: 'A non-specific cough symptom that requires context for diagnosis.',
    nextStep: 'Track onset, triggers, and severity for triage.',
    related: ['J06.9', 'R50.9'],
    color: '#7a62b1'
  },
  {
    code: '93000',
    label: 'Electrocardiogram routine',
    category: 'Lab',
    type: 'Lab',
    urgency: 'Important',
    relevance: 0.76,
    summary: 'Routine ECG procedure used to evaluate cardiac rhythm.',
    nextStep: 'Check if clinician requests this before your visit.',
    related: ['I10', 'R07.9'],
    color: '#5ea8b5'
  },
  {
    code: 'E11.9',
    label: 'Type 2 diabetes mellitus',
    category: 'Diagnosis',
    type: 'Diagnosis',
    urgency: 'Important',
    relevance: 0.84,
    summary: 'Chronic glucose disorder requiring longitudinal management.',
    nextStep: 'Schedule care plan follow-up and lab monitoring.',
    related: ['Z00.00', 'I10'],
    color: '#c7904e'
  },
  {
    code: 'Z00.00',
    label: 'General adult medical exam',
    category: 'Procedure',
    type: 'Procedure',
    urgency: 'Routine',
    relevance: 0.63,
    summary: 'Comprehensive preventive wellness exam.',
    nextStep: 'Book with primary care and complete pre-visit intake.',
    related: ['99385', '99213'],
    color: '#5d84c4'
  }
];

function MedCard({
  position,
  baseRotation,
  cardData,
  active,
  hovered,
  selected,
  flipped,
  dimmed,
  onOver,
  onOut,
  onClick,
  onFlip,
  isTouchDevice
}) {
  const meshRef = useRef();
  const groupRef = useRef();

  useFrame((_, delta) => {
    if (!meshRef.current || !groupRef.current) return;

    const targetScale = selected ? 1.2 : hovered ? 1.08 : active ? 1.01 : 1;
    easing.damp3(meshRef.current.scale, [targetScale, targetScale, targetScale], 0.18, delta);

    const tiltX = selected ? -0.04 : hovered ? -0.08 : 0;
    const tiltY = selected ? 0.06 : hovered ? 0.08 : 0;
    easing.dampE(
      groupRef.current.rotation,
      [tiltX + baseRotation[0], tiltY + baseRotation[1], baseRotation[2]],
      0.2,
      delta
    );
  });

  const color = cardData?.color || '#333';
  const fillColor = useMemo(() => {
    const base = new THREE.Color(color);
    if (!dimmed) return base;
    return base.lerp(new THREE.Color('#0f172a'), 0.18);
  }, [color, dimmed]);
  const code = cardData?.code || '—';
  const label = cardData?.label || 'Untitled concept';
  const category = cardData?.category || cardData?.type || 'Medical';
  const urgency = cardData?.urgency || 'Routine';
  const relevance = Math.round((Number(cardData?.relevance) || 0.5) * 100);
  const summary = cardData?.summary || `${label} has no summary available yet.`;
  const nextStep = cardData?.nextStep || 'Review with a clinician for the next step.';
  const related = Array.isArray(cardData?.related) && cardData.related.length
    ? cardData.related.slice(0, 2).join(' • ')
    : 'No related concepts';

  return (
    <group ref={groupRef} position={position} rotation={baseRotation}>
      <group
        ref={meshRef}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = 'pointer';
          onOver?.();
        }}
        onPointerOut={() => {
          document.body.style.cursor = 'default';
          onOut?.();
        }}
        onClick={(e) => {
          e.stopPropagation();
          onClick?.(cardData);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onFlip?.(cardData);
        }}
      >
        {!flipped ? (
          <group>
            <RoundedBox args={[2.24, 1.34, 0.08]} radius={0.1} smoothness={6}>
              <meshStandardMaterial
                color={fillColor}
                roughness={0.34}
                metalness={0.02}
                emissive="#000000"
                emissiveIntensity={0}
              />
            </RoundedBox>

            <Text fontSize={0.078} position={[-0.82, 0.53, 0.05]} anchorX="left" color="#ffffff" outlineWidth={0.005} outlineColor="#0f172a">
              {category}
            </Text>
            <Text fontSize={0.078} position={[0.84, 0.53, 0.05]} anchorX="right" color="#ffffff" outlineWidth={0.005} outlineColor="#0f172a">
              {urgency}
            </Text>
            <Text fontSize={0.3} position={[0, 0.18, 0.05]} anchorX="center" color="#ffffff" maxWidth={1.9} outlineWidth={0.008} outlineColor="#0f172a">
              {code}
            </Text>
            <Text fontSize={0.095} position={[0, -0.08, 0.05]} anchorX="center" color="#ffffff" maxWidth={1.9} textAlign="center" outlineWidth={0.004} outlineColor="#0f172a">
              {label.length > 56 ? `${label.slice(0, 53)}…` : label}
            </Text>
            <Text fontSize={0.078} position={[0, -0.32, 0.05]} anchorX="center" color="rgba(255,255,255,0.92)" outlineWidth={0.003} outlineColor="#0f172a">
              Relevance {relevance}%
            </Text>
            <Text fontSize={0.07} position={[0, -0.5, 0.05]} anchorX="center" color="rgba(255,255,255,0.9)" outlineWidth={0.003} outlineColor="#0f172a">
              {isTouchDevice ? 'Tap to select • Tap again to flip' : 'Click to select • Double-click to flip'}
            </Text>
          </group>
        ) : (
          <group>
            <RoundedBox args={[2.24, 1.34, 0.08]} radius={0.1} smoothness={6}>
              <meshStandardMaterial
                color="#f8fafc"
                roughness={0.3}
                metalness={0.02}
                emissive="#000000"
                emissiveIntensity={0}
              />
            </RoundedBox>
            <Text fontSize={0.082} position={[-0.88, 0.53, 0.05]} anchorX="left" color="#334155">
              Summary
            </Text>
            <Text fontSize={0.08} position={[0, 0.28, 0.05]} anchorX="center" color="#0f172a" maxWidth={2} textAlign="center">
              {summary.length > 96 ? `${summary.slice(0, 93)}…` : summary}
            </Text>
            <Text fontSize={0.075} position={[0, -0.03, 0.05]} anchorX="center" color="#334155" maxWidth={2} textAlign="center">
              Next: {nextStep.length > 68 ? `${nextStep.slice(0, 65)}…` : nextStep}
            </Text>
            <Text fontSize={0.072} position={[0, -0.34, 0.05]} anchorX="center" color="#475569" maxWidth={2} textAlign="center">
              Related: {related}
            </Text>
            <Text fontSize={0.07} position={[0, -0.53, 0.05]} anchorX="center" color="#0f172a">
              {isTouchDevice ? 'Tap again to flip back' : 'Double-click to flip back'}
            </Text>
          </group>
        )}
      </group>
    </group>
  );
}

function Scene({ cards, selectedCardId, flippedCardId, onCardSelect, onCardFlip }) {
  const groupRef = useRef();
  const [hovered, setHovered] = useState(null);
  const isTouchDevice = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches,
    []
  );
  const displayCards = useMemo(
    () => (cards.length > 0 ? cards : IDLE_CARDS).slice(0, 10),
    [cards]
  );

  // Precompute layered ring layout for performance
  const layout = useMemo(() => {
    if (displayCards.length === 0) return [];
    const rings = [
      { radius: 4.2, y: 0.35, speed: 0.13 },
      { radius: 5.5, y: -0.12, speed: 0.09 }
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
    const orbitSpeed = 0.04;
    const selectedIndex = selectedCardId == null
      ? -1
      : layout.findIndex((entry) => entry?.card?.id === selectedCardId || entry?.card?.code === selectedCardId);

    groupRef.current.children.forEach((child, index) => {
      const layoutEntry = layout[index];
      if (!layoutEntry) return;
      const { ring, angle } = layoutEntry;
      const focused = index === hovered || index === selectedIndex;
      const spinOffset = selectedCardId != null ? 0 : (focused ? 0 : t * ring.speed * orbitSpeed);
      const a = angle + spinOffset;
      const bob = selectedCardId != null ? 0 : (focused ? 0 : Math.sin(t * 1.1 + angle * 2) * 0.06);

      const x = focused ? 0 : Math.sin(a) * ring.radius;
      const z = focused ? 2.1 : Math.cos(a) * ring.radius;
      const y = focused ? 0.4 : ring.y + bob;

      easing.damp3(child.position, [x, y, z], 0.22, delta);
    });

    easing.damp3(
      state.camera.position,
      [-state.pointer.x * 0.48, 3.65 + state.pointer.y * 0.26, 9.6],
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
            selected={(card.id || card.code) === selectedCardId}
            flipped={(card.id || card.code) === flippedCardId}
            dimmed={selectedCardId != null && (card.id || card.code) !== selectedCardId}
            onOver={() => setHovered(i)}
            onOut={() => setHovered(null)}
            onClick={onCardSelect}
            onFlip={onCardFlip}
            isTouchDevice={isTouchDevice}
          />
        );
      })}
    </group>
  );
}

export function App({ cards, selectedCardId, flippedCardId, onCardSelect, onCardFlip }) {
  return (
    <Canvas
      dpr={[1, 1.35]}
      camera={{ position: [0, 3.65, 9.6], fov: 45 }}
      gl={{ antialias: true }}
      onPointerMissed={() => onCardSelect?.(null)}
    >
      <color attach="background" args={['#ffffff']} />
      <fog attach="fog" args={['#ffffff', 15, 25]} />

      <ambientLight intensity={0.62} />
      <directionalLight
        position={[6, 10, 6]}
        intensity={1.18}
        color="#ffffff"
      />
      <directionalLight position={[-6, 5, -4]} intensity={0.46} color="#e2e8f0" />
      <spotLight
        position={[0, 12, 4]}
        intensity={0.5}
        angle={0.8}
        penumbra={0.4}
        color="#fff7ed"
      />
      <Scene
        cards={cards}
        selectedCardId={selectedCardId}
        flippedCardId={flippedCardId}
        onCardSelect={onCardSelect}
        onCardFlip={onCardFlip}
      />
    </Canvas>
  );
}

