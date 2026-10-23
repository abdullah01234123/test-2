#!/usr/bin/env node
/**
 * HDHub4u full static-site builder.
 * Uses TMDB only at build time; the API key is never shipped to the browser.
 * Requires Node.js 20+. No npm dependencies.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'dist');
const TMDB_BASE = String(process.env.TMDB_API_BASE || 'https://api.themoviedb.org/3').replace(/\/$/, '');
const TMDB_IMAGE = 'https://image.tmdb.org/t/p';
const GENERATED_AT = new Date().toISOString();

const GENRE_NAMES = {
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime',
  99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History',
  27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Science Fiction',
  10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western',
  10759: 'Action & Adventure', 10762: 'Kids', 10763: 'News', 10764: 'Reality',
  10765: 'Sci-Fi & Fantasy', 10766: 'Soap', 10767: 'Talk', 10768: 'War & Politics'
};

const LANGUAGES = {
  en: 'English', ur: 'Urdu', hi: 'Hindi', fr: 'French', es: 'Spanish', de: 'German',
  ja: 'Japanese', ko: 'Korean', it: 'Italian', pt: 'Portuguese', ar: 'Arabic', zh: 'Chinese',
  tr: 'Turkish', ru: 'Russian', th: 'Thai', id: 'Indonesian', ta: 'Tamil', te: 'Telugu',
  bn: 'Bengali', pa: 'Punjabi', fa: 'Persian', pl: 'Polish', nl: 'Dutch', sv: 'Swedish',
  da: 'Danish', no: 'Norwegian', fi: 'Finnish', he: 'Hebrew', vi: 'Vietnamese', ms: 'Malay'
};

const SOCIALS = [
  ['Facebook', 'FB'], ['X', 'X'], ['Instagram', 'IG'], ['YouTube', 'YT'],
  ['TikTok', 'TT'], ['LinkedIn', 'in']
];

function fail(message) {
  console.error(`\nBuild failed: ${message}\n`);
  process.exitCode = 1;
  throw new Error(message);
}

function esc(value = '') {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
}

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

function slugFilter(value = '') {
  return String(value).trim().toLocaleLowerCase();
}

function safeUrl(value, fallback = '') {
  try {
    const u = new URL(value);
    if (u.protocol === 'https:' || u.protocol === 'http:') return u.href;
  } catch { /* use fallback */ }
  return fallback;
}

function makeSiteUrl(raw) {
  if (!raw) {
    throw new Error('Missing SITE_URL. Add a GitHub Actions repository variable named SITE_URL, e.g. https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/.');
  }
  let url;
  try { url = new URL(raw); } catch { throw new Error('SITE_URL must be a complete URL such as https://username.github.io/repository/.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.search || url.hash) {
    throw new Error('SITE_URL must be an absolute HTTP(S) URL without a query string or fragment.');
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.href;
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw new Error(`Cannot read ${path.relative(ROOT, file)}: ${error.message}`);
  }
}

async function readText(file) {
  return fs.readFile(file, 'utf8');
}

function template(source, replacements) {
  let out = source;
  for (const [key, value] of Object.entries(replacements)) {
    out = out.replaceAll(`{{${key}}}`, String(value ?? ''));
  }
  return out;
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function tmdb(endpoint, apiKey, query = {}) {
  const url = new URL(`${TMDB_BASE}${endpoint}`);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('language', 'en-US');
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }

  let lastError;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': 'HDHub4u-Static-Builder/1.0' },
        signal: AbortSignal.timeout(25000)
      });
      if (response.ok) return await response.json();
      let detail = '';
      try { detail = (await response.json()).status_message || ''; } catch { /* ignore */ }
      const error = new Error(`TMDB returned HTTP ${response.status} for ${endpoint}${detail ? `: ${detail}` : ''}`);
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 3) throw error;
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 800 * (attempt + 1)));
    } catch (error) {
      lastError = error;
      if (attempt === 3 || /HTTP (401|403|404)/.test(error.message)) break;
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw lastError || new Error(`TMDB request failed for ${endpoint}`);
}

function normalizeDiscovery(raw, mediaType) {
  const isMovie = mediaType === 'movie';
  const title = String(isMovie ? (raw.title || raw.original_title || '') : (raw.name || raw.original_name || '')).trim();
  const id = Number(raw.id);
  if (!title || !Number.isFinite(id) || id <= 0) return null;
  const releaseDate = String(isMovie ? raw.release_date || '' : raw.first_air_date || '');
  const genreNames = Array.isArray(raw.genre_ids) ? raw.genre_ids.map(id => GENRE_NAMES[id]).filter(Boolean) : [];
  return {
    id, slug: `${mediaType}-${id}`, mediaType, title,
    originalTitle: String(isMovie ? raw.original_title || title : raw.original_name || title),
    overview: String(raw.overview || '').trim(),
    tagline: '', releaseDate: /^\d{4}-\d{2}-\d{2}$/.test(releaseDate) ? releaseDate : '',
    year: /^\d{4}/.test(releaseDate) ? Number(releaseDate.slice(0, 4)) : null,
    genres: genreNames, genreIds: Array.isArray(raw.genre_ids) ? raw.genre_ids : [],
    languageCode: String(raw.original_language || 'en').toLowerCase(),
    language: LANGUAGES[String(raw.original_language || 'en').toLowerCase()] || String(raw.original_language || 'en').toUpperCase(),
    poster: raw.poster_path ? `${TMDB_IMAGE}/w500${raw.poster_path}` : '',
    backdrop: raw.backdrop_path ? `${TMDB_IMAGE}/w1280${raw.backdrop_path}` : '',
    voteAverage: Number(raw.vote_average || 0), voteCount: Number(raw.vote_count || 0), popularity: Number(raw.popularity || 0),
    runtime: null, episodeRuntime: [], status: '', numberOfSeasons: null, numberOfEpisodes: null,
    productionCompanies: [], productionCountries: [], networks: [], spokenLanguages: [],
    cast: [], director: '', creators: [], trailer: null, imdbId: '',
    editorialSummary: '', whyWorthWatching: ''
  };
}

