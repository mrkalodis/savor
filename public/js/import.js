// Savor Recipe Import Workflow Handler
'use strict';

let currentImportedData = null;

document.addEventListener('DOMContentLoaded', () => {
  const importForm = document.getElementById('import-url-form');
  if (importForm) {
    importForm.addEventListener('submit', handleUrlImportSubmit);
  }

  const saveForm = document.getElementById('import-save-form');
  if (saveForm) {
    saveForm.addEventListener('submit', handleImportSaveSubmit);
  }

  // Duplicate warning buttons
  const cancelBtn = document.getElementById('duplicate-cancel-btn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      resetImportPage();
    });
  }

  const anywayBtn = document.getElementById('duplicate-anyway-btn');
  if (anywayBtn) {
    anywayBtn.addEventListener('click', () => {
      saveImportedRecipe('import');
    });
  }

  const updateBtn = document.getElementById('duplicate-update-btn');
  if (updateBtn) {
    updateBtn.addEventListener('click', () => {
      saveImportedRecipe('update');
    });
  }

  // Check if we have pre-scraped data from the bookmarklet form POST
  const preScrapedContainer = document.getElementById('pre-scraped-data');
  const preScrapedRaw = preScrapedContainer ? preScrapedContainer.getAttribute('data-recipe') : '';
  
  if (preScrapedRaw && preScrapedRaw.trim() !== '') {
    try {
      const parsedRecipe = JSON.parse(preScrapedRaw);
      currentImportedData = { recipe: parsedRecipe, duplicate: { isDuplicate: false } };
      
      populatePreviewForm(parsedRecipe);
      
      // Show preview directly
      document.getElementById('import-preview-section').style.display = 'block';
      document.getElementById('import-loading-placeholder').style.display = 'none';
      return;
    } catch (err) {
      console.warn('Failed to parse preScraped recipe details:', err.message);
    }
  }

  // Auto-trigger import if URL is pre-filled on load (e.g. via bookmarklet link)
  const urlInput = document.getElementById('import-url');
  if (urlInput && urlInput.value.trim() !== '') {
    importForm.dispatchEvent(new Event('submit'));
  }
});

/**
 * Handle URL Import Submit
 */
async function handleUrlImportSubmit(e) {
  e.preventDefault();
  
  const urlInput = document.getElementById('import-url');
  const url = urlInput.value.trim();
  if (!url) return;

  const btn = document.getElementById('import-btn');
  const spinner = document.getElementById('import-spinner');
  const previewSection = document.getElementById('import-preview-section');
  const warningSection = document.getElementById('duplicate-warning');
  const loadingPlaceholder = document.getElementById('import-loading-placeholder');

  // Set loading state
  btn.disabled = true;
  if (spinner) spinner.style.display = 'inline-block';
  loadingPlaceholder.style.display = 'block';
  previewSection.style.display = 'none';
  warningSection.style.display = 'none';

  try {
    const response = await fetch('/api/import/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Failed to fetch recipe metadata');
    }

    const data = await response.json();
    currentImportedData = data;
    
    populatePreviewForm(data.recipe);

    if (data.warning) {
      showToast(data.warning, 'warning');
    }

    // Check for duplicates
    if (data.duplicate && data.duplicate.isDuplicate) {
      showDuplicateWarning(data.duplicate);
    } else {
      loadingPlaceholder.style.display = 'none';
      previewSection.style.display = 'block';
    }

  } catch (err) {
    console.error(err);
    showToast(err.message || 'Failed to import recipe.', 'danger');
    loadingPlaceholder.style.display = 'none';
  } finally {
    btn.disabled = false;
    if (spinner) spinner.style.display = 'none';
  }
}

/**
 * Populate editable form fields with parsed recipe metadata.
 */
function populatePreviewForm(recipe) {
  document.getElementById('preview-source-url').value = recipe.sourceUrl || '';
  document.getElementById('preview-image-url').value = recipe.imageUrl || '';
  document.getElementById('preview-title').value = recipe.title || '';
  document.getElementById('preview-description').value = recipe.description || '';
  document.getElementById('preview-servings').value = recipe.servings || '';
  
  document.getElementById('preview-prep').value = recipe.prepTime || '';
  document.getElementById('preview-cook').value = recipe.cookTime || '';
  document.getElementById('preview-total').value = recipe.totalTime || '';

  // Join arrays by newline
  const ingredientsText = Array.isArray(recipe.ingredients) ? recipe.ingredients.join('\n') : '';
  const instructionsText = Array.isArray(recipe.instructions) ? recipe.instructions.join('\n') : '';
  
  document.getElementById('preview-ingredients').value = ingredientsText;
  document.getElementById('preview-instructions').value = instructionsText;
  document.getElementById('preview-notes').value = recipe.notes || '';
  
  // Tags comma-separated
  const tagsText = Array.isArray(recipe.tags) ? recipe.tags.join(', ') : '';
  document.getElementById('preview-tags').value = tagsText;

  // Handle image preview
  const img = document.getElementById('preview-image');
  const imgNone = document.getElementById('preview-image-none');
  if (recipe.imageUrl) {
    img.src = recipe.imageUrl;
    img.style.display = 'block';
    if (imgNone) imgNone.style.display = 'none';
  } else {
    img.style.display = 'none';
    if (imgNone) imgNone.style.display = 'block';
  }
}

