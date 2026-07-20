const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { config } = require('../config');

/**
 * Save an image from a URL, resize and convert to WebP.
 * Returns the relative image path for storage in the database.
 */
async function saveFromUrl(imageUrl, recipeId) {
  if (!imageUrl) return '';

  try {
    const dir = ensureImageDir(recipeId);

    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Savor/1.0; Recipe Manager)',
        'Accept': 'image/*',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) return '';

    const buffer = Buffer.from(await response.arrayBuffer());

    // Save main image (max 1200px width)
    await sharp(buffer)
      .resize(1200, null, { withoutEnlargement: true, fit: 'inside' })
      .webp({ quality: 85 })
      .toFile(path.join(dir, 'main.webp'));

    // Save thumbnail (400px width)
    await sharp(buffer)
      .resize(400, null, { withoutEnlargement: true, fit: 'inside' })
      .webp({ quality: 75 })
      .toFile(path.join(dir, 'thumb.webp'));

    return `/images/recipes/${recipeId}/main.webp`;
  } catch (err) {
    console.error(`[ImageService] Failed to download image from ${imageUrl}:`, err.message);
    return '';
  }
}

/**
 * Save an uploaded image file (from multer), resize and convert to WebP.
 * Returns the relative image path.
 */
async function saveFromUpload(file, recipeId) {
  if (!file) return '';

  try {
    const dir = ensureImageDir(recipeId);

    // Save main image
    await sharp(file.path)
      .resize(1200, null, { withoutEnlargement: true, fit: 'inside' })
      .webp({ quality: 85 })
      .toFile(path.join(dir, 'main.webp'));

    // Save thumbnail
    await sharp(file.path)
      .resize(400, null, { withoutEnlargement: true, fit: 'inside' })
      .webp({ quality: 75 })
      .toFile(path.join(dir, 'thumb.webp'));

    // Clean up temp file
    try { fs.unlinkSync(file.path); } catch {}

    return `/images/recipes/${recipeId}/main.webp`;
  } catch (err) {
    console.error(`[ImageService] Failed to process uploaded image:`, err.message);
    try { fs.unlinkSync(file.path); } catch {}
    return '';
  }
}

/**
 * Delete all images for a recipe.
 */
function deleteImages(recipeId) {
  const dir = path.join(config.imagesDir, String(recipeId));
  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch (err) {
    console.error(`[ImageService] Failed to delete images for recipe ${recipeId}:`, err.message);
  }
}

/**
 * Ensure the image directory exists for a recipe.
 */
function ensureImageDir(recipeId) {
  const dir = path.join(config.imagesDir, String(recipeId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

module.exports = { saveFromUrl, saveFromUpload, deleteImages };
