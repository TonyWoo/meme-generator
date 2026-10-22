#!/usr/bin/env node
// Build the meme generator into dist/:
//   dist/index.html        language redirect (by browser language, fallback /en/)
//   dist/<lang>/index.html one static page per locale, own canonical + hreflang set
//   dist/assets/           app.js, styles.css, templates/, fonts/
import { readFileSync, writeFileSync, mkdirSync, cpSync, readdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCALES, T } from './src/i18n.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, 'dist');
const BASE_URL = 'https://tonywoo.github.io/meme-generator/';

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

// assets
mkdirSync(join(DIST, 'assets'), { recursive: true });
cpSync(join(ROOT, 'src/app.js'), join(DIST, 'assets/app.js'));
cpSync(join(ROOT, 'src/styles.css'), join(DIST, 'assets/styles.css'));
cpSync(join(ROOT, 'assets/templates'), join(DIST, 'assets/templates'), { recursive: true });
try { cpSync(join(ROOT, 'assets/thumbs'), join(DIST, 'assets/thumbs'), { recursive: true }); } catch {}
cpSync(join(ROOT, 'assets/fonts'), join(DIST, 'assets/fonts'), { recursive: true });
try { cpSync(join(ROOT, 'assets/og-cover.jpg'), join(DIST, 'assets/og-cover.jpg')); } catch {}

const templates = readdirSync(join(ROOT, 'assets/templates')).sort();

const templateHtml = readFileSync(join(ROOT, 'src/template.html'), 'utf8');
const ASSET_VER = createHash('sha256')
  .update(readFileSync(join(ROOT, 'src/app.js')))
  .update(readFileSync(join(ROOT, 'src/styles.css')))
  .digest('hex').slice(0, 10);

function hreflangLinks(currentSlug) {
  const lines = LOCALES.map(
    (l) => `<link rel="alternate" hreflang="${l.hreflang}" href="${BASE_URL}${l.slug}/">`
  );
  lines.push(`<link rel="alternate" hreflang="x-default" href="${BASE_URL}">`);
  return lines.join('\n');
}

function ogLocaleAlternates(currentSlug) {
  return LOCALES.filter((l) => l.slug !== currentSlug).map(
    (l) => `<meta property="og:locale:alternate" content="${l.ogLocale}">`
  ).join('\n');
}
function langOptions(currentSlug) {
  return LOCALES.map(
    (l) => `      <option value="${l.slug}"${l.slug === currentSlug ? ' selected' : ''}>${l.label}</option>`
  ).join('\n');
}

for (const loc of LOCALES) {
  const t = T[loc.slug];
  let html = templateHtml;
  html = html.replaceAll('{{LANG_ATTR}}', loc.hreflang);
  html = html.replaceAll('{{META_TITLE}}', t.metaTitle);
  html = html.replaceAll('{{META_DESC}}', t.metaDescription);
  html = html.replaceAll('{{CANONICAL}}', `${BASE_URL}${loc.slug}/`);
  html = html.replaceAll('{{HREFLANG_LINKS}}', hreflangLinks(loc.slug));
  html = html.replaceAll('{{OG_LOCALE}}', loc.ogLocale);
  html = html.replaceAll('{{ASSET_VER}}', ASSET_VER);
  html = html.replaceAll('{{OG_LOCALE_ALTERNATES}}', ogLocaleAlternates(loc.slug));
  html = html.replaceAll('{{OG_ALT}}', t.ogAlt || t.metaTitle);
  html = html.replaceAll('{{BASE_URL}}', BASE_URL);
  html = html.replaceAll('{{LANG_OPTIONS}}', langOptions(loc.slug));
  html = html.replaceAll('{{TEMPLATES_JSON}}', JSON.stringify(templates));
  html = html.replaceAll('{{STR_JSON}}', JSON.stringify({ topDefault: t.topDefault, bottomDefault: t.bottomDefault, copied: t.copied, share: t.share }));
  html = html.replace(/\{\{T:(\w+)\}\}/g, (_, key) => {
    if (!(key in t)) throw new Error(`missing i18n key ${key} for ${loc.slug}`);
    return t[key];
  });
  if (html.includes('{{')) throw new Error(`unresolved token in ${loc.slug} page`);
  const dir = join(DIST, loc.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), html);
  console.log(`built ${loc.slug}/index.html`);
}

// root redirect page
const slugs = LOCALES.map((l) => l.slug);
const rootHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${T.en.metaTitle}</title>
<meta name="description" content="${T.en.metaDescription}">
<link rel="canonical" href="${BASE_URL}en/">
<meta property="og:type" content="website">
<meta property="og:title" content="${T.en.metaTitle}">
<meta property="og:description" content="${T.en.metaDescription}">
<meta property="og:url" content="${BASE_URL}">
<meta property="og:image" content="${BASE_URL}assets/og-cover.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${T.en.ogAlt}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${T.en.metaTitle}">
<meta name="twitter:description" content="${T.en.metaDescription}">
<meta name="twitter:image" content="${BASE_URL}assets/og-cover.jpg">
<meta name="robots" content="noindex, follow">
<script>
  var known = ${JSON.stringify(slugs)};
  var pref = (navigator.language || 'en').toLowerCase();
  var slug = known.find(function (s) { return pref === s || pref.indexOf(s + '-') === 0; }) || 'en';
  location.replace('./' + slug + '/');
</script>
<meta http-equiv="refresh" content="0; url=en/">
</head>
<body><p><a href="en/">Meme Generator</a></p></body>
</html>
`;
writeFileSync(join(DIST, 'index.html'), rootHtml);

// sitemap with alternates
const altLinks = (loc) => LOCALES.map(
  (l) => `    <xhtml:link rel="alternate" hreflang="${l.hreflang}" href="${BASE_URL}${l.slug}/"/>`
).join('\n') + `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${BASE_URL}"/>`;
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${LOCALES.map((l) => `  <url>
    <loc>${BASE_URL}${l.slug}/</loc>
${altLinks(l)}
  </url>`).join('\n')}
</urlset>
`;
writeFileSync(join(DIST, 'sitemap.xml'), sitemap);
writeFileSync(join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${BASE_URL}sitemap.xml\n`);
console.log(`done: ${LOCALES.length} locales, ${templates.length} templates`);
