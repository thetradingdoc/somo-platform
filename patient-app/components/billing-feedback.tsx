import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { JournalTokens } from '@/constants/journalTokens';

type Toast = { message: string; tone?: 'success' | 'error' };

const ToastCtx = createContext<{ showToast: (message: string, tone?: 'success' | 'error') => void }>({
  showToast: () => {},
});

export function useToast() {
  return useContext(ToastCtx);
}

export function BillingFeedbackProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);

  const showToast = useCallback((message: string, tone: 'success' | 'error' = 'success') => {
    setToast({ message, tone });
    setTimeout(() => setToast(null), 3200);
  }, []);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      {toast ? (
        <View style={styles.wrap} pointerEvents="box-none">
          <Pressable style={[styles.toast, toast.tone === 'error' && styles.toastErr]} onPress={() => setToast(null)}>
            <Text style={styles.toastText}>{toast.message}</Text>
          </Pressable>
        </View>
      ) : null}
    </ToastCtx.Provider>
  );
}

export function LoadingCard({ label }: { label: string }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardText}>{label}</Text>
    </View>
  );
}

export function ErrorCard({
  title,
  message,
  onRetry,
  retryLabel,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardText}>{message}</Text>
      {onRetry ? (
        <Pressable onPress={onRetry} style={styles.retry}>
          <Text style={styles.retryText}>{retryLabel || 'Retry'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function OfflineBanner({ message }: { message: string }) {
  return (
    <View style={styles.offline}>
      <Text style={styles.offlineText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, bottom: 100, zIndex: 999 },
  toast: {
    backgroundColor: JournalTokens.color.ink,
    padding: 14,
    borderRadius: 10,
  },
  toastErr: { backgroundColor: '#991b1b' },
  toastText: { color: '#fff', textAlign: 'center', fontWeight: '600' },
  card: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: JournalTokens.color.card,
    borderWidth: 1,
    borderColor: JournalTokens.color.line,
  },
  cardTitle: { fontWeight: '700', marginBottom: 4, color: JournalTokens.color.ink },
  cardText: { color: JournalTokens.color.muted },
  retry: { marginTop: 10 },
  retryText: { color: JournalTokens.color.accent, fontWeight: '600' },
  offline: {
    backgroundColor: '#FAEEDA',
    padding: 10,
    borderRadius: 8,
    marginBottom: 8,
  },
  offlineText: { color: '#854F0B', fontSize: 13 },
});
