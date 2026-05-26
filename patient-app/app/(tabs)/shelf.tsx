import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { JournalTokens } from '@/constants/journalTokens';
import { patientGet, patientPost } from '@/lib/patient-api';

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

type TemplateItem = {
  id: string;
  product_name: string;
  usage_time?: string;
};

type LayeringResult = {
  overall?: string;
  graph_unavailable?: boolean;
  conflicts?: Array<{ ingredient_a?: string; ingredient_b?: string; notes?: string }>;
};

export default function ShelfScreen() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [catalogWarning, setCatalogWarning] = useState<string | null>(null);
  const [products, setProducts] = useState<ShelfProduct[]>([]);
  const [templateItems, setTemplateItems] = useState<TemplateItem[]>([]);
  const [layering, setLayering] = useState<LayeringResult | null>(null);
  const [linkingId, setLinkingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [shelf, health, template] = await Promise.all([
        patientGet('/api/patient/shelf/products'),
        patientGet('/api/patient/health/catalog'),
        patientGet('/api/patient/routine/template').catch(() => null),
      ]);
      setProducts(Array.isArray(shelf?.products) ? (shelf.products as ShelfProduct[]) : []);
      setCatalogWarning(health?.catalog_ok ? null : String(health?.message || 'Catalog indexes may be unavailable.'));
      const items = Array.isArray(template?.items) ? (template.items as TemplateItem[]) : [];
      setTemplateItems(items.filter((it) => it.id));
      if (template?.has_template) {
        const layer = await patientGet('/api/patient/routine/layering-check').catch(() => null);
        setLayering(layer?.overall ? (layer as LayeringResult) : null);
      } else {
        setLayering(null);
      }
    } catch (e: any) {
      setError(e?.message || 'Unable to load products.');
      setProducts([]);
      setCatalogWarning(null);
      setLayering(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const linkToStep = async (productId: string, templateItemId: string) => {
    setLinkingId(productId);
    try {
      await patientPost(`/api/patient/shelf/products/${encodeURIComponent(productId)}/link-routine-item`, {
        template_item_id: templateItemId,
      });
      await load();
    } catch (e: any) {
      setError(e?.message || 'Could not link product to routine step.');
    } finally {
      setLinkingId(null);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}>
        <Text allowFontScaling style={styles.title}>Manage prescriptions</Text>
        <Text allowFontScaling style={styles.subtitle}>Track medications and routine-linked products.</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {catalogWarning ? <Text style={styles.warning}>{catalogWarning}</Text> : null}

        {layering?.graph_unavailable || layering?.overall === 'unknown' ? (
          <View style={styles.warnCard}>
            <Text style={styles.warnTitle}>Layering check</Text>
            <Text style={styles.warnBody}>Ingredient compatibility data is temporarily unavailable.</Text>
          </View>
        ) : null}
        {layering && layering.overall && layering.overall !== 'safe' && layering.overall !== 'unknown' ? (
          <View style={styles.warnCard}>
            <Text style={styles.warnTitle}>Layering note</Text>
            <Text style={styles.warnBody}>
              Your current routine may have ingredient conflicts ({layering.overall}). Adjust timing or check with your
              clinician before combining actives.
            </Text>
            {(layering.conflicts || []).slice(0, 2).map((c, i) => (
              <Text key={i} style={styles.warnMeta}>
                {c.ingredient_a} + {c.ingredient_b}: {c.notes || 'Use caution'}
              </Text>
            ))}
          </View>
        ) : null}

        {!products.length && !error ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>No prescriptions yet</Text>
            <Text style={styles.cardBody}>Use + Capture or add items here to track what you use.</Text>
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
            {templateItems.length ? (
              <View style={styles.linkRow}>
                <Text style={styles.linkLabel}>Link to routine step:</Text>
                {templateItems.slice(0, 4).map((it) => (
                  <Pressable
                    key={`${p.id}-${it.id}`}
                    disabled={linkingId === p.id}
                    style={styles.linkChip}
                    onPress={() => void linkToStep(p.id, it.id)}>
                    <Text style={styles.linkChipText}>{it.product_name || it.usage_time || 'Step'}</Text>
                  </Pressable>
                ))}
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
  warnCard: {
    backgroundColor: '#FEF3C7',
    borderRadius: JournalTokens.radius.lg,
    borderWidth: 1,
    borderColor: '#FDE68A',
    padding: JournalTokens.spacing.md,
  },
  warnTitle: { fontFamily: JournalTokens.font.body, fontWeight: '700', color: '#92400E' },
  warnBody: { marginTop: 4, fontSize: 13, color: '#78350F' },
  warnMeta: { marginTop: 4, fontSize: 12, color: '#92400E' },
  linkRow: { marginTop: JournalTokens.spacing.md, gap: 6 },
  linkLabel: { fontSize: 12, color: JournalTokens.color.muted, fontFamily: JournalTokens.font.body },
  linkChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: JournalTokens.radius.pill,
    backgroundColor: JournalTokens.color.line,
  },
  linkChipText: { fontSize: 12, color: JournalTokens.color.ink, fontFamily: JournalTokens.font.body },
  error: { color: '#b91c1c', fontSize: 13 },
  warning: { color: '#9a3412', fontSize: 13 },
});
