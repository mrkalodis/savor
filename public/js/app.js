// Savor Core Progressive Enhancement Client JavaScript
'use strict';

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initMobileNav();
  initLiveSearch();
  initModals();
  initFavoriteButtons();
  initTagAutocompletes();

  // Register Service Worker for PWA
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
      .then(() => console.log('[PWA] Service Worker registered successfully'))
      .catch(err => console.warn('[PWA] Service Worker registration failed:', err));
  }
});

// ============================================================
// THEME MANAGER
// ============================================================
function initTheme() {
  const toggleBtn = document.getElementById('theme-toggle-btn');
  if (!toggleBtn) return;

  const sunIcon = toggleBtn.querySelector('.sun-icon');
  const moonIcon = toggleBtn.querySelector('.moon-icon');
  const html = document.documentElement;

  // Read saved theme or fallback to system preference
  let currentTheme = localStorage.getItem('savor-theme') || 'system';

  function applyTheme(theme) {
    if (theme === 'system') {
      html.removeAttribute('data-theme');
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      toggleIcons(isDark);
    } else {
      html.setAttribute('data-theme', theme);
      toggleIcons(theme === 'dark');
    }
  }

  function toggleIcons(isDark) {
    if (isDark) {
      sunIcon.style.display = 'block';
      moonIcon.style.display = 'none';
    } else {
      sunIcon.style.display = 'none';
      moonIcon.style.display = 'block';
    }
  }

  // Click handler to toggle theme
  toggleBtn.addEventListener('click', () => {
    let nextTheme;
    if (currentTheme === 'system') {
      nextTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark';
    } else if (currentTheme === 'dark') {
      nextTheme = 'light';
    } else {
      nextTheme = 'dark';
    }
    
    currentTheme = nextTheme;
    localStorage.setItem('savor-theme', currentTheme);
    applyTheme(currentTheme);
    
    // Also save to settings on server if logged in
    fetch('/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `theme=${nextTheme}`
    }).catch(() => {/* ignore background save errors */});
  });

  applyTheme(currentTheme);
}

// ============================================================
// MOBILE NAVIGATION
// ============================================================
function initMobileNav() {
  const toggleBtn = document.getElementById('mobile-menu-toggle');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  
  if (!toggleBtn || !sidebar) return;

  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = sidebar.classList.toggle('open');
    if (overlay) {
      overlay.classList.toggle('open', isOpen);
    }
  });

  // Close sidebar clicking outside
  document.addEventListener('click', (e) => {
    if (sidebar.classList.contains('open') && !sidebar.contains(e.target) && !toggleBtn.contains(e.target)) {
      sidebar.classList.remove('open');
      if (overlay) {
        overlay.classList.remove('open');
      }
    }
  });
}

