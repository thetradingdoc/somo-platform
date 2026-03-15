import useSWR from 'swr';
import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL } from '@/config';

export type SafeHarborState = {
  status: 'protected' | 'warning' | 'unprotected' | 'unknown';
  color: string;
  ratio: number | null;
  amount_to_safe: number | null;
  billed: number;
  paid: number;
  currency: string;
  billing_month: string;
};

export type UnifiedLedgerResponse = {
  success: boolean;
  empi_id: string;
  appointments: any[];
  invoices: any[];
  explanation_of_benefit: any[];
  safe_harbor: SafeHarborState;
};

/**
 * useUnifiedLedger Hook
 * Centralizes longitudinal financial data fetching and 2026 Safe Harbor logic.
 */
export function useUnifiedLedger(month: string = new Date().toISOString().slice(0, 7)) {
  const fetcher = async (baseUrl: string): Promise<UnifiedLedgerResponse> => {
    // 1. Retrieve EMPI ID from hardware-backed secure storage
    const empiId = await SecureStore.getItemAsync('user_empi_id');
    if (!empiId) {
      throw new Error('No EMPI identity found. Please re-authenticate.');
    }

    const res = await fetch(`${baseUrl}/${encodeURIComponent(empiId)}?billing_month=${encodeURIComponent(month)}`);
    if (!res.ok) {
      throw new Error('Failed to fetch unified ledger');
    }
    return res.json();
  };

  const { data, error, mutate } = useSWR<UnifiedLedgerResponse>(
    `${API_BASE_URL}/api/rcm/unified-ledger`,
    fetcher,
    {
      refreshInterval: 30000,
      revalidateOnFocus: true
    }
  );

  const safeHarbor: SafeHarborState =
    data?.safe_harbor ?? {
      status: 'unknown',
      color: 'grey',
      ratio: 0,
      amount_to_safe: null,
      billed: 0,
      paid: 0,
      currency: 'USD',
      billing_month: month
    };

  // Narrative Ledger Formatting (v0: appointments only)
  const ledger =
    data?.appointments?.map((visit: any) => ({
      id: visit.id,
      date: visit.start_time || visit.date,
      title: `Visit: ${visit.provider || visit.provider_name || 'Healthcare Provider'}`,
      summary: visit.visit_summary || 'Processing insurance claims...',
      isSettled: !!visit.settlement_hash,
      totalCost: visit.total_cost || 0
    })) ?? [];

  return {
    ledger,
    safeHarbor,
    rawFhirData: data?.explanation_of_benefit ?? [],
    isLoading: !error && !data,
    isError: error,
    refreshLedger: mutate
  };
}

