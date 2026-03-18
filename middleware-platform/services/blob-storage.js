const { BlobServiceClient, StorageSharedKeyCredential, generateBlobSASQueryParameters, BlobSASPermissions } = require('@azure/storage-blob');

function isAzureConfigured() {
  return !!(process.env.AZURE_STORAGE_ACCOUNT && process.env.AZURE_STORAGE_KEY && process.env.AZURE_STORAGE_CONTAINER);
}

function getClient() {
  const account = process.env.AZURE_STORAGE_ACCOUNT;
  const key = process.env.AZURE_STORAGE_KEY;
  const credential = new StorageSharedKeyCredential(account, key);
  const service = new BlobServiceClient(`https://${account}.blob.core.windows.net`, credential);
  return { service, credential, account };
}

async function ensureContainer() {
  const { service } = getClient();
  const containerName = process.env.AZURE_STORAGE_CONTAINER;
  const container = service.getContainerClient(containerName);
  await container.createIfNotExists();
  return container;
}

async function uploadBuffer({ buffer, contentType, blobName }) {
  const container = await ensureContainer();
  const block = container.getBlockBlobClient(blobName);
  await block.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: contentType || 'application/octet-stream' }
  });
  return {
    provider: 'azure',
    bucket: process.env.AZURE_STORAGE_CONTAINER,
    key: blobName,
    url: block.url
  };
}

function generateSignedUrl({ blobName, expiresInSeconds = 300, contentDispositionFilename = null }) {
  const { credential, account } = getClient();
  const containerName = process.env.AZURE_STORAGE_CONTAINER;
  const startsOn = new Date(Date.now() - 60 * 1000);
  const expiresOn = new Date(Date.now() + Math.max(30, expiresInSeconds) * 1000);

  const perms = new BlobSASPermissions();
  perms.read = true;

  const sas = generateBlobSASQueryParameters({
    containerName,
    blobName,
    permissions: perms,
    startsOn,
    expiresOn,
    contentDisposition: contentDispositionFilename
      ? `attachment; filename="${encodeURIComponent(contentDispositionFilename)}"`
      : undefined
  }, credential).toString();

  return `https://${account}.blob.core.windows.net/${containerName}/${blobName}?${sas}`;
}

module.exports = {
  isAzureConfigured,
  uploadBuffer,
  generateSignedUrl
};