async function fetchCatalog(apiKey, pages, maxTitles) {
  const jobs = [];
  for (let page = 1; page <= pages; page++) {
    jobs.push({ endpoint: '/trending/all/week', type: null, page });
    jobs.push({ endpoint: '/movie/popular', type: 'movie', page });
    jobs.push({ endpoint: '/tv/popular', type: 'tv', page });
  }
  const responses = await mapLimit(jobs, 4, async job => {
    const data = await tmdb(job.endpoint, apiKey, { page: job.page });
    return { ...job, results: Array.isArray(data.results) ? data.results : [] };
  });

  const bySlug = new Map();
  for (const response of responses) {
    for (const raw of response.results) {
      const mediaType = response.type || (raw.media_type === 'movie' || raw.media_type === 'tv' ? raw.media_type : '');
      if (!mediaType || raw.media_type === 'person') continue;
      const item = normalizeDiscovery(raw, mediaType);
      if (!item) continue;
      const existing = bySlug.get(item.slug);
      if (!existing || item.overview.length > existing.overview.length) bySlug.set(item.slug, item);
    }
  }

  const items = Array.from(bySlug.values())
    .sort((a, b) => b.popularity - a.popularity)
    .slice(0, maxTitles);
  if (!items.length) throw new Error('TMDB returned no movie or TV results. Check the API key and TMDB status.');
  return items;
}

async function enrichItem(item, apiKey, region) {
  const kind = item.mediaType;
  const base = `/${kind}/${item.id}`;
  const [detailsResult, creditsResult, videosResult] = await Promise.allSettled([
    tmdb(base, apiKey, { append_to_response: 'external_ids' }),
    tmdb(`${base}/credits`, apiKey),
    tmdb(`${base}/videos`, apiKey)
  ]);

  if (detailsResult.status === 'fulfilled') {
    const d = detailsResult.value;
    item.title = String(kind === 'movie' ? (d.title || d.original_title || item.title) : (d.name || d.original_name || item.title));
    item.originalTitle = String(kind === 'movie' ? (d.original_title || item.originalTitle) : (d.original_name || item.originalTitle));
    item.overview = String(d.overview || item.overview || '').trim();
    item.tagline = String(d.tagline || '').trim();
    const date = String(kind === 'movie' ? d.release_date || '' : d.first_air_date || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) item.releaseDate = date;
    item.year = /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : item.year;
    item.genres = Array.isArray(d.genres) ? d.genres.map(g => g.name).filter(Boolean) : item.genres;
    item.genreIds = Array.isArray(d.genres) ? d.genres.map(g => g.id).filter(Number.isFinite) : item.genreIds;
    item.languageCode = String(d.original_language || item.languageCode || 'en').toLowerCase();
    item.language = LANGUAGES[item.languageCode] || item.languageCode.toUpperCase();
    item.poster = d.poster_path ? `${TMDB_IMAGE}/w500${d.poster_path}` : item.poster;
    item.backdrop = d.backdrop_path ? `${TMDB_IMAGE}/w1280${d.backdrop_path}` : item.backdrop;
    item.voteAverage = Number(d.vote_average ?? item.voteAverage ?? 0);
    item.voteCount = Number(d.vote_count ?? item.voteCount ?? 0);
    item.status = String(d.status || '');
    item.runtime = Number(d.runtime || 0) || null;
    item.episodeRuntime = Array.isArray(d.episode_run_time) ? d.episode_run_time.filter(n => Number(n) > 0).map(Number) : [];
    item.numberOfSeasons = Number(d.number_of_seasons || 0) || null;
    item.numberOfEpisodes = Number(d.number_of_episodes || 0) || null;
    item.productionCompanies = Array.isArray(d.production_companies) ? d.production_companies.map(x => x.name).filter(Boolean).slice(0, 6) : [];
    item.productionCountries = Array.isArray(d.production_countries) ? d.production_countries.map(x => x.name).filter(Boolean).slice(0, 5) : [];
    item.networks = Array.isArray(d.networks) ? d.networks.map(x => x.name).filter(Boolean).slice(0, 5) : [];
    item.spokenLanguages = Array.isArray(d.spoken_languages) ? d.spoken_languages.map(x => x.english_name || x.name).filter(Boolean).slice(0, 8) : [];
    item.imdbId = String(d.imdb_id || d.external_ids?.imdb_id || '');
    item.createdBy = Array.isArray(d.created_by) ? d.created_by.map(x => x.name).filter(Boolean).slice(0, 5) : [];
  } else {
    console.warn(`Warning: detail lookup failed for ${item.slug}; using catalogue details.`);
  }

  if (creditsResult.status === 'fulfilled') {
    const c = creditsResult.value;
    item.cast = Array.isArray(c.cast) ? c.cast.slice(0, 8).map(person => ({
      id: Number(person.id || 0),
      name: String(person.name || ''),
      character: String(person.character || ''),
      profile: person.profile_path ? `${TMDB_IMAGE}/w185${person.profile_path}` : ''
    })).filter(x => x.name) : [];
    const directors = Array.isArray(c.crew) ? c.crew.filter(person => person.job === 'Director').map(person => person.name).filter(Boolean) : [];
    item.director = [...new Set(directors)].slice(0, 3).join(', ');
    if (!item.director && item.createdBy?.length) item.director = item.createdBy.join(', ');
  } else {
    console.warn(`Warning: credits lookup failed for ${item.slug}.`);
    item.cast = [];
  }

  if (videosResult.status === 'fulfilled') {
    const videos = Array.isArray(videosResult.value.results) ? videosResult.value.results : [];
    const candidates = videos.filter(v => v.site === 'YouTube' && v.key && ['Trailer', 'Teaser'].includes(v.type));
    const official = candidates.find(v => v.official && v.type === 'Trailer') || candidates.find(v => v.type === 'Trailer') || candidates[0];
    if (official) item.trailer = { name: String(official.name || 'Official trailer'), key: String(official.key), url: `https://www.youtube.com/watch?v=${encodeURIComponent(official.key)}` };
  }

  item.poster ||= '';
  item.genres = [...new Set(item.genres || [])];
  item.runtimeLabel = item.mediaType === 'movie'
    ? (item.runtime ? `${item.runtime} min` : 'Not listed')
    : (item.episodeRuntime.length ? `${item.episodeRuntime[0]} min per episode` : 'Episode runtime not listed');
  item.region = region;
  return item;
}

