import * as Linking from 'expo-linking';
import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  ChevronDownIcon,
  ExclamationTriangleIcon,
  LockClosedIcon,
  PaperAirplaneIcon,
} from '@/components/CheckoutHeroicons';
import { SkinCare } from '@/constants/skinCareTokens';
import {
  API_BASE_URL,
  DEMO_CHECKOUT_PRODUCT_ID,
  DEMO_PROVIDER_ID,
  getApiReachabilityIssue,
} from '@/config';
import { emitCheckoutAnalytics } from '@/lib/checkoutAnalytics';
import {
  fetchWith429Retry,
  resolveProductImageForCheckout,
} from '@/lib/checkoutCatalogHelpers';

const API_BASE = API_BASE_URL;
const SESSION_KEY = 'patient_session_id';
const API_BASE_KEY = 'patient_api_base_url';

const KELLY_QUOTE_KEY = 'somo_kelly_commerce_quote_v1';
const KELLY_QUOTE_KEY_LEGACY = 'doclittle_kelly_commerce_quote_v1';

async function loadPersistedQuoteId(): Promise<string | null> {
  const current = await SecureStore.getItemAsync(KELLY_QUOTE_KEY);
  if (current) return current;
  const legacy = await SecureStore.getItemAsync(KELLY_QUOTE_KEY_LEGACY);
  if (legacy) {
    await SecureStore.setItemAsync(KELLY_QUOTE_KEY, legacy);
    return legacy;
  }
  return null;
}

const API_HEADERS = {
  'Content-Type': 'application/json',
  'ngrok-skip-browser-warning': 'true',
} as const;

type ChatMsg = { id: string; role: 'user' | 'assistant'; text: string };

