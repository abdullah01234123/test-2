(() => {
  'use strict';
  const form = document.getElementById('catalog-filter');
  if (!form) return;

  const search = document.getElementById('catalog-search');
  const type = document.getElementById('type-filter');
  const genre = document.getElementById('genre-filter');
  const grid = document.getElementById('all-title-grid');
  const cards = grid ? Array.from(grid.querySelectorAll('[data-title-card]')) : [];
  const count = document.getElementById('results-count');
  const noResults = document.getElementById('no-results');
  const robots = document.querySelector('meta[name="robots"]');
  const params = new URLSearchParams(window.location.search);

  if (!grid || !cards.length) return;

  if (search) search.value = params.get('q') || '';
  if (type) type.value = params.get('type') || '';
  if (genre) genre.value = params.get('genre') || '';

  function updateRobots() {
    const hasFilters = Boolean(
      (search && search.value.trim()) ||
      (type && type.value) ||
      (genre && genre.value)
    );
    if (robots) robots.content = hasFilters ? 'noindex,follow' : 'index,follow';
  }

  function applyFilters(updateUrl = false) {
    const q = (search ? search.value : '').trim().toLocaleLowerCase();
    const selectedType = type ? type.value : '';
    const selectedGenre = genre ? genre.value.toLocaleLowerCase() : '';
    let shown = 0;

    for (const card of cards) {
      const haystack = (card.dataset.search || '').toLocaleLowerCase();
      const cardType = card.dataset.type || '';
      const cardGenres = (card.dataset.genres || '').toLocaleLowerCase().split('|');
      const match = (!q || haystack.includes(q)) &&
        (!selectedType || selectedType === cardType) &&
        (!selectedGenre || cardGenres.includes(selectedGenre));
      card.hidden = !match;
      if (match) shown++;
    }

    if (count) count.textContent = `${shown} ${shown === 1 ? 'title' : 'titles'}`;
    if (noResults) noResults.hidden = shown !== 0;
    updateRobots();

    if (updateUrl) {
      const url = new URL(window.location.href);
      for (const [key, value] of [
        ['q', search ? search.value.trim() : ''],
        ['type', type ? type.value : ''],
        ['genre', genre ? genre.value : '']
      ]) {
        if (value) url.searchParams.set(key, value);
        else url.searchParams.delete(key);
      }
      window.history.replaceState({}, '', url);
    }
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    applyFilters(true);
  });
  for (const control of [search, type, genre]) {
    if (!control) continue;
    control.addEventListener(control === search ? 'input' : 'change', () => applyFilters(true));
  }
  applyFilters(false);
})();