function titleUrl(item, siteUrl) {
  return new URL(`titles/${encodeURIComponent(item.slug)}/`, siteUrl).href;
}

function localUrl(siteUrl, pathname = '') {
  return new URL(pathname, siteUrl).href;
}

function dateLabel(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return 'Not listed';
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function cardHtml(item, siteUrl) {
  const url = titleUrl(item, siteUrl);
  const poster = item.poster || localUrl(siteUrl, 'assets/poster-placeholder.svg');
  const genres = item.genres || [];
  const search = [item.title, item.originalTitle, item.overview, item.tagline, genres.join(' '), (item.cast || []).map(x => x.name).join(' '), item.year].filter(Boolean).join(' ');
  const format = item.mediaType === 'movie' ? 'MOVIE' : 'TV SERIES';
  const rating = Number(item.voteAverage) > 0 ? Number(item.voteAverage).toFixed(1) : '—';
  return `<article class="title-card" data-title-card data-type="${esc(item.mediaType)}" data-genres="${esc(genres.map(slugFilter).join('|'))}" data-search="${esc(search)}">
    <a class="card-poster-link" href="${esc(url)}" aria-label="View ${esc(item.title)} details">
      <img class="card-poster" src="${esc(poster)}" alt="${esc(item.title)} poster" width="342" height="513" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${esc(localUrl(siteUrl, 'assets/poster-placeholder.svg'))}'">
      <span class="format-badge">${format}</span>
    </a>
    <div class="card-body">
      <div class="card-kicker"><span>${esc(item.year || 'Year not listed')}</span><span aria-hidden="true">·</span><span>${esc(item.language || 'Unknown')}</span></div>
      <h3 class="card-title"><a href="${esc(url)}">${esc(item.title)}</a></h3>
      <span class="card-genres">${esc(genres.slice(0, 2).join(' · ') || (item.mediaType === 'movie' ? 'Movie guide' : 'Series guide'))}</span>
      <div class="card-foot"><span>${item.mediaType === 'movie' ? 'Movie guide' : 'Series guide'}</span><span class="card-rating" aria-label="TMDB community score">★ ${esc(rating)}</span></div>
    </div>
  </article>`;
}

function headerHtml(siteUrl, siteName, current = '') {
  return `<header class="site-header"><div class="header-inner">
    <a class="brand" href="${esc(siteUrl)}" aria-label="${esc(siteName)} home"><img src="${esc(localUrl(siteUrl, 'assets/logo.svg'))}" width="37" height="37" alt=""><span class="brand-word">HDHub<span>4u</span></span></a>
    <nav class="main-nav" aria-label="Main navigation"><a href="${esc(siteUrl)}"${current === 'home' ? ' aria-current="page"' : ''}>Home</a><a href="${esc(localUrl(siteUrl, 'all-titles/'))}"${current === 'all' ? ' aria-current="page"' : ''}>All titles</a><a href="${esc(localUrl(siteUrl, 'about/'))}"${current === 'about' ? ' aria-current="page"' : ''}>About</a></nav>
    <form class="header-search" action="${esc(localUrl(siteUrl, 'all-titles/'))}" method="get" role="search"><label class="visually-hidden" for="header-search-input">Search the catalogue</label><input id="header-search-input" name="q" type="search" placeholder="Search titles…" autocomplete="off"><button type="submit" aria-label="Search">⌕</button></form>
  </div></header>`;
}

function footerHtml(siteUrl, config) {
  const siteName = config.siteName || 'HDHub4u';
  const social = SOCIALS.map(([name, short]) => {
    const href = safeUrl(config.socialLinks?.[name], '');
    if (!href) return '';
    return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(name)}" title="${esc(name)}">${esc(short)}</a>`;
  }).join('');
  return `<footer class="site-footer"><div class="wrap footer-main">
    <div class="footer-brand"><a class="brand" href="${esc(siteUrl)}"><img src="${esc(localUrl(siteUrl, 'assets/logo.svg'))}" width="37" height="37" alt=""><span class="brand-word">HDHub<span>4u</span></span></a><p>An independent movie and TV discovery guide with synopsis, cast information, release details, trailers, and related titles. We do not host video files or unauthorized copies.</p></div>
    <div><p class="footer-heading">Explore</p><nav class="footer-links" aria-label="Footer navigation"><a href="${esc(siteUrl)}">Home</a><a href="${esc(localUrl(siteUrl, 'all-titles/'))}">All titles</a><a href="${esc(localUrl(siteUrl, 'about/'))}">About us</a><a href="${esc(localUrl(siteUrl, 'privacy/'))}">Privacy policy</a><a href="${esc(localUrl(siteUrl, 'disclaimer/'))}">Disclaimer</a></nav></div>
    <div><p class="footer-heading">Follow on social media</p><div class="social-links">${social || '<span class="muted-small">Add your profile URLs in site-config.json.</span>'}</div><p class="tmdb-attribution"><a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer" aria-label="The Movie Database">TMDB</a><span>This product uses the TMDB API but is not endorsed or certified by TMDB.</span></p></div>
  </div><div class="wrap footer-bottom"><p>© ${new Date().getUTCFullYear()} ${esc(siteName)}. For information and discovery purposes.</p><p>External links open third-party websites.</p></div></footer>`;
}

