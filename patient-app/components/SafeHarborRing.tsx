import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import type { SafeHarborState } from '@/hooks/useUnifiedLedger';

type Props = {
  status: SafeHarborState['status'];
  ratio: number | null;
  amountToSafe?: number | null;
};

/**
 * SafeHarborRing
 * Visualizes the 95% Premium Safe Harbor status (CMS 2026 Mandate).
 */
export const SafeHarborRing: React.FC<Props> = ({ status, ratio, amountToSafe }) => {
  const size = 180;
  const strokeWidth = 12;
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;

  const effectiveRatio = typeof ratio === 'number' ? ratio : 0;
  const progress = Math.min(Math.max(effectiveRatio, 0), 1);
  const strokeDashoffset = circumference - progress * circumference;

  const colors: Record<SafeHarborState['status'] | 'unknown', string> = {
    protected: '#10B981',
    warning: '#F59E0B',
    unprotected: '#EF4444',
    unknown: '#9CA3AF'
  };

  const activeColor = colors[status] || colors.unknown;

  const percentLabel = `${Math.round(progress * 100)}%`;

  return (
    <View style={styles.container}>
      <Svg width={size} height={size}>
        <Circle
          stroke="#E5E7EB"
          fill="none"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
        />
        <Circle
          stroke={activeColor}
          fill="none"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          rotation={-90}
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>

      <View style={[StyleSheet.absoluteFill, styles.labelContainer]}>
        <Text style={styles.percentageText}>{percentLabel}</Text>
        <Text style={styles.subText}>Paid</Text>
      </View>

      <View style={styles.statusBox}>
        <Text style={[styles.statusTitle, { color: activeColor }]}>
          {status === 'protected' && '✅ Coverage Secure'}
          {status === 'warning' && '⚠️ Action Required'}
          {status === 'unprotected' && '🚨 Coverage at Risk'}
          {status === 'unknown' && 'Coverage Status Unknown'}
        </Text>
        {status === 'warning' && typeof amountToSafe === 'number' && amountToSafe > 0 && (
          <Text style={styles.nudgeText}>
            Pay <Text style={styles.nudgeAmount}>${amountToSafe.toFixed(2)}</Text> to reach 95% Safe Harbor.
          </Text>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { alignItems: 'center', marginVertical: 20 },
  labelContainer: { justifyContent: 'center', alignItems: 'center' },
  percentageText: { fontSize: 32, fontWeight: '800', color: '#111827' },
  subText: { fontSize: 14, color: '#6B7280', textTransform: 'uppercase' },
  statusBox: { marginTop: 15, alignItems: 'center' },
  statusTitle: { fontSize: 18, fontWeight: '700' },
  nudgeText: { fontSize: 14, color: '#4B5563', marginTop: 4, textAlign: 'center' },
  nudgeAmount: { fontWeight: '700', color: '#111827' }
});

export default SafeHarborRing;

