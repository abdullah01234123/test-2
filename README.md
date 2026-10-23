# HDHub4u — Full Static Movie & TV Discovery Website

This repository is a complete static website source package. It builds a home page, a searchable all-titles directory, a separate HTML page for every title in the build catalogue, About/Privacy/Disclaimer pages, a 404 page, social-media footer links, structured data, `robots.txt`, and `sitemap.xml`.

**Scope:** This is a legal movie and TV discovery guide. It provides title metadata, cast credits, trailers hosted on YouTube, links to TMDB, and a JustWatch search for finding licensed viewing options. It does not host video files or provide unauthorized copies.

## What's included

- `seo-build.mjs` — fetches the TMDB catalogue and builds the complete static site.
- `templates/` — HTML page templates.
- `assets/` — responsive CSS, interactive catalogue filtering, logo, and poster fallback.
- `pages/` — About, Privacy, and Disclaimer content.
- `site-config.json` — branding, catalogue size defaults, display region, and social URLs.
- `seo-overrides.json` — optional original editorial content for individual title pages.
- `.github/workflows/pages.yml` — automated GitHub Pages build and deploy; also refreshes the catalogue weekly.

The TMDB API key is used only inside GitHub Actions while building the files. It is not embedded into the visitor's JavaScript or HTML.

## Quick setup on GitHub

### 1. Create a repository and upload all files

Upload the **contents** of this folder to the root of your new GitHub repository. Keep the folder structure intact, especially `.github/workflows/pages.yml`, `templates/`, `pages/`, and `assets/`.

### 2. Add GitHub repository settings

Open **Repository → Settings → Secrets and variables → Actions**.

**Add a repository secret**:

- Name: `TMDB_API_KEY`
- Value: your **TMDB v3 API Key** from your TMDB account's API settings.

Do not use the v4 Read Access Token in place of the v3 API key. Do not place either credential in `site-config.json`, an HTML file, or browser JavaScript.

**Add repository variables**:

- `SITE_URL`: your final public base URL, including the trailing slash. Example: `https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/`. If you have a custom domain, use `https://your-domain.example/` instead.
- `TMDB_REGION`: optional; defaults to `PK` and is used for the JustWatch search links.
- `TMDB_PAGES`: optional; defaults to `2`. More pages query more TMDB results and require more build-time API calls.
- `MAX_TITLES`: optional; defaults to `80`. The builder supports up to `500`, but larger catalogues take longer and make more API requests.

`SITE_URL` must match the actual public site URL. Incorrect values create incorrect canonical links and sitemap entries.

### 3. Enable GitHub Pages

Open **Settings → Pages → Build and deployment** and choose **GitHub Actions** as the source. The workflow deploys the generated `dist/` folder; do not select the `main` branch root as the Pages source.

### 4. Run the build

Commit the files to your `main` branch. Open the **Actions** tab and select **Build and deploy HDHub4u**. It runs on a push to `main`, manually via **Run workflow**, and every Monday. If the first run fails, open its log and verify `SITE_URL`, `TMDB_API_KEY`, and the Pages configuration.

After deployment, check these URLs, replacing the example with your actual base URL:

- `/` — homepage
- `/all-titles/` — full catalogue with browser-side search, format and genre filters
- `/titles/movie-603/` — example movie URL (only if that TMDB title is in the generated catalogue)
- `/titles/tv-1399/` — example series URL (only if that title is in the generated catalogue)
- `/sitemap.xml` — generated sitemap
- `/robots.txt` — crawler rules
- `/SEO-REPORT.md` — report also uploaded as an Actions artifact

## Social footer links

Edit `socialLinks` in `site-config.json` and replace the generic social-platform homepages with your real HDHub4u profile URLs. Available slots: Facebook, X, Instagram, YouTube, TikTok, and LinkedIn. The same footer is rendered on the homepage, all-titles directory, title pages, and informational pages.

## How individual movie URLs work

The builder fetches trending and popular movies/TV series from TMDB, removes duplicate IDs, and creates a separate, pre-rendered page for each unique title, e.g. `/titles/movie-603/` and `/titles/tv-1399/`. URLs use a stable TMDB media-type + ID format so titles with identical names do not conflict. The catalogue cap controls how many unique title pages are built; this is not every title in TMDB's database.

Every title page contains a unique canonical URL, title and description metadata, Open Graph/Twitter tags, source-linked movie or series details, genres, available cast credits, a trailer link where TMDB lists one, related titles, footer links, and JSON-LD. Ratings are labelled as TMDB community scores; the site does not claim them as user reviews collected by this website. No aggregate-rating markup is generated.

Pages without a meaningful synopsis are still generated, but marked `noindex,follow` and left out of the sitemap until the source metadata is adequate. This avoids automatically asking search engines to index empty pages. The build report lists which pages passed this basic completeness check. A passing check is not a guarantee of indexing or rankings.

## Add original editorial content

Open `seo-overrides.json` and add useful, factual text using a TMDB slug as a key. For example:

```json
{
  "movie-603": {
    "editorialSummary": "Write your own helpful analysis of this film here, covering its themes and what makes it distinctive.",
    "whyWorthWatching": "Explain the audience or interests that may make the film a good fit. Keep the assessment specific and honest."
  }
}
```

These fields are optional. Do not copy summaries from other sites or merely repeat a keyword many times. Original, useful commentary can make a catalogue page more valuable than a page that only republishes metadata.

## Build locally (optional)

Node.js 20 or newer is required. From the repository root:

```bash
SITE_URL="https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/" \
TMDB_API_KEY="YOUR_TMDB_V3_API_KEY" \
node seo-build.mjs
```

The generated website is written to `dist/`. Do not commit your real API key. The `.gitignore` file excludes `dist/`, `.env`, and the generated report.

## Google Search setup

After the site is online:

1. Verify the domain or URL-prefix property in Google Search Console.
2. Submit `https://YOUR-SITE/sitemap.xml` in Search Console.
3. Use URL Inspection to confirm that representative title pages are fetchable, canonical URLs are correct, and the rendered main content is present.
4. Test structured data with Google's Rich Results Test and fix reported issues. Structured data does not guarantee a rich result.
5. Review the site’s content, third-party image and metadata permissions, attribution, and local legal requirements before expanding the catalogue.

Official documentation:

- [Google: Movie structured data](https://developers.google.com/search/docs/appearance/structured-data/movie)
- [Google: Build and submit a sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- [Google: JavaScript SEO basics](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)
- [TMDB API documentation](https://developer.themoviedb.org/docs/getting-started)

Google can choose whether and when to crawl or index a page; this builder cannot guarantee ranking, indexing, or rich-result display.

## Before launch

- Replace all social links with the brand's actual profiles.
- Ensure you have the rights or permissions required for all artwork and use the TMDB attribution statement displayed in the footer.
- Review the Privacy and Disclaimer pages, especially if you add analytics, advertising, affiliate links, a contact form, or embedded third-party services.
- If using a custom domain, add it in GitHub Pages settings and commit a `CNAME` file at the repository root if GitHub instructs you to do so.