function headMeta({ title, description, canonical, image, robots, siteName, verification = '' }) {
  const rows = [
    `<meta name="description" content="${esc(description)}">`,
    `<meta name="robots" content="${esc(robots || 'index,follow')}">`,
    `<link rel="canonical" href="${esc(canonical)}">`,
    `<meta property="og:site_name" content="${esc(siteName)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${esc(canonical)}">`,
    `<meta property="og:image" content="${esc(image || '')}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
    `<meta name="twitter:image" content="${esc(image || '')}">`
  ];
  if (verification.trim()) rows.push(`<meta name="google-site-verification" content="${esc(verification.trim())}">`);
  return rows.join('\n  ');
}

function structuredData(value) {
  return `<script type="application/ld+json">${safeJson(value)}</script>`;
}

function websiteSchema(siteUrl, config, items) {
  const graph = [
    { '@type': 'WebSite', '@id': `${siteUrl}#website`, url: siteUrl, name: config.siteName, description: config.description, inLanguage: 'en' },
    { '@type': 'Organization', '@id': `${siteUrl}#organization`, name: config.siteName, url: siteUrl, description: config.description },
    { '@type': 'ItemList', name: `${config.siteName} movie and TV guide catalogue`, itemListOrder: 'https://schema.org/ItemListOrderAscending', numberOfItems: items.length, itemListElement: items.slice(0, 24).map((item, index) => ({ '@type': 'ListItem', position: index + 1, url: titleUrl(item, siteUrl), name: item.title })) }
  ];
  return { '@context': 'https://schema.org', '@graph': graph };
}

function titleSchema(item, siteUrl, config) {
  const entity = {
    '@type': item.mediaType === 'movie' ? 'Movie' : 'TVSeries',
    '@id': `${titleUrl(item, siteUrl)}#title`,
    name: item.title,
    url: titleUrl(item, siteUrl),
    description: item.overview,
    image: item.poster || localUrl(siteUrl, 'assets/poster-placeholder.svg'),
    genre: item.genres || [],
    inLanguage: item.languageCode || 'en'
  };
  if (item.releaseDate) entity.dateCreated = item.releaseDate;
  if (item.director) entity.director = item.director.split(', ').map(name => ({ '@type': 'Person', name }));
  if (item.cast?.length) entity.actor = item.cast.slice(0, 8).map(person => ({ '@type': 'Person', name: person.name }));
  if (item.runtime && item.mediaType === 'movie') entity.duration = `PT${item.runtime}M`;
  if (item.mediaType === 'tv' && item.numberOfSeasons) entity.numberOfSeasons = item.numberOfSeasons;
  const crumb = {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: 'All titles', item: localUrl(siteUrl, 'all-titles/') },
      { '@type': 'ListItem', position: 3, name: item.title, item: titleUrl(item, siteUrl) }
    ]
  };
  return { '@context': 'https://schema.org', '@graph': [entity, crumb] };
}

function truncate(text, max = 158) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

