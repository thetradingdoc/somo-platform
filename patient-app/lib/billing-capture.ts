import { patientPost, patientUploadForm } from '@/lib/patient-api';

export type BillingDocument = {
  id: string;
  source_type?: string;
  file_name?: string;
  mime_type?: string;
  parse_status?: string;
  confidence_score?: number;
};

export type BillingExtraction = {
  provider_name?: string | null;
  service_date?: string | null;
  amount_cents?: number | null;
  status?: string;
  confidence_score?: number;
};

export function dollarsToCents(amount: string | number | null | undefined): number | null {
  if (amount == null || amount === '') return null;
  const n = typeof amount === 'number' ? amount : Number(String(amount).replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export async function uploadBillingDocumentFile(opts: {
  uri: string;
  fileName: string;
  mimeType: string;
  sourceType: 'scan' | 'upload';
}): Promise<BillingDocument> {
  const form = new FormData();
  form.append('file', {
    uri: opts.uri,
    name: opts.fileName,
    type: opts.mimeType,
  } as unknown as Blob);
  form.append(
    'metadata',
    JSON.stringify({
      source_type: opts.sourceType,
      file_name: opts.fileName,
      mime_type: opts.mimeType,
    })
  );
  const res = await patientUploadForm('/api/patient/billing/documents', form);
  const doc = res.document as BillingDocument | undefined;
  if (!doc?.id) throw new Error('Upload did not return a document id');
  return doc;
}

export async function extractBillingDocument(documentId: string): Promise<{ extraction: BillingExtraction }> {
  const res = await patientPost(`/api/patient/billing/documents/${encodeURIComponent(documentId)}/extract`, {});
  return { extraction: (res.extraction || {}) as BillingExtraction };
}

export async function confirmBillingDocument(
  documentId: string,
  fields: {
    provider_name?: string;
    service_date?: string;
    amount_cents?: number;
    status?: 'tracked' | 'needs_review' | string;
    confidence_score?: number;
  }
): Promise<void> {
  await patientPost('/api/patient/billing/documents/confirm', {
    document_id: documentId,
    fields,
  });
}

export async function createBillingEvent(body: {
  event_type: string;
  title: string;
  provider_name?: string | null;
  service_date?: string | null;
  amount_cents?: number | null;
  status?: string;
  document_id?: string;
}): Promise<void> {
  await patientPost('/api/patient/billing/events', body);
}
