import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { JournalTokens } from '@/constants/journalTokens';
import { patientGet } from '@/lib/patient-api';

type ShelfProduct = {
  id: string;
  product_name: string;
  inventory_status?: string;
  opened_date?: string | null;
  expiry_date?: string | null;
  pao_months?: number | null;
  price_usd?: number | null;
  key_ingredients?: string | null;
};

export default function ShelfScreen() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [catalogWarning, setCatalogWarning] = useState<string | null>(null);
  const [products, setProducts] = useState<ShelfProduct[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [shelf, health] = await Promise.all([
        patientGet('/api/patient/shelf/products'),
        patientGet('/api/patient/health/catalog'),
      ]);
      setProducts(Array.isArray(shelf?.products) ? (shelf.products as ShelfProduct[]) : []);
      setCatalogWarning(health?.catalog_ok ? null : String(health?.message || 'Catalog indexes may be unavailable.'));
    } catch (e: any) {
      setError(e?.message || 'Unable to load products.');
      setProducts([]);
      setCatalogWarning(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}>
        <Text allowFontScaling style={styles.title}>Products</Text>
        <Text allowFontScaling style={styles.subtitle}>Inventory and routine-linked shelf products.</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {catalogWarning ? <Text style={styles.warning}>{catalogWarning}</Text> : null}

        {!products.length && !error ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>No products yet</Text>
            <Text style={styles.cardBody}>Use + Scan to add products, then manage inventory here.</Text>
          </View>
        ) : null}

        {products.map((p) => (
          <View key={p.id} style={styles.card}>
            <Text allowFontScaling style={styles.cardTitle}>{p.product_name}</Text>
            <Text allowFontScaling style={styles.cardBody}>
              Status: {p.inventory_status || 'stock'}
              {p.opened_date ? ` · Opened ${p.opened_date}` : ''}
              {p.expiry_date ? ` · Expires ${p.expiry_date}` : ''}
              {p.pao_months ? ` · PAO ${p.pao_months}m` : ''}
            </Text>
            {p.price_usd != null ? <Text style={styles.meta}>Price: ${Number(p.price_usd).toFixed(2)}</Text> : null}
            {p.key_ingredients ? (
              <View style={styles.badge}>
                <Text allowFontScaling style={styles.badgeText}>Ingredients: {p.key_ingredients}</Text>
              </View>
            ) : null}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: JournalTokens.color.cream },
  content: { padding: JournalTokens.spacing.lg, gap: JournalTokens.spacing.md },
  title: { fontFamily: JournalTokens.font.display, fontSize: 30, color: JournalTokens.color.ink },
  subtitle: { fontFamily: JournalTokens.font.body, color: JournalTokens.color.muted },
  card: {
    backgroundColor: JournalTokens.color.card,
    borderRadius: JournalTokens.radius.lg,
    borderWidth: 1,
    borderColor: JournalTokens.color.line,
    padding: JournalTokens.spacing.lg,
    ...JournalTokens.shadow.card,
  },
  cardTitle: { fontFamily: JournalTokens.font.body, fontWeight: '700', fontSize: 17, color: JournalTokens.color.ink },
  cardBody: { marginTop: JournalTokens.spacing.xs, color: JournalTokens.color.muted, fontFamily: JournalTokens.font.body },
  meta: { marginTop: 6, color: JournalTokens.color.ink, fontSize: 12 },
  badge: {
    marginTop: JournalTokens.spacing.md,
    alignSelf: 'flex-start',
    paddingHorizontal: JournalTokens.spacing.sm,
    paddingVertical: 6,
    borderRadius: JournalTokens.radius.pill,
    backgroundColor: '#F4DFD7',
  },
  badgeText: { color: JournalTokens.color.terracotta, fontFamily: JournalTokens.font.body, fontWeight: '700', fontSize: 12 },
  error: { color: '#b91c1c', fontSize: 13 },
  warning: { color: '#9a3412', fontSize: 13 },
});