function genreOptions(items) {
  const genres = [...new Set(items.flatMap(item => item.genres || []))].sort((a, b) => a.localeCompare(b));
  return genres.map(genre => `<option value="${esc(slugFilter(genre))}">${esc(genre)}</option>`).join('\n');
}

function relatedTitles(item, items, limit = 5) {
  return items.filter(other => other.slug !== item.slug).map(other => {
    const shared = (item.genres || []).filter(genre => (other.genres || []).includes(genre)).length;
    const sameType = other.mediaType === item.mediaType ? 1 : 0;
    return { item: other, score: shared * 4 + sameType + Math.min(1.5, Number(other.voteAverage || 0) / 10) };
  }).sort((a, b) => b.score - a.score || b.item.popularity - a.item.popularity)
    .slice(0, limit).map(record => record.item);
}

function fact(label, value) {
  if (value === undefined || value === null || String(value).trim() === '' || value === 'Not listed') return '';
  return `<div class="fact-item"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
}

function titleBody(item, items, siteUrl, overrides) {
  const label = item.mediaType === 'movie' ? 'Movie' : 'TV Series';
  const yearSuffix = item.year ? `(${item.year})` : '';
  const genres = item.genres || [];
  const genreLinks = genres.map(genre => `<a class="genre-chip" href="${esc(`${localUrl(siteUrl, 'all-titles/')}?genre=${encodeURIComponent(slugFilter(genre))}`)}">${esc(genre)}</a>`).join('');
  const metaBits = [item.year ? String(item.year) : '', label, item.runtimeLabel, item.language].filter(Boolean);
  const detailMeta = metaBits.map((value, index) => `${index ? '<span class="meta-dot" aria-hidden="true"></span>' : ''}<span>${esc(value)}</span>`).join('');
  const ratingHtml = item.voteAverage > 0
    ? `<div class="rating-row"><span class="rating-star" aria-hidden="true">★</span><span class="rating-value">${Number(item.voteAverage).toFixed(1)}<span class="visually-hidden"> out of 10</span></span><span class="rating-label">TMDB community score${item.voteCount ? ` · ${Number(item.voteCount).toLocaleString('en-US')} votes` : ''}</span></div>`
    : '';
  const facts = [
    fact('Release date', dateLabel(item.releaseDate)),
    fact('Format', label),
    fact('Runtime', item.mediaType === 'movie' ? item.runtimeLabel : item.runtimeLabel),
    fact('Original language', item.language),
    fact('Genres', genres.join(', ')),
    fact('Status', item.status),
    fact(item.mediaType === 'movie' ? 'Director' : 'Creator', item.director || (item.createdBy || []).join(', ')),
    fact('Production companies', (item.productionCompanies || []).join(', ')),
    fact('Production countries', (item.productionCountries || []).join(', ')),
    fact('Spoken languages', (item.spokenLanguages || []).join(', ')),
    item.mediaType === 'tv' ? fact('Seasons', item.numberOfSeasons) : '',
    item.mediaType === 'tv' ? fact('Episodes', item.numberOfEpisodes) : '',
    item.networks?.length ? fact('Networks', item.networks.join(', ')) : '',
    item.imdbId ? fact('IMDb ID', item.imdbId) : ''
  ].filter(Boolean).join('\n');
  const cast = (item.cast || []).slice(0, 8);
  const castSection = cast.length ? `<section class="cast-section" aria-labelledby="cast-heading"><div class="section-heading"><div><p class="eyebrow">CAST &amp; CREDITS</p><h2 id="cast-heading">Cast</h2><p class="section-subtitle">Cast credits sourced from TMDB.</p></div></div><div class="cast-grid">${cast.map(person => `<article class="cast-card"><img src="${esc(person.profile || localUrl(siteUrl, 'assets/poster-placeholder.svg'))}" alt="${esc(person.name)}" width="185" height="247" loading="lazy" onerror="this.onerror=null;this.src='${esc(localUrl(siteUrl, 'assets/poster-placeholder.svg'))}'"><div class="cast-info"><span class="cast-name">${esc(person.name)}</span><span class="cast-role">${esc(person.character || 'Cast')}</span></div></article>`).join('')}</div></section>` : '';
  const trailerSection = item.trailer ? `<section class="trailer-section" aria-labelledby="trailer-heading"><div class="section-heading"><div><p class="eyebrow">WATCH A PREVIEW</p><h2 id="trailer-heading">Trailer</h2></div></div><a class="trailer-card" href="${esc(item.trailer.url)}" target="_blank" rel="noopener noreferrer"><span class="play-icon" aria-hidden="true">▶</span><span><span class="trailer-label">${esc(item.trailer.name)}</span><span class="trailer-caption">Open on YouTube ↗</span></span></a></section>` : '';

  const override = overrides[item.slug] && typeof overrides[item.slug] === 'object' ? overrides[item.slug] : {};
  const editorialSummary = String(override.editorialSummary || item.editorialSummary || '').trim();
  const whyWorthWatching = String(override.whyWorthWatching || item.whyWorthWatching || '').trim();
  const editorialSection = (editorialSummary || whyWorthWatching)
    ? `<section class="editorial-panel"><p class="eyebrow">EDITORIAL GUIDE</p><h2>More about ${esc(item.title)}</h2>${editorialSummary ? `<p>${esc(editorialSummary)}</p>` : ''}${whyWorthWatching ? `<h3>Who might enjoy it?</h3><p>${esc(whyWorthWatching)}</p>` : ''}</section>`
    : '';

  const region = String(item.region || 'PK').toLowerCase();
  const justwatch = `https://www.justwatch.com/${encodeURIComponent(region)}/search?q=${encodeURIComponent(item.title)}`;
  const tmdbUrl = `https://www.themoviedb.org/${item.mediaType === 'movie' ? 'movie' : 'tv'}/${item.id}`;
  const overview = item.overview || 'A full synopsis has not been supplied by the metadata source yet. See the source listing for the latest available information.';
  const relatedCards = relatedTitles(item, items).map(related => cardHtml(related, siteUrl)).join('\n');

  return {
    TITLE: esc(item.title),
    YEAR_SUFFIX: esc(yearSuffix),
    POSTER: esc(item.poster || localUrl(siteUrl, 'assets/poster-placeholder.svg')),
    FORMAT_LABEL: esc(label),
    TAGLINE_HTML: item.tagline ? `<p class="tagline">${esc(item.tagline)}</p>` : '',
    DETAIL_META: detailMeta,
    RATING_HTML: ratingHtml,
    OVERVIEW: esc(overview),
    GENRE_LINKS: genreLinks,
    FACTS: facts,
    CAST_SECTION: castSection,
    TRAILER_SECTION: trailerSection,
    EDITORIAL_SECTION: editorialSection,
    RELATED_CARDS: relatedCards,
    TMDB_URL: esc(tmdbUrl),
    JUSTWATCH_URL: esc(justwatch)
  };
}

