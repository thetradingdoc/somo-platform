/**
 * Image Preprocessor - Layer 1 Perception
 *
 * Preprocesses medical images for GPT-4o vision analysis.
 * Modality-specific: xray (contrast), mri (grayscale), dermatology (color, sharpen).
 */

const sharp = require('sharp');
const fs = require('fs').promises;
const path = require('path');

const MIN_RESOLUTION = 256;
const MIN_FILE_SIZE_BYTES = 10000;

/**
 * Validate image quality before processing
 * @param {string} imagePath - Path to image
 * @throws {Error} if resolution too low or file appears corrupted
 */
async function validateImageQuality(imagePath) {
  const stats = await fs.stat(imagePath);
  if (stats.size < MIN_FILE_SIZE_BYTES) {
    throw new Error(`Image file too small (${stats.size} bytes) - may be corrupted`);
  }
  const metadata = await sharp(await fs.readFile(imagePath)).metadata();
  const w = metadata.width || 0;
  const h = metadata.height || 0;
  if (w < MIN_RESOLUTION || h < MIN_RESOLUTION) {
    throw new Error(`Image resolution too low (${w}x${h}) - minimum ${MIN_RESOLUTION}x${MIN_RESOLUTION} for medical analysis`);
  }
  return true;
}

/**
 * Preprocess medical image for vision encoder
 * @param {string} imagePath - Path to image
 * @param {string} modality - 'xray' | 'mri' | 'dermatology'
 * @returns {Promise<{path: string, mimeType: string, dimensions: object}>}
 */
async function preprocessImage(imagePath, modality = 'xray') {
  await validateImageQuality(imagePath);
  let buffer = await fs.readFile(imagePath);
  const metadata = await sharp(buffer).metadata();

  let pipeline = sharp(buffer);

  switch (modality) {
    case 'xray':
      pipeline = pipeline
        .normalize()
        .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
        .png();
      break;
    case 'mri':
      pipeline = pipeline
        .resize(1024, 1024, { fit: 'inside' })
        .png();
      break;
    case 'dermatology':
      pipeline = pipeline
        .resize(1024, 1024, { fit: 'inside' })
        .sharpen()
        .jpeg({ quality: 95 });
      break;
    default:
      pipeline = pipeline.resize(1024, 1024, { fit: 'inside' }).png();
  }

  const ext = modality === 'dermatology' ? '.jpg' : '.png';
  const outPath = imagePath.replace(/\.(jpg|jpeg|png|gif|webp|dcm)$/i, `_processed${ext}`);
  await pipeline.toFile(outPath);

  return {
    path: outPath,
    mimeType: modality === 'dermatology' ? 'image/jpeg' : 'image/png',
    dimensions: { width: metadata.width, height: metadata.height }
  };
}

/**
 * Encode image to base64
 */
async function encodeToBase64(imagePath) {
  const buffer = await fs.readFile(imagePath);
  return buffer.toString('base64');
}

module.exports = {
  preprocessImage,
  encodeToBase64,
  validateImageQuality
};
