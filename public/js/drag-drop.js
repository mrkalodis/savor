// Savor Drag & Drop List Reordering (Sidebar Collections & Recipe Lists)
'use strict';

document.addEventListener('DOMContentLoaded', () => {
  initDragAndDrop('collections-list-container', 'collection');
  // Recipe drag drop is initialized inside toggling function or DOM load if visible
  const recipeContainer = document.getElementById('recipes-reorder-list');
  if (recipeContainer) {
    initDragAndDrop('recipes-reorder-list', 'recipe');
  }
});

/**
 * Initialize Drag and Drop on a target container for sortable elements.
 * @param {string} containerId ID of container
 * @param {string} type 'collection' or 'recipe'
 */
function initDragAndDrop(containerId, type) {
  const container = document.getElementById(containerId);
  if (!container) return;

  // Make list children draggable
  let draggableSelector = type === 'collection' ? '.collection-link' : '.sortable-item';
  
  // Sidebar links contain the links themselves. Make sure they are draggable
  if (type === 'collection') {
    container.querySelectorAll(draggableSelector).forEach(el => {
      el.setAttribute('draggable', 'true');
    });
  }

  let dragSrcEl = null;

  container.addEventListener('dragstart', (e) => {
    const target = e.target.closest(draggableSelector);
    if (!target) return;

    dragSrcEl = target;
    target.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', target.getAttribute('data-sortable-id'));
  });

  container.addEventListener('dragend', (e) => {
    const target = e.target.closest(draggableSelector);
    if (target) {
      target.classList.remove('dragging');
    }
    
    // Clear indicators
    container.querySelectorAll(draggableSelector).forEach(el => {
      el.classList.remove('drag-over');
    });
  });

  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    
    const target = e.target.closest(draggableSelector);
    if (!target || target === dragSrcEl) return;

    const bounding = target.getBoundingClientRect();
    const offset = e.clientY - bounding.top;
    const isAfter = offset > bounding.height / 2;

    container.querySelectorAll(draggableSelector).forEach(el => {
      el.classList.remove('drag-over');
    });
    
    target.classList.add('drag-over');
  });

  container.addEventListener('dragleave', (e) => {
    const target = e.target.closest(draggableSelector);
    if (target) {
      target.classList.remove('drag-over');
    }
  });

  container.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();

    const target = e.target.closest(draggableSelector);
    if (!target || target === dragSrcEl) return;

    target.classList.remove('drag-over');

    // Calculate insertion
    const bounding = target.getBoundingClientRect();
    const offset = e.clientY - bounding.top;
    const isAfter = offset > bounding.height / 2;

    // Move element in DOM
    if (isAfter) {
      target.parentNode.insertBefore(dragSrcEl, target.nextSibling);
    } else {
      target.parentNode.insertBefore(dragSrcEl, target);
    }

    // Trigger save callback after drag completes
    if (type === 'collection') {
      saveCollectionOrder();
    }
  });

  // Touch Support for Mobile
  container.addEventListener('touchstart', (e) => {
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;
    
    const item = e.target.closest(draggableSelector);
    if (!item) return;
    
    item.classList.add('dragging');
    dragSrcEl = item;
  }, { passive: true });

  container.addEventListener('touchmove', (e) => {
    if (!dragSrcEl) return;
    
    const touch = e.touches[0];
    const target = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!target) return;
    
    const sortableTarget = target.closest(draggableSelector);
    if (sortableTarget && sortableTarget !== dragSrcEl && container.contains(sortableTarget)) {
      e.preventDefault(); // Prevent scrolling while dragging
      
      const bounding = sortableTarget.getBoundingClientRect();
      const offset = touch.clientY - bounding.top;
      
      if (offset > bounding.height / 2) {
        sortableTarget.parentNode.insertBefore(dragSrcEl, sortableTarget.nextSibling);
      } else {
        sortableTarget.parentNode.insertBefore(dragSrcEl, sortableTarget);
      }
    }
  }, { passive: false });

  container.addEventListener('touchend', () => {
    if (dragSrcEl) {
      dragSrcEl.classList.remove('dragging');
      dragSrcEl = null;
      
      if (type === 'collection') {
        saveCollectionOrder();
      }
    }
  });
}

/**
 * Capture current sidebar order and save via PUT API to server.
 */
async function saveCollectionOrder() {
  const container = document.getElementById('collections-list-container');
  if (!container) return;

  const items = container.querySelectorAll('.collection-link');
  const ids = Array.from(items).map(item => parseInt(item.getAttribute('data-sortable-id'), 10));

  try {
    const response = await fetch('/api/collections/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ids })
    });
    
    if (response.ok) {
      // Sidebar collections have updated. Don't reload to avoid interrupting, but show toast
      showToast('Collection order saved', 'success');
    }
  } catch (err) {
    console.error('Failed to save collection order:', err);
  }
}