function xmlEscape(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function makeSitemap(siteUrl, items, indexable) {
  const urls = [
    siteUrl,
    localUrl(siteUrl, 'all-titles/'),
    localUrl(siteUrl, 'about/'),
    localUrl(siteUrl, 'privacy/'),
    localUrl(siteUrl, 'disclaimer/'),
    ...items.filter(item => indexable.has(item.slug)).map(item => titleUrl(item, siteUrl))
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(url => `  <url><loc>${xmlEscape(url)}</loc></url>`).join('\n')}\n</urlset>\n`;
}

function makeReport(siteUrl, items, indexable) {
  const indexed = items.filter(item => indexable.has(item.slug));
  const noindex = items.filter(item => !indexable.has(item.slug));
  return `# ${'HDHub4u'} SEO build report\n\n- Build time (UTC): ${GENERATED_AT}\n- Website URL: ${siteUrl}\n- Title pages generated: ${items.length}\n- Title pages included in sitemap: ${indexed.length}\n- Title pages marked noindex (overview missing/short or poster unavailable): ${noindex.length}\n- All titles page: ${localUrl(siteUrl, 'all-titles/')}\n- Sitemap: ${localUrl(siteUrl, 'sitemap.xml')}\n\n## Pages eligible for indexing\n\n${indexed.length ? indexed.map(item => `- [${item.title}](${titleUrl(item, siteUrl)})`).join('\n') : 'No title pages passed the overview quality check.'}\n\n## Pages needing metadata\n\n${noindex.length ? noindex.map(item => `- ${item.title} (${item.slug}) — synopsis is missing/short, or the poster image is unavailable.`).join('\n') : 'None.'}\n\nThe overview gate is a basic completeness check, not a Google ranking guarantee. Review title pages, copyright permissions, TMDB attribution, and the Google Search Console URL Inspection report before scaling the catalogue.\n`;
}

async function generate() {
  const config = await readJson(path.join(ROOT, 'site-config.json'), null);
  if (!config || typeof config !== 'object') throw new Error('site-config.json is missing or invalid.');
  const siteName = 'HDHub4u';
  config.siteName = siteName;
  const siteUrl = makeSiteUrl(process.env.SITE_URL || config.siteUrl || '');
  const apiKey = String(process.env.TMDB_API_KEY || '').trim();
  if (!apiKey) throw new Error('TMDB_API_KEY is missing. Add a TMDB v3 API key as a GitHub Actions secret. Do not put the key in HTML or JavaScript.');
  if (/^eyJ[A-Za-z0-9_-]{30,}/.test(apiKey)) throw new Error('TMDB_API_KEY looks like a v4 Read Access Token. Use the TMDB v3 API Key instead; the builder uses the api_key query parameter.');

  const pages = Math.max(1, Math.min(10, Number.parseInt(process.env.TMDB_PAGES || config.catalogPages || '2', 10) || 2));
  const maxTitles = Math.max(10, Math.min(500, Number.parseInt(process.env.MAX_TITLES || config.maxTitles || '80', 10) || 80));
  const region = String(process.env.TMDB_REGION || config.defaultRegion || 'PK').toUpperCase();
  const overrides = await readJson(path.join(ROOT, 'seo-overrides.json'), {});

  console.log(`Building ${siteName} for ${siteUrl}`);
  console.log(`Fetching TMDB catalogue (pages per endpoint: ${pages}; title cap: ${maxTitles})…`);
  const discovered = await fetchCatalog(apiKey, pages, maxTitles);
  console.log(`Enriching ${discovered.length} unique titles with details, cast credits, and trailers…`);
  const items = await mapLimit(discovered, 4, async (item, index) => {
    const enriched = await enrichItem(item, apiKey, region);
    const override = overrides[enriched.slug] && typeof overrides[enriched.slug] === 'object' ? overrides[enriched.slug] : {};
    enriched.editorialSummary = String(override.editorialSummary || '').trim();
    enriched.whyWorthWatching = String(override.whyWorthWatching || '').trim();
    enriched.indexable = enriched.overview.length >= 80;
    if ((index + 1) % 10 === 0 || index + 1 === discovered.length) console.log(`  Processed ${index + 1}/${discovered.length}`);
    return enriched;
  });

  const templatesDir = path.join(ROOT, 'templates');
  const assetDir = path.join(ROOT, 'assets');
  const required = ['home.html', 'all-titles.html', 'title.html', 'static.html'];
  for (const filename of required) await fs.access(path.join(templatesDir, filename));
  for (const filename of ['styles.css', 'app.js', 'logo.svg', 'poster-placeholder.svg']) await fs.access(path.join(assetDir, filename));

  await fs.rm(OUT, { recursive: true, force: true });
  await fs.mkdir(OUT, { recursive: true });
  await fs.cp(assetDir, path.join(OUT, 'assets'), { recursive: true });
  await fs.mkdir(path.join(OUT, 'titles'), { recursive: true });

  const serializedItems = items.map(item => ({
    ...item,
    detailUrl: titleUrl(item, siteUrl),
    poster: item.poster || localUrl(siteUrl, 'assets/poster-placeholder.svg')
  }));
  await fs.writeFile(path.join(OUT, 'assets', 'catalog.json'), `${safeJson(serializedItems)}\n`, 'utf8');

  const homeTemplate = await readText(path.join(templatesDir, 'home.html'));
  const allTemplate = await readText(path.join(templatesDir, 'all-titles.html'));
  const titleTemplate = await readText(path.join(templatesDir, 'title.html'));
  const staticTemplate = await readText(path.join(templatesDir, 'static.html'));
  const headerHome = headerHtml(siteUrl, siteName, 'home');
  const headerAll = headerHtml(siteUrl, siteName, 'all');
  const footer = footerHtml(siteUrl, config);
  const logoImage = localUrl(siteUrl, 'assets/logo.svg');

  const homeCanonical = siteUrl;
  const homeTitle = `${siteName} — Movie & TV Discovery Guide`;
  const homeDesc = truncate(config.description, 158);
  const homeCards = items.slice(0, 20).map(item => cardHtml(item, siteUrl)).join('\n');
  const homeHtml = template(homeTemplate, {
    PAGE_TITLE: esc(homeTitle),
    HEAD_META: headMeta({ title: homeTitle, description: homeDesc, canonical: homeCanonical, image: items[0]?.poster || logoImage, robots: 'index,follow', siteName, verification: config.googleSiteVerification || '' }),
    BASE_URL: esc(siteUrl), HEADER: headerHome, FOOTER: footer,
    SITE_NAME: esc(siteName), HOME_CARDS: homeCards,
    SCHEMA: structuredData(websiteSchema(siteUrl, config, items))
  });
  await fs.writeFile(path.join(OUT, 'index.html'), homeHtml, 'utf8');

  const allCanonical = localUrl(siteUrl, 'all-titles/');
  const allTitle = `All Movies & TV Series | ${siteName}`;
  const allDesc = `Browse ${items.length} movie and TV title guides, including summaries, release information, cast, genres, and external viewing links.`;
  const allCards = items.map(item => cardHtml(item, siteUrl)).join('\n');
  const allGenres = genreOptions(items);
  const allSchema = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `All movies and TV series | ${siteName}`,
    url: allCanonical,
    description: allDesc,
    mainEntity: { '@type': 'ItemList', numberOfItems: items.length, itemListElement: items.map((item, index) => ({ '@type': 'ListItem', position: index + 1, url: titleUrl(item, siteUrl), name: item.title })) }
  };
  const allHtml = template(allTemplate, {
    PAGE_TITLE: esc(allTitle),
    HEAD_META: headMeta({ title: allTitle, description: allDesc, canonical: allCanonical, image: logoImage, robots: 'index,follow', siteName, verification: config.googleSiteVerification || '' }),
    BASE_URL: esc(siteUrl), HEADER: headerAll, FOOTER: footer,
    TITLE_COUNT: `${items.length}`, ALL_CARDS: allCards, GENRE_OPTIONS: allGenres,
    SCHEMA: structuredData(allSchema)
  });
  await fs.mkdir(path.join(OUT, 'all-titles'), { recursive: true });
  await fs.writeFile(path.join(OUT, 'all-titles', 'index.html'), allHtml, 'utf8');

  const indexable = new Set();
  for (const item of items) {
    const canonical = titleUrl(item, siteUrl);
    const pageTitle = `${item.title}${item.year ? ` (${item.year})` : ''} — Cast, Story & Details | ${siteName}`;
    const description = truncate(item.editorialSummary || item.overview || `${item.title}: explore cast, release information, genres, and official viewing information on ${siteName}.`);
    const qualifies = Boolean(item.overview && item.overview.length >= 80 && item.poster);
    if (qualifies) indexable.add(item.slug);
    const head = headMeta({
      title: pageTitle,
      description,
      canonical,
      image: item.poster || logoImage,
      robots: qualifies ? 'index,follow' : 'noindex,follow',
      siteName,
      verification: config.googleSiteVerification || ''
    });
    const body = titleBody(item, items, siteUrl, overrides);
    const page = template(titleTemplate, {
      PAGE_TITLE: esc(pageTitle), HEAD_META: head, BASE_URL: esc(siteUrl),
      HEADER: headerHtml(siteUrl, siteName), FOOTER: footer,
      SCHEMA: structuredData(titleSchema(item, siteUrl, config)),
      ...body
    });
    const dir = path.join(OUT, 'titles', item.slug);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'index.html'), page, 'utf8');
  }

  const staticPages = [
    { slug: 'about', heading: 'About this site', title: `About ${siteName}`, description: `Learn about ${siteName}, an independent movie and TV discovery guide.`, file: 'about.html' },
    { slug: 'privacy', heading: 'Privacy policy', title: `Privacy Policy | ${siteName}`, description: `Privacy information for visitors to ${siteName}.`, file: 'privacy.html' },
    { slug: 'disclaimer', heading: 'Disclaimer', title: `Disclaimer | ${siteName}`, description: `Source, third-party link, and attribution details for ${siteName}.`, file: 'disclaimer.html' }
  ];
  for (const pageInfo of staticPages) {
    const content = (await readText(path.join(ROOT, 'pages', pageInfo.file))).replaceAll('{{SITE_NAME}}', esc(siteName));
    const canonical = localUrl(siteUrl, `${pageInfo.slug}/`);
    const page = template(staticTemplate, {
      PAGE_TITLE: esc(pageInfo.title), PAGE_HEADING: esc(pageInfo.heading), PAGE_CONTENT: content,
      HEAD_META: headMeta({ title: pageInfo.title, description: pageInfo.description, canonical, image: logoImage, robots: 'index,follow', siteName, verification: config.googleSiteVerification || '' }),
      BASE_URL: esc(siteUrl), HEADER: headerHtml(siteUrl, siteName, pageInfo.slug === 'about' ? 'about' : ''), FOOTER: footer,
      SITE_NAME: esc(siteName), SCHEMA: structuredData({ '@context': 'https://schema.org', '@type': 'WebPage', name: pageInfo.title, url: canonical, description: pageInfo.description, isPartOf: { '@type': 'WebSite', name: siteName, url: siteUrl } })
    });
    const dir = path.join(OUT, pageInfo.slug);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'index.html'), page, 'utf8');
  }

  // Copy optional owner-provided files (custom domain, AdSense, verification files).
  for (const name of ['CNAME', 'ads.txt', 'google-site-verification.html', 'BingSiteAuth.xml']) {
    try { await fs.copyFile(path.join(ROOT, name), path.join(OUT, name)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  await fs.writeFile(path.join(OUT, '.nojekyll'), '', 'utf8');
  await fs.writeFile(path.join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${localUrl(siteUrl, 'sitemap.xml')}\n`, 'utf8');
  await fs.writeFile(path.join(OUT, 'sitemap.xml'), makeSitemap(siteUrl, items, indexable), 'utf8');

  const report = makeReport(siteUrl, items, indexable);
  await fs.writeFile(path.join(OUT, 'SEO-REPORT.md'), report, 'utf8');
  await fs.writeFile(path.join(ROOT, 'SEO-REPORT.md'), report, 'utf8');

  const notFound = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,follow"><title>Page not found | ${esc(siteName)}</title><link rel="canonical" href="${esc(siteUrl)}404.html"><link rel="stylesheet" href="${esc(localUrl(siteUrl, 'assets/styles.css'))}"><link rel="icon" href="${esc(logoImage)}"></head><body>${headerHtml(siteUrl, siteName)}<main class="wrap page-main"><section class="prose-content"><p class="eyebrow">404 ERROR</p><h1>This page wandered off.</h1><p>The URL may have changed, or the page may not exist. Return to the home page or browse the complete catalogue.</p><p><a class="button button-primary" href="${esc(siteUrl)}">Go home</a> <a class="button button-secondary" href="${esc(localUrl(siteUrl, 'all-titles/'))}">Browse titles</a></p></section></main>${footerHtml(siteUrl, config)}</body></html>`;
  await fs.writeFile(path.join(OUT, '404.html'), notFound, 'utf8');

  console.log(`\nBuild complete: ${items.length} unique title pages generated.`);
  console.log(`Indexable title pages: ${indexable.size}; noindex pending a usable overview: ${items.length - indexable.size}.`);
  console.log(`Static output: ${path.relative(ROOT, OUT)}/`);
  console.log(`Sitemap: ${localUrl(siteUrl, 'sitemap.xml')}`);
  console.log('The TMDB API key is used only by this build process; it is not written into dist.');
}

try {
  await generate();
} catch (error) {
  console.error(`\nERROR: ${error.message}`);
  process.exit(1);
}