// ============================================================
// LIVE SEARCH DEBOUNCED
// ============================================================
function initLiveSearch() {
  const searchInput = document.getElementById('search-input');
  const searchDropdown = document.getElementById('search-dropdown');
  if (!searchInput || !searchDropdown) return;

  let debounceTimer;

  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const query = searchInput.value.trim();

    if (!query) {
      searchDropdown.innerHTML = '';
      searchDropdown.classList.remove('open');
      return;
    }

    debounceTimer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=6`);
        if (!response.ok) return;

        const data = await response.json();
        renderSearchDropdown(data.results || []);
      } catch (err) {
        console.error('Search error:', err);
      }
    }, 250);
  });

  function renderSearchDropdown(results) {
    if (results.length === 0) {
      searchDropdown.innerHTML = `<div style="padding: 1rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">No recipes found matching query</div>`;
    } else {
      searchDropdown.innerHTML = results.map(r => `
        <div class="search-dropdown-item" onclick="window.location.href='/recipes/${r.id}'">
          ${r.image_path ? 
            `<img src="${r.image_path}" style="width: 36px; height: 36px; border-radius: 6px; object-fit: cover;">` :
            `<div style="width: 36px; height: 36px; border-radius: 6px; background: var(--primary-glow); color: var(--primary); display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: bold;">🍽️</div>`
          }
          <div style="overflow: hidden;">
            <div style="font-weight: 600; font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text-primary);">${r.title}</div>
            ${r.collection_name ? `<span style="font-size: 0.75rem; color: var(--primary);">${r.collection_name}</span>` : ''}
          </div>
        </div>
      `).join('');
    }
    searchDropdown.classList.add('open');
  }

  // Close dropdown on click outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-container')) {
      searchDropdown.classList.remove('open');
    }
  });
}

// ============================================================
// MODALS
// ============================================================
function initModals() {
  // Bind click overlays to close modals
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeModal(overlay.id);
      }
    });
  });

  // Escape key closes open modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const openModalElement = document.querySelector('.modal-overlay.open');
      if (openModalElement) {
        closeModal(openModalElement.id);
      }
    }
  });
}

window.openModal = function(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
}

window.closeModal = function(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.remove('open');
    document.body.style.overflow = '';
  }
}

// ============================================================
// FAVORITES INTERACTION (NO PAGE RELOAD)
// ============================================================
function initFavoriteButtons() {
  document.addEventListener('submit', async (e) => {
    const form = e.target.closest('.favorite-form');
    if (!form) return;

    e.preventDefault();
    const btn = form.querySelector('.favorite-btn');
    const svg = btn.querySelector('svg');

    try {
      const response = await fetch(form.action, { method: 'POST' });
      if (response.ok) {
        const isFavorited = btn.classList.toggle('active');
        if (isFavorited) {
          svg.setAttribute('fill', 'currentColor');
          showToast('Added to Favorites', 'success');
        } else {
          svg.setAttribute('fill', 'none');
          showToast('Removed from Favorites', 'success');
        }
      }
    } catch (err) {
      console.error('Favorite update failed:', err);
    }
  });
}

// ============================================================
// TAG AUTOCOMPLETE SUGGESTIONS
// ============================================================
function initTagAutocompletes() {
  const tagInput = document.getElementById('tags');
  if (!tagInput) return;

  // Add suggestion container below input dynamically
  const container = document.createElement('div');
  container.className = 'search-results-dropdown';
  container.style.width = '100%';
  tagInput.parentNode.style.position = 'relative';
  tagInput.parentNode.appendChild(container);

  let debounceTimer;

  tagInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const value = tagInput.value;
    const lastCommaIdx = value.lastIndexOf(',');
    const currentQuery = value.slice(lastCommaIdx + 1).trim();

    if (currentQuery.length < 2) {
      container.innerHTML = '';
      container.classList.remove('open');
      return;
    }

    debounceTimer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/tags/search?q=${encodeURIComponent(currentQuery)}`);
        if (!response.ok) return;

        const tags = await response.json();
        if (tags.length === 0) {
          container.classList.remove('open');
          return;
        }

        container.innerHTML = tags.map(t => `
          <div class="search-dropdown-item tag-suggestion-item" style="padding: 0.5rem 1rem; font-size: 0.85rem;">
            <span>#${t.name}</span>
          </div>
        `).join('');

        // Add suggestion click handlers
        container.querySelectorAll('.tag-suggestion-item').forEach((item, idx) => {
          item.addEventListener('click', () => {
            const tagName = tags[idx].name;
            const prefix = value.slice(0, lastCommaIdx + 1);
            tagInput.value = (prefix + (prefix ? ' ' : '') + tagName + ', ').replace(/\s+/g, ' ');
            container.innerHTML = '';
            container.classList.remove('open');
            tagInput.focus();
          });
        });

        container.classList.add('open');
      } catch (err) {
        console.error(err);
      }
    }, 200);
  });

  document.addEventListener('click', (e) => {
    if (e.target !== tagInput && !container.contains(e.target)) {
      container.classList.remove('open');
    }
  });
}

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================
window.showToast = function(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span>${message}</span>
  `;

  container.appendChild(toast);

  // Trigger fade out/removal after 3 seconds
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    toast.style.transition = 'opacity 0.4s, transform 0.4s';
    setTimeout(() => {
      toast.remove();
    }, 400);
  }, 2600);
}
