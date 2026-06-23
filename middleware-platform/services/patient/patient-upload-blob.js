/**
 * Telemedicine Phase 4 — Task 31: Upload to Azure Blob (patient-uploads container).
 * Path: {patient_id}/{appointment_id|pre-visit}/{unix_ts}_{sanitised_filename}
 */
const { BlobServiceClient } = require('@azure/storage-blob');
const path = require('path');

const CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING;
const CONTAINER = 'patient-uploads';

let blobServiceClient = null;
if (CONNECTION_STRING) {
  try {
    blobServiceClient = BlobServiceClient.fromConnectionString(CONNECTION_STRING);
  } catch (e) {
    console.warn('[patient-upload-blob] Failed to init BlobServiceClient:', e.message);
  }
}

function isConfigured() {
  return !!blobServiceClient;
}

function sanitiseFilename(name) {
  return (name || 'file')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 200);
}

/**
 * Upload a buffer to patient-uploads container.
 * @param {string} patientId - FHIR patient resource_id
 * @param {string|null} appointmentId - Appointment id or null for pre-visit
 * @param {string} filename - Original filename (will be sanitised)
 * @param {Buffer} buffer - File contents
 * @param {string} contentType - e.g. application/pdf, image/jpeg
 * @returns {Promise<{ storagePath: string, blobUrl?: string }|null>}
 */
async function uploadBuffer(patientId, appointmentId, filename, buffer, contentType) {
  if (!blobServiceClient) {
    console.warn('[patient-upload-blob] AZURE_STORAGE_CONNECTION_STRING not set');
    return null;
  }
  const safe = sanitiseFilename(filename);
  const prefix = appointmentId ? `${patientId}/${appointmentId}` : `${patientId}/pre-visit`;
  const unixTs = Math.floor(Date.now() / 1000);
  const blobName = `${prefix}/${unixTs}_${safe}`;

  try {
    const containerClient = blobServiceClient.getContainerClient(CONTAINER);
    await containerClient.createIfNotExists({ access: 'private' });
    const blockClient = containerClient.getBlockBlobClient(blobName);
    await blockClient.uploadData(buffer, {
      blobHTTPHeaders: { blobContentType: contentType }
    });
    return { storagePath: blobName, blobUrl: blockClient.url };
  } catch (e) {
    console.error('[patient-upload-blob] Upload failed:', e.message);
    throw e;
  }
}

module.exports = { isConfigured, uploadBuffer, sanitiseFilename, CONTAINER };