type CatalogProduct = {
  id: string;
  name?: string;
  price?: number;
  merchant_id?: string;
  image_url?: string;
  image_link?: string;
  image?: string;
};

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function productImageUrl(p?: CatalogProduct | null, apiBase = API_BASE) {
  if (!p) return null;
  const u = p.image_url || p.image_link || p.image;
  if (!u || !String(u).trim()) return null;
  const s = String(u).trim();
  if (/^https?:\/\//i.test(s) || s.startsWith('data:')) return s;
  if (s.startsWith('/')) {
    try {
      const base = apiBase.replace(/\/$/, '');
      return new URL(s, `${base}/`).href;
    } catch {
      return s;
    }
  }
  return s;
}

/**
 * Native checkout + Kelly chat: catalog switch, server quotes, SSE streaming,
 * in-thread Pay primary (Somo tokens). Same APIs as web checkout-chat.html.
 *
 * File map (search symbols): session/catalog state, fetchQuote, sendMessage (SSE + /turn fallback),
 * openPayModal / startStripeCheckout, emitCheckoutAnalytics, product picker Modal.
 * Architecture: docs/architecture/README.md#commerce-agentic-checkout-file-map
 */
export default function CheckoutChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    product_id?: string;
    provider_id?: string;
    product_name?: string;
    product_image?: string;
  }>();
  const apiIssue = getApiReachabilityIssue();

  const initialProvider = useMemo(
    () => (params.provider_id || DEMO_PROVIDER_ID || '').trim(),
    [params.provider_id]
  );
  const initialProduct = useMemo(
    () => (params.product_id || DEMO_CHECKOUT_PRODUCT_ID || '').trim(),
    [params.product_id]
  );
  const productNameHint = useMemo(
    () => (params.product_name ? String(params.product_name).trim() : ''),
    [params.product_name]
  );
  const productImageHint = useMemo(
    () => (params.product_image ? String(params.product_image).trim() : ''),
    [params.product_image]
  );

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [providerId, setProviderId] = useState(initialProvider);
  const [productId, setProductId] = useState(initialProduct);
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [kellySessionId, setKellySessionId] = useState<string>(() => uid());
  const [commerceQuoteId, setCommerceQuoteId] = useState<string | null>(null);
  const [lastQuotedAmount, setLastQuotedAmount] = useState<number | null>(null);
  const [intakeEmail, setIntakeEmail] = useState('');
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [paySource, setPaySource] = useState<'in_chat' | 'manual'>('in_chat');
  const [payEmail, setPayEmail] = useState('');
  const [payBusy, setPayBusy] = useState(false);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [isSwitchingProduct, setIsSwitchingProduct] = useState(false);
  const [catalogDegraded, setCatalogDegraded] = useState(false);
  const listRef = useRef<FlatList<ChatMsg>>(null);
  const doneHandledRef = useRef(false);
  const streamAccumRef = useRef('');
  const agenticPrimarySentRef = useRef(false);
  const checkoutOpenEmittedRef = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const storedBase = await SecureStore.getItemAsync(API_BASE_KEY);
        if (storedBase && storedBase !== API_BASE) {
          setError('Sign in again on the Home tab after changing API URL.');
          setSessionLoading(false);
          return;
        }
        const sid = await SecureStore.getItemAsync(SESSION_KEY);
        setSessionId(sid);
        const qid = await loadPersistedQuoteId();
        if (qid) setCommerceQuoteId(qid);
      } catch {
        setSessionId(null);
      } finally {
        setSessionLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!sessionId || !productId || !providerId || checkoutOpenEmittedRef.current) return;
    checkoutOpenEmittedRef.current = true;
    emitCheckoutAnalytics('checkout_chat_open', { product_id: productId, provider_id: providerId });
  }, [sessionId, productId, providerId]);

  const loadIntakeEmail = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(`${API_BASE}/api/patient/intake`, {
        headers: { ...API_HEADERS, 'x-session-id': sessionId },
      });
      const data = await res.json();
      const em = data?.intake?.email;
      if (em && typeof em === 'string') {
        setIntakeEmail(em);
        setPayEmail(em);
      }
    } catch {
      /* ignore */
    }
  }, [sessionId]);

  useEffect(() => {
    if (sessionId) loadIntakeEmail();
  }, [sessionId, loadIntakeEmail]);

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogDegraded(false);
    setError(null);
    try {
      const q = new URLSearchParams();
      if (providerId) q.set('provider_id', providerId);
      const qs = q.toString();
      const url = `${API_BASE}/api/public/products${qs ? `?${qs}` : ''}`;
      const res = await fetchWith429Retry(url, {
        headers: { 'ngrok-skip-browser-warning': 'true' },
      });
      let data: Record<string, unknown> = {};
      try {
        data = (await res.json()) as Record<string, unknown>;
      } catch {
        data = {};
      }
      if (!res.ok || !data.success) {
        const err =
          res.status === 429
            ? 'Catalog rate-limited. Wait a moment and tap Retry catalog.'
            : String(data.error || 'Could not load catalog');
        throw new Error(err);
      }
      const list = (data.products || data.prescriptions || []) as CatalogProduct[];
      setCatalog(list);
      if (list.length && !providerId) {
        const m = list[0].merchant_id;
        if (m) setProviderId(String(m));
      }
      const found = list.find((p) => String(p.id) === String(productId));
      if (!found && list.length) {
        const first = list[0];
        setProductId(String(first.id));
        setProviderId(String(first.merchant_id || providerId));
      }
    } catch (e) {
      setCatalog([]);
      setCatalogDegraded(true);
      setError(e instanceof Error ? e.message : 'Catalog error');
    } finally {
      setCatalogLoading(false);
    }
  }, [providerId, productId]);

  useEffect(() => {
    if (sessionId) loadCatalog();
  }, [sessionId, loadCatalog]);

  const fetchQuote = useCallback(async () => {
    if (!sessionId || !productId || !providerId) return;
    setQuoteLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/public/commerce/quote`, {
        method: 'POST',
        headers: API_HEADERS,
        body: JSON.stringify({
          product_id: productId,
          prescription_id: productId,
          provider_id: providerId,
          quantity: 1,
          kelly_session_id: kellySessionId,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success && data.quote_id) {
        setCommerceQuoteId(String(data.quote_id));
        if (typeof data.amount === 'number' && Number.isFinite(data.amount)) {
          setLastQuotedAmount(data.amount);
        }
        emitCheckoutAnalytics('quote_shown', {
          product_id: productId,
          quote_id: String(data.quote_id),
          ...(typeof data.amount === 'number' && Number.isFinite(data.amount)
            ? { amount: data.amount }
            : {}),
        });
        try {
          await SecureStore.setItemAsync(KELLY_QUOTE_KEY, String(data.quote_id));
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    } finally {
      setQuoteLoading(false);
      setIsSwitchingProduct(false);
    }
  }, [sessionId, productId, providerId, kellySessionId]);

  useEffect(() => {
    if (sessionId && productId && providerId && catalog.length) {
      fetchQuote();
    }
  }, [sessionId, productId, providerId, catalog.length, fetchQuote]);

  const selectedProduct = useMemo((): CatalogProduct | undefined => {
    const fromCatalog = catalog.find((p) => String(p.id) === String(productId));
    if (fromCatalog) return fromCatalog;
    if (catalogDegraded && productId) {
      const img =
        resolveProductImageForCheckout(productId, productImageHint, API_BASE) || undefined;
      return {
        id: productId,
        name: productNameHint || 'Product',
        image_url: img,
        merchant_id: providerId || DEMO_PROVIDER_ID || undefined,
      };
    }
    return undefined;
  }, [
    catalog,
    productId,
    catalogDegraded,
    productNameHint,
    productImageHint,
    providerId,
  ]);

  const displayPayAmount = useMemo(() => {
    if (lastQuotedAmount != null && Number.isFinite(lastQuotedAmount)) return lastQuotedAmount;
    const p = selectedProduct?.price;
    if (p != null && Number.isFinite(Number(p))) return Number(p);
    return null;
  }, [lastQuotedAmount, selectedProduct]);

  const canShowPayHero = Boolean(
    !isSwitchingProduct &&
      selectedProduct &&
      commerceQuoteId &&
      displayPayAmount != null &&
      sessionId
  );

  const canManualCheckout = Boolean(selectedProduct && sessionId && providerId);

  const switchProduct = (newId: string) => {
    const p = catalog.find((x) => String(x.id) === String(newId));
    if (!p) return;
    setIsSwitchingProduct(true);
    setProductId(String(p.id));
    if (p.merchant_id) setProviderId(String(p.merchant_id));
    setKellySessionId(uid());
    setLastQuotedAmount(null);
    setCommerceQuoteId(null);
    setMessages((m) => [
      ...m,
      {
        id: uid(),
        role: 'assistant',
        text: `Switched to ${p.name || 'this product'}. Ask Kelly anything, or continue to checkout.`,
      },
    ]);
    setShowPicker(false);
  };

  const parseSseBuffer = (buf: string, onEvent: (ev: Record<string, unknown>) => void) => {
    const parts = buf.split('\n\n');
    const rest = parts.pop() ?? '';
    for (const block of parts) {
      const line = block.trim();
      if (!line.startsWith('data:')) continue;
      const jsonStr = line.replace(/^data:\s*/, '');
      try {
        onEvent(JSON.parse(jsonStr));
      } catch {
        /* ignore */
      }
    }
    return rest;
  };

  const sendMessage = async () => {
    const t = input.trim();
    if (!t || !sessionId || !productId || !providerId || !selectedProduct) return;
    setInput('');
    setSending(true);
    setError(null);
    const userMsg: ChatMsg = { id: uid(), role: 'user', text: t };
    setMessages((m) => [...m, userMsg]);
    const assistantId = uid();
    setMessages((m) => [...m, { id: assistantId, role: 'assistant', text: '' }]);
    doneHandledRef.current = false;
    streamAccumRef.current = '';

    if (!agenticPrimarySentRef.current) {
      agenticPrimarySentRef.current = true;
      emitCheckoutAnalytics('agentic_primary', { product_id: productId, provider_id: providerId });
    }

    const body = JSON.stringify({
      message: t,
      product_id: productId,
      provider_id: providerId,
      session_id: kellySessionId,
    });

    const applyAssistant = (text: string, append: boolean) => {
      if (append) streamAccumRef.current += text;
      else streamAccumRef.current = text;
      setMessages((m) =>
        m.map((x) =>
          x.id === assistantId ? { ...x, text: append ? x.text + text : text } : x
        )
      );
    };

    try {
      const res = await fetch(`${API_BASE}/api/patient/checkout-chat/turn/stream`, {
        method: 'POST',
        headers: { ...API_HEADERS, 'x-session-id': sessionId, Accept: 'text/event-stream' },
        body,
      });
      if (!res.ok) {
        throw new Error(`Chat failed (${res.status})`);
      }
      const reader = res.body?.getReader?.();
      if (!reader) {
        throw new Error('Streaming not available');
      }
      const dec = new TextDecoder();
      let buffer = '';
      let donePayload: Record<string, unknown> | null = null;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += dec.decode(chunk.value, { stream: true });
        buffer = parseSseBuffer(buffer, (d) => {
          if (d.type === 'delta' && typeof d.text === 'string') {
            applyAssistant(d.text, true);
          }
          if (d.type === 'done') {
            if (doneHandledRef.current) return;
            doneHandledRef.current = true;
            donePayload = d;
            if (typeof d.reply === 'string' && d.reply.trim()) {
              applyAssistant(d.reply.trim(), false);
            }
          }
          if (d.type === 'error') {
            throw new Error(String(d.error || 'stream_error'));
          }
        });
      }
      const done = donePayload as {
        toolsUsed?: unknown;
        redirect_to?: string;
        quote_id?: string;
      } | null;
      if (done?.quote_id && typeof done.quote_id === 'string') {
        setCommerceQuoteId(done.quote_id);
        try {
          await SecureStore.setItemAsync(KELLY_QUOTE_KEY, done.quote_id);
        } catch {
          /* ignore */
        }
      }
      if (done?.toolsUsed && Array.isArray(done.toolsUsed)) {
        const tu = done.toolsUsed as string[];
        if (tu.includes('get_product_quote') && !done?.quote_id) {
          fetchQuote();
        }
      }
      if (typeof done?.redirect_to === 'string' && done.redirect_to) {
        await Linking.openURL(done.redirect_to);
      }
    } catch {
      try {
        const res2 = await fetch(`${API_BASE}/api/patient/checkout-chat/turn`, {
          method: 'POST',
          headers: { ...API_HEADERS, 'x-session-id': sessionId },
          body,
        });
        const data = await res2.json();
        if (res2.ok && data.success) {
          const reply = String(data.reply || '').trim() || 'I’m here.';
          const prev = streamAccumRef.current.trim();
          if (prev.length > 0 && prev !== reply) {
            setMessages((m) => [...m, { id: uid(), role: 'assistant', text: reply }]);
          } else {
            applyAssistant(reply, false);
          }
          if (data.quote_id) {
            setCommerceQuoteId(String(data.quote_id));
            try {
              await SecureStore.setItemAsync(KELLY_QUOTE_KEY, String(data.quote_id));
            } catch {
              /* ignore */
            }
            fetchQuote();
          }
          if (data.redirect_to) {
            await Linking.openURL(data.redirect_to);
          }
          return;
        }
      } catch {
        /* fall through */
      }
      setMessages((m) => m.filter((x) => x.id !== assistantId));
      setMessages((m) => [
        ...m,
        {
          id: uid(),
          role: 'assistant',
          text: 'Could not reach Kelly. Check API URL and sign-in on the Home tab.',
        },
      ]);
    } finally {
      setSending(false);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  };

  const openPayModal = (source: 'in_chat' | 'manual') => {
    emitCheckoutAnalytics(source === 'in_chat' ? 'in_chat_pay_tap' : 'manual_checkout_click', {
      product_id: productId,
      quote_id: commerceQuoteId || undefined,
    });
    setPaySource(source);
    setPayEmail(intakeEmail || payEmail);
    setError(null);
    setPayModalOpen(true);
  };

  const startStripeCheckout = async () => {
    if (!selectedProduct || !sessionId) return;
    const email = (payEmail || intakeEmail).trim();
    if (!email) {
      setError('Add your email in the payment sheet.');
      setPayModalOpen(true);
      return;
    }
    setPayBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        provider_id: providerId || undefined,
        email,
        name: email.split('@')[0] || 'Customer',
        prescription_id: selectedProduct.id,
        quantity: 1,
        payment_method: 'direct_stripe',
        kelly_session_id: kellySessionId,
      };
      if (commerceQuoteId) {
        body.quote_id = commerceQuoteId;
        body.checkout_session_id = commerceQuoteId;
      }
      const idem = commerceQuoteId ? `${commerceQuoteId}:${email}` : '';
      const res = await fetch(`${API_BASE}/api/public/checkout/start`, {
        method: 'POST',
        headers: {
          ...API_HEADERS,
          ...(idem ? { 'Idempotency-Key': idem } : {}),
        },
        body: JSON.stringify(body),
      });
      const payload = await res.json();
      if (!res.ok || !payload.success) {
        throw new Error(payload.error || 'Checkout failed');
      }
      const link = payload.checkout?.payment_link;
      if (link) {
        setPayModalOpen(false);
        emitCheckoutAnalytics('pay_started', {
          product_id: selectedProduct.id,
          quote_id: commerceQuoteId || undefined,
        });
        await WebBrowser.openBrowserAsync(String(link));
      }
    } catch (e) {
      emitCheckoutAnalytics('pay_fail', {
        product_id: selectedProduct?.id,
        quote_id: commerceQuoteId || undefined,
        error: e instanceof Error ? e.message : String(e),
      });
      setError(e instanceof Error ? e.message : 'Payment failed');
      setPayModalOpen(true);
    } finally {
      setPayBusy(false);
    }
  };

  const imgUrl = productImageUrl(selectedProduct, API_BASE);

  if (sessionLoading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color={SkinCare.accent} />
        <Text style={styles.muted}>Loading…</Text>
      </SafeAreaView>
    );
  }

  if (!sessionId) {
    return (
      <SafeAreaView style={styles.wrap}>
        <Text style={styles.title}>Sign in required</Text>
        <Text style={styles.body}>
          Open the Home tab, verify your email, then return here for checkout chat.
        </Text>
        <Pressable
          style={styles.btn}
          onPress={() => router.replace('/(tabs)' as never)}
          accessibilityRole="button"
          accessibilityLabel="Go to Home">
          <Text style={styles.btnText}>Go to Home</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}>
        {apiIssue ? (
          <View style={styles.warn}>
            <ExclamationTriangleIcon size={20} color="#c2410c" />
            <Text style={styles.warnText}>{apiIssue}</Text>
          </View>
        ) : null}

        <View style={styles.headerStrip} accessibilityRole="header">
          {imgUrl ? (
            <Image
              source={{ uri: imgUrl }}
              style={styles.headerThumb}
              accessibilityIgnoresInvertColors
            />
          ) : (
            <View style={[styles.headerThumb, styles.headerThumbPlaceholder]} />
          )}
          <View style={styles.headerTextCol}>
            <Text style={styles.productName} numberOfLines={2}>
              {selectedProduct?.name || productNameHint || 'Product'}
            </Text>
            {quoteLoading ? (
              <Text style={styles.priceMuted}>Updating price…</Text>
            ) : displayPayAmount != null ? (
              <Text
                style={styles.price}
                accessibilityLiveRegion="polite"
                accessibilityLabel={`Price ${displayPayAmount.toFixed(2)} dollars`}>
                ${displayPayAmount.toFixed(2)} USD
              </Text>
            ) : selectedProduct?.price != null &&
              Number.isFinite(Number(selectedProduct.price)) ? (
              <Text style={styles.price}>
                ${Number(selectedProduct.price).toFixed(2)} USD
              </Text>
            ) : catalogDegraded ? (
              <Text style={styles.priceMuted}>Price loads when catalog is available — tap Retry.</Text>
            ) : (
              <Text style={styles.priceMuted}>See checkout for price</Text>
            )}
            <Pressable
              style={styles.switchPill}
              onPress={() => setShowPicker(true)}
              accessibilityRole="button"
              accessibilityLabel="Switch product">
              <Text style={styles.switchPillText}>Switch</Text>
              <ChevronDownIcon size={16} color={SkinCare.black} />
            </Pressable>
          </View>
        </View>

        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          renderItem={({ item }) => (
            <View
              style={[
                styles.bubble,
                item.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant,
              ]}>
              <Text style={styles.bubbleText}>{item.text}</Text>
            </View>
          )}
          ListEmptyComponent={
            <Text style={styles.muted}>Ask Kelly about this product. Replies stream in real time.</Text>
          }
        />

        {canShowPayHero ? (
          <View style={styles.payHeroWrap}>
            <Text style={styles.payNote}>You’ll enter your card on our secure Stripe page.</Text>
            <Pressable
              style={[styles.payHero, payBusy && styles.payDisabled]}
              onPress={() => openPayModal('in_chat')}
              disabled={payBusy}
              accessibilityRole="button"
              accessibilityLabel={`Pay ${displayPayAmount?.toFixed(2)} securely`}>
              <LockClosedIcon size={20} color={SkinCare.black} />
              <Text style={styles.payHeroText}>
                Pay ${displayPayAmount!.toFixed(2)} securely
              </Text>
            </Pressable>
          </View>
        ) : null}

        {catalogDegraded && !catalogLoading ? (
          <View style={styles.retryRow}>
            <Pressable
              style={styles.retryBtn}
              onPress={() => loadCatalog()}
              accessibilityRole="button"
              accessibilityLabel="Retry catalog">
              <Text style={styles.retryBtnText}>Retry catalog</Text>
            </Pressable>
          </View>
        ) : null}

        {error && !payModalOpen ? (
          <View style={styles.errRow}>
            <ExclamationTriangleIcon size={18} color="#b45309" />
            <Text style={styles.err}>{error}</Text>
          </View>
        ) : null}
        {catalogLoading ? (
          <ActivityIndicator style={{ marginVertical: 8 }} color={SkinCare.accent} />
        ) : null}

        <View style={styles.composerRow}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Ask Kelly about this product…"
            placeholderTextColor="#9ca3af"
            editable={!sending}
            multiline
            maxLength={4000}
            accessibilityLabel="Message to Kelly"
          />
          <Pressable
            style={[styles.sendBtn, sending && styles.sendBtnDisabled]}
            onPress={sendMessage}
            disabled={sending || !input.trim()}
            accessibilityRole="button"
            accessibilityLabel="Send to Kelly">
            <PaperAirplaneIcon size={22} color={SkinCare.black} />
          </Pressable>
        </View>

        <Pressable
          onPress={() => openPayModal('manual')}
          disabled={payBusy || !canManualCheckout}
          style={[styles.payWithout, (!canManualCheckout || payBusy) && styles.payWithoutDisabled]}
          accessibilityRole="button"
          accessibilityLabel="Pay without chat">
          <Text style={styles.payWithoutText}>Pay without chat</Text>
        </Pressable>

        <Pressable onPress={() => router.back()} style={styles.back} accessibilityRole="button">
          <Text style={styles.backText}>Close</Text>
        </Pressable>
      </KeyboardAvoidingView>

      <Modal visible={showPicker} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Switch product</Text>
            <FlatList
              data={catalog}
              keyExtractor={(p) => String(p.id)}
              style={{ maxHeight: 360 }}
              renderItem={({ item }) => {
                const iu = productImageUrl(item, API_BASE);
                return (
                  <Pressable
                    style={styles.modalRow}
                    onPress={() => switchProduct(String(item.id))}
                    accessibilityRole="button">
                    {iu ? (
                      <Image source={{ uri: iu }} style={styles.modalThumb} />
                    ) : (
                      <View style={[styles.modalThumb, styles.headerThumbPlaceholder]} />
                    )}
                    <Text style={styles.modalRowText} numberOfLines={2}>
                      {item.name || item.id}
                      {item.price != null && Number.isFinite(Number(item.price))
                        ? ` — $${Number(item.price).toFixed(2)}`
                        : ''}
                    </Text>
                  </Pressable>
                );
              }}
            />
            <Pressable style={styles.modalClose} onPress={() => setShowPicker(false)}>
              <Text style={styles.modalCloseText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={payModalOpen} animationType="fade" transparent>
        <View style={styles.payModalOverlay}>
          <View style={styles.payModalCard}>
            <Text style={styles.payModalTitle}>Confirm payment</Text>
            <Text style={styles.payModalLine}>
              {selectedProduct?.name} × 1
            </Text>
            {displayPayAmount != null ? (
              <Text style={styles.payModalTotal}>Total ${displayPayAmount.toFixed(2)} USD</Text>
            ) : null}
            <Text style={styles.payModalLabel}>Email for receipt</Text>
            <TextInput
              style={styles.payModalInput}
              value={payEmail}
              onChangeText={setPayEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="you@email.com"
              placeholderTextColor="#9ca3af"
            />
            {error ? (
              <>
                <Text style={styles.payModalErr}>{error}</Text>
                <Text style={styles.payModalRetryHint}>Update details if needed, then tap Pay again.</Text>
              </>
            ) : null}
            <Pressable
              style={[styles.payModalPrimary, payBusy && styles.payDisabled]}
              onPress={() => startStripeCheckout()}
              disabled={payBusy}>
              <Text style={styles.payModalPrimaryText}>
                {payBusy ? '…' : 'Pay with Stripe'}
              </Text>
            </Pressable>
            <Pressable onPress={() => setPayModalOpen(false)} style={styles.payModalCancel}>
              <Text style={styles.modalCloseText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: SkinCare.cream },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, backgroundColor: SkinCare.cream },
  wrap: { flex: 1, padding: 24, justifyContent: 'center', gap: 16, backgroundColor: SkinCare.cream },
  title: { fontSize: 22, fontWeight: '700', color: SkinCare.black },
  body: { fontSize: 15, lineHeight: 22, color: SkinCare.black },
  muted: { fontSize: 14, color: SkinCare.gray, paddingHorizontal: 16 },
  err: { color: SkinCare.danger, paddingHorizontal: 4, fontSize: 13, flex: 1 },
  retryRow: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    alignItems: 'center',
  },
  retryBtn: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: SkinCare.border,
    backgroundColor: SkinCare.cream,
  },
  retryBtnText: { fontWeight: '700', fontSize: 14, color: SkinCare.black },
  errRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 4,
  },
  warn: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#fff7ed',
    padding: 12,
    marginHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: SkinCare.border,
  },
  warnText: { color: '#9a3412', fontSize: 14, flex: 1 },
  headerStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    paddingHorizontal: 16,
    backgroundColor: SkinCare.white,
    borderBottomWidth: 1,
    borderBottomColor: SkinCare.border,
  },
  headerThumb: {
    width: 64,
    height: 64,
    borderRadius: 12,
    backgroundColor: SkinCare.cream,
    borderWidth: 1,
    borderColor: SkinCare.border,
  },
  headerThumbPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextCol: { flex: 1, minWidth: 0 },
  productName: { color: SkinCare.black, fontSize: 16, fontWeight: '700' },
  price: { color: SkinCare.black, fontSize: 16, fontWeight: '700', marginTop: 4 },
  priceMuted: { color: SkinCare.gray, fontSize: 14, marginTop: 4 },
  switchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    minHeight: SkinCare.minTap,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: SkinCare.border,
    backgroundColor: SkinCare.white,
  },
  switchPillText: { color: SkinCare.black, fontWeight: '700', fontSize: 13 },
  listContent: { padding: 16, paddingBottom: 24, flexGrow: 1 },
  bubble: {
    maxWidth: '85%',
    padding: 12,
    borderRadius: 14,
    marginBottom: 10,
  },
  bubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: SkinCare.userBubbleBg,
    borderWidth: 1,
    borderColor: SkinCare.border,
  },
  bubbleAssistant: {
    alignSelf: 'flex-start',
    backgroundColor: SkinCare.kellyBubble,
    borderWidth: 1,
    borderColor: SkinCare.border,
  },
  bubbleText: { fontSize: 15, color: SkinCare.black, lineHeight: 22 },
  payHeroWrap: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 8,
  },
  payNote: { fontSize: 12, color: SkinCare.gray },
  payHero: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: SkinCare.minTap,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: SkinCare.accent,
  },
  payHeroText: { fontSize: 16, fontWeight: '800', color: SkinCare.white },
  payDisabled: { opacity: 0.55 },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 12,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: SkinCare.border,
    backgroundColor: SkinCare.white,
  },
  input: {
    flex: 1,
    minHeight: SkinCare.minTap,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: SkinCare.border,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: SkinCare.white,
    color: SkinCare.black,
  },
  sendBtn: {
    width: SkinCare.minTap,
    height: SkinCare.minTap,
    borderRadius: SkinCare.minTap / 2,
    backgroundColor: SkinCare.black,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.5 },
  payWithout: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    minHeight: 44,
  },
  payWithoutDisabled: { opacity: 0.45 },
  payWithoutText: {
    color: SkinCare.gray,
    fontWeight: '600',
    fontSize: 14,
    textDecorationLine: 'underline',
  },
  back: { padding: 16, alignItems: 'center' },
  backText: { color: SkinCare.gray, fontWeight: '600' },
  btn: {
    backgroundColor: SkinCare.black,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    minHeight: SkinCare.minTap,
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    maxHeight: '80%',
  },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 12, color: SkinCare.black },
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: SkinCare.cream,
    minHeight: 64,
  },
  modalThumb: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: SkinCare.cream,
    borderWidth: 1,
    borderColor: SkinCare.border,
  },
  modalRowText: { fontSize: 15, color: SkinCare.black, flex: 1 },
  modalClose: { paddingVertical: 16, alignItems: 'center' },
  modalCloseText: { color: SkinCare.gray, fontWeight: '600', fontSize: 16 },
  payModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'center',
    padding: 16,
  },
  payModalCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    maxWidth: 420,
    width: '90%',
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: SkinCare.border,
  },
  payModalTitle: { fontSize: 18, fontWeight: '700', color: SkinCare.black, marginBottom: 8 },
  payModalLine: { fontSize: 15, color: SkinCare.gray, marginBottom: 4 },
  payModalTotal: { fontSize: 16, fontWeight: '700', color: SkinCare.black, marginBottom: 12 },
  payModalLabel: { fontSize: 13, color: SkinCare.gray, marginBottom: 6 },
  payModalErr: { color: SkinCare.danger, fontSize: 13, marginBottom: 4 },
  payModalRetryHint: { color: SkinCare.gray, fontSize: 12, marginBottom: 8 },
  payModalInput: {
    borderWidth: 1,
    borderColor: SkinCare.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    minHeight: 48,
    marginBottom: 12,
    color: SkinCare.black,
  },
  payModalPrimary: {
    backgroundColor: SkinCare.accent,
    minHeight: 48,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  payModalPrimaryText: { fontWeight: '800', color: SkinCare.white, fontSize: 16 },
  payModalCancel: { paddingVertical: 12, alignItems: 'center' },
});