/**
 * Show duplicate warning banner.
 */
function showDuplicateWarning(duplicate) {
  const warning = document.getElementById('duplicate-warning');
  const message = document.getElementById('duplicate-message');
  const loading = document.getElementById('import-loading-placeholder');
  const preview = document.getElementById('import-preview-section');

  let typeText = 'URL';
  if (duplicate.matchType === 'title') typeText = 'Title';
  if (duplicate.matchType === 'similar') typeText = 'Ingredients and Title similarity';

  message.innerHTML = `An existing recipe was found: <strong><a href="/recipes/${duplicate.existingRecipe.id}" target="_blank" style="color:var(--primary);text-decoration:underline;">${duplicate.existingRecipe.title}</a></strong>.<br>Matched by: ${typeText} (confidence ${Math.round(duplicate.confidence * 100)}%).`;
  
  loading.style.display = 'none';
  warning.style.display = 'block';
  // Also show preview so the user can see what they are importing/updating
  preview.style.display = 'block';
}

/**
 * Handle Save Form submit directly.
 */
async function handleImportSaveSubmit(e) {
  e.preventDefault();
  // Standard save (action is skip/create new)
  saveImportedRecipe('skip');
}

/**
 * Send parsed recipe data + action selection to server.
 */
async function saveImportedRecipe(action) {
  const saveBtn = document.getElementById('save-import-btn');
  saveBtn.disabled = true;

  // Grab values from preview inputs
  const title = document.getElementById('preview-title').value.trim();
  const description = document.getElementById('preview-description').value.trim();
  const collectionId = document.getElementById('preview-collection').value;
  const servings = document.getElementById('preview-servings').value.trim();
  
  const prepTime = document.getElementById('preview-prep').value;
  const cookTime = document.getElementById('preview-cook').value;
  const totalTime = document.getElementById('preview-total').value;

  // Parse newlines back to arrays
  const ingredients = document.getElementById('preview-ingredients').value
    .split('\n')
    .map(i => i.trim())
    .filter(Boolean);

  const instructions = document.getElementById('preview-instructions').value
    .split('\n')
    .map(i => i.trim())
    .filter(Boolean);

  const notes = document.getElementById('preview-notes').value.trim();
  
  // Parse tags back to array
  const tags = document.getElementById('preview-tags').value
    .split(',')
    .map(t => t.trim())
    .filter(Boolean);

  const sourceUrl = document.getElementById('preview-source-url').value;
  const imageUrl = document.getElementById('preview-image-url').value;

  const payload = {
    duplicate_action: action,
    title,
    description,
    collection_id: collectionId ? parseInt(collectionId, 10) : null,
    servings,
    prep_time: prepTime ? parseInt(prepTime, 10) : null,
    cook_time: cookTime ? parseInt(cookTime, 10) : null,
    total_time: totalTime ? parseInt(totalTime, 10) : null,
    ingredients,
    instructions,
    notes,
    tags,
    source_url: sourceUrl,
    image_url: imageUrl
  };

  try {
    const response = await fetch('/api/import/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Failed to save recipe');
    }

    const data = await response.json();
    if (data.skipped) {
      showToast('Import cancelled (duplicate skipped)', 'success');
      window.location.href = `/recipes/${data.existingRecipe.id}`;
    } else if (data.recipe) {
      showToast(data.updated ? 'Recipe updated successfully!' : 'Recipe imported successfully!', 'success');
      window.location.href = `/recipes/${data.recipe.id}`;
    }

  } catch (err) {
    console.error(err);
    showToast(err.message || 'Failed to save imported recipe.', 'danger');
    saveBtn.disabled = false;
  }
}

/**
 * Reset Import Page
 */
window.resetImportPage = function() {
  document.getElementById('import-url').value = '';
  document.getElementById('import-preview-section').style.display = 'none';
  document.getElementById('duplicate-warning').style.display = 'none';
  document.getElementById('import-loading-placeholder').style.display = 'none';
  currentImportedData = null;
}
