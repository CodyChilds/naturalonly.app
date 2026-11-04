#!/usr/bin/env node
/**
 * naturalonly.app — static page build.
 *
 * Reads the live catalog from Supabase (anon key, the same read the app does)
 * and writes plain HTML into _site/, next to copies of the hand-written pages
 * (index, privacy, terms, confirmed). .github/workflows/pages.yml uploads _site/
 * to GitHub Pages; nothing generated is committed.
 *
 *   SUPABASE_ANON_KEY=… node scripts/build-site.mjs           build into _site/
 *   node scripts/build-site.mjs --out /tmp/x                   build elsewhere
 *
 * THE "100%" CLAIM
 *   products.fiber is the garment's MAIN fiber, not proof it is 100% of it: a
 *   55/45 linen-cotton row is filed under linen, and natural fiber plus a little
 *   elastane passes the catalog's fiber rule. purity() reads attrs.material_raw
 *   (the brand's own fabric text) and only a 'single' reading of the page's fiber
 *   goes on a "100% X" page. A bare one-fiber text with no percentage
 *   ("organic cotton") counts only when the description names no other fiber
 *   and no stretch — the same reasoning-from-absence the fiber policy uses.
 *
 * A page with fewer than MIN_STYLES qualifying styles is still built, but
 * noindex and left out of the sitemap.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SITE = 'https://naturalonly.app';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://nmrjhcmqsmasquktihvd.supabase.co';
const APP_STORE = 'https://apps.apple.com/app/naturalonly/id6788215014';
const MIN_STYLES = 12;
const MAX_CARDS = 72;          // per fiber page; brand pages cap each section
const MIN_LIVE_ROWS = 5000;    // fewer means a broken read, not a small catalog: fail, don't deploy
const STATIC_FILES = ['index.html', 'privacy.html', 'terms.html', 'confirmed.html', 'CNAME', 'site.css'];

// ── OpenAI Ads pixel ─────────────────────────────────────────────────────────
// One copy, put in every generated page and, at copy time, into index.html
// (its <head> carries a marker comment instead). The two conversions are custom
// events: oaiq('measure', 'custom', { type: 'custom' }, { custom_event_name }).
//   get_app     a tap on any App Store link
//   shop_click  a tap on any affiliate product link (rel="sponsored")
// The SDK queues the call and flushes by beacon on pagehide, so a link that
// leaves the page still reports.
export const PIXEL_ID = 'N364gzhZ9B1oiGKviY5sY7';
export const PIXEL_HEAD = `<script>!function(w,d,s,u){if(w.oaiq)return;var q=function(){q.q.push(arguments)};q.q=[];w.oaiq=q;var j=d.createElement(s);j.async=1;j.src=u;var f=d.getElementsByTagName(s)[0];f.parentNode.insertBefore(j,f)}(window,document,"script","https://bzrcdn.openai.com/sdk/oaiq.min.js");oaiq("init",{pixelId:"${PIXEL_ID}",debug:false});</script>`;
export const PIXEL_EVENTS = `<script>
    ['click', 'auxclick'].forEach(function (type) {
      document.addEventListener(type, function (e) {
        var a = e.target.closest && e.target.closest('a[href]'); if (!a || !window.oaiq) return;
        var name = a.hostname === 'apps.apple.com' ? 'get_app' : a.relList.contains('sponsored') ? 'shop_click' : null;
        if (name) oaiq('measure', 'custom', { type: 'custom' }, { custom_event_name: name });
      }, true);
    });
  </script>`;
const PIXEL_MARKER = '<!-- OpenAI Ads pixel: inserted here by scripts/build-site.mjs -->';

// ── purity ───────────────────────────────────────────────────────────────────

/** Natural fiber families, as material text names them. Order is display order. */
const FAMILIES = [
  ['cotton', /\b(cotton|pima|supima)\b/],
  ['linen', /\b(linen|flax)\b/],
  ['wool', /\b(wool|merino|lambswool)\b/],
  ['cashmere', /\bcashmere\b/],
  ['hemp', /\bhemp\b/],
  ['silk', /\bsilk\b/],
  ['alpaca', /\balpaca\b/],
  ['yak', /\byak\b/],
  ['mohair', /\bmohair\b/],
  ['camel', /\bcamel hair\b/],
  ['ramie', /\bramie\b/],
];
/** Anything that makes a garment not one natural fiber: synthetics, regenerated cellulose, non-textile parts. */
const NOT_NATURAL = /\b(elastane|spandex|lycra|elasterell|polyester|poly|nylon|polyamide|acrylic|polypropylene|polyurethane|pu|viscose|rayon|modal|lyocell|tencel|bamboo|cupro|acetate|metallic|lurex|leather|suede|rubber|feathers?|(goose|duck) down)\b|\bdown[- ](fill|filled|insulat)/;

function familiesIn(text) {
  return FAMILIES.filter(([, re]) => re.test(text)).map(([f]) => f);
}

/** Drop what the text says the garment is NOT: "no spandex", "lycra-free", "free of polyester", "without nylon". */
function withoutNegations(text) {
  return text.replace(/\b(no|without|free (of|from))\s+[a-z®-]+/g, ' ').replace(/\b[a-z]+-free\b/g, ' ');
}

/** 100% one fiber by its percentages: every figure is 100, or they add up to 100 (80% cotton + 20% recycled cotton). */
function percentSaysWhole(text) {
  const pcts = [...text.matchAll(/(\d{1,3}(?:\.\d+)?)\s?%/g)].map(x => Number(x[1]));
  if (!pcts.length) return null;
  return pcts.every(p => p === 100) || Math.abs(pcts.reduce((a, b) => a + b, 0) - 100) < 0.01;
}

/**
 * What a row's fabric text says it is made of. Pure; tested.
 *   { kind: 'single', fiber }   100% one natural fiber
 *   { kind: 'blend', fibers }   natural fibers only, more than one
 *   { kind: 'synthetic' }       names elastane, polyester, viscose, …
 *   { kind: 'unknown' }         no text, no fiber, or percentages that do not add up to one fiber
 */
export function purity(materialRaw, description = '') {
  const m = withoutNegations(String(materialRaw ?? '').toLowerCase());
  const d = withoutNegations(String(description ?? '').toLowerCase());
  if (!m.trim()) return fromDescription(d);
  if (NOT_NATURAL.test(m)) return { kind: 'synthetic' };
  const fams = familiesIn(m);
  if (!fams.length) return { kind: 'unknown' };
  if (fams.length > 1) return { kind: 'blend', fibers: fams };
  const whole = percentSaysWhole(m);
  if (whole !== null) return whole ? { kind: 'single', fiber: fams[0] } : { kind: 'unknown' };
  // No percentage: one fiber named, so it reads as 100% only if nothing else says otherwise.
  if (NOT_NATURAL.test(d) || /\bstretch\b/.test(d)) return { kind: 'unknown' };
  const other = familiesIn(d).filter(f => f !== fams[0]);
  return other.length ? { kind: 'unknown' } : { kind: 'single', fiber: fams[0] };
}

/**
 * No fabric field (Frank & Eileen, Hill House, Boden): the description counts
 * only when it states the percentages itself — "100% linen" — names one fiber,
 * and nothing synthetic or stretchy. Never a blend or a bare-name reading.
 */
function fromDescription(d) {
  if (NOT_NATURAL.test(d) || /\bstretch\b/.test(d)) return { kind: 'unknown' };
  const fams = familiesIn(d);
  if (fams.length !== 1 || !/100\s?%/.test(d) || percentSaysWhole(d) !== true) return { kind: 'unknown' };
  return { kind: 'single', fiber: fams[0] };
}

// ── affiliate link (lib/affiliate.ts in natural-only, same order) ───────────

export function appendAffiliateParam(url, param) {
  const clean = String(param ?? '').trim().replace(/^[?&]+/, '');
  if (!clean) return url;
  const query = url.split('#')[0].split('?')[1] ?? '';
  if (query.split('&').includes(clean)) return url;
  return url.includes('?') ? `${url}&${clean}` : `${url}?${clean}`;
}

export function resolveAffiliateUrl(productUrl, brand) {
  const url = String(productUrl ?? '').trim();
  if (!url) return null;
  const template = String(brand?.affiliate_url_template ?? '').trim();
  if (template.includes('{url}')) return template.split('{url}').join(encodeURIComponent(url));
  if (brand?.affiliate_param) return appendAffiliateParam(url, brand.affiliate_param);
  return url;
}

// ── pages ────────────────────────────────────────────────────────────────────

const TEE = /\b(t-?shirts?|tees?|tee shirts?)\b/i;
const JEANS = /\b(jeans?|denim)\b/i;

/** The fiber × category pages. `noun` is the page's plural thing, as a shopper searches it. */
const FIBER_PAGES = [
  { fiber: 'cotton', noun: 't-shirts', test: r => r.category === 'shirt' && TEE.test(r.name) },
  { fiber: 'linen', noun: 'pants', test: r => r.category === 'pants' },
  { fiber: 'cotton', noun: 'underwear', test: r => r.category === 'underwear' },
  { fiber: 'cotton', noun: 'jeans', test: r => r.category === 'pants' && JEANS.test(r.name),
    why: 'Most jeans today are cut from stretch denim — cotton with 1–2% elastane. These are rigid, 100% cotton denim.' },
  { fiber: 'cashmere', noun: 'sweaters', test: r => r.category === 'sweater' },
  { fiber: 'wool', noun: 'socks', test: r => r.category === 'socks',
    why: 'Nearly every wool sock adds nylon for durability and elastane for fit. These are knit from wool alone.' },
  { fiber: 'cotton', noun: 'pajamas', test: r => r.category === 'sleepwear' },
  { fiber: 'cotton', noun: 'leggings', test: r => r.category === 'leggings',
    why: 'Leggings almost always rely on elastane for stretch. These get their stretch from the knit, not from synthetics.' },
  { fiber: 'linen', noun: 'shirts', test: r => r.category === 'shirt' },
  { fiber: 'cotton', noun: 'sweatpants', test: r => r.category === 'sweatpants' },
  { fiber: 'linen', noun: 'dresses', test: r => r.category === 'dress' },
  { fiber: 'cotton', noun: 'hoodies', test: r => r.category === 'hoodie' },
  { fiber: 'silk', noun: 'pajamas', test: r => r.category === 'sleepwear' },
  { fiber: 'hemp', noun: 't-shirts', test: r => r.category === 'shirt' && TEE.test(r.name) },
  { fiber: 'cotton', noun: 'dresses', test: r => r.category === 'dress' },
].map(p => ({ ...p, slug: `100-percent-${p.fiber}-${p.noun}`, label: `100% ${p.fiber} ${p.noun}` }));

// Brand pages: one per data/brands.json entry, in its order. A brand with no live
// styles gets no page (and must not be linked from index.html).

export function slugify(name) {
  return String(name).toLowerCase().replace(/&/g, ' and ').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ── read ─────────────────────────────────────────────────────────────────────

async function rest(query, key) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${query}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`Supabase ${query.split('?')[0]}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function readCatalog(key) {
  const cols = 'id,brand,name,price,fiber,category,gender,color,image_url,affiliate_url,availability,listing_key,published_at,description,material:attrs->>material_raw';
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const page = await rest(`products?select=${cols}&is_active=eq.true&order=id&limit=1000&offset=${from}`, key);
    rows.push(...page);
    if (page.length < 1000) break;
  }
  if (rows.length < MIN_LIVE_ROWS) throw new Error(`only ${rows.length} live rows read (expected ≥ ${MIN_LIVE_ROWS}) — refusing to build`);
  const brands = await rest('brands?select=name,url,affiliate_url_template,affiliate_param', key);
  return { rows, brands: new Map(brands.map(b => [b.name, b])) };
}

// ── styles ───────────────────────────────────────────────────────────────────

/** The product's own name, without the colour the scraper appends ("Linen Shirt - Chile"). */
export function baseName(name) {
  return String(name).split(' - ')[0].trim();
}

/**
 * A 480px image where the host resizes: a Quince original is 1.3 MB, its
 * ?w=480&fm=webp 11 KB. Pact (plain S3) and others are left as stored.
 */
export function sizedImage(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.host === 'cdn.shopify.com' || u.host === 'content.gapinc.com') u.searchParams.set('width', '480');
    else if (u.host === 'images.quince.com') { u.searchParams.set('w', '480'); u.searchParams.set('fm', 'webp'); }
    return u.toString();
  } catch { return null; }
}

/**
 * Colourway rows -> one style per brand + listing_key, from available rows only.
 * A style with no available row, or no image, is not shown.
 */
function toStyles(rows, brands) {
  const groups = new Map();
  for (const r of rows) {
    if (r.availability === 'sold_out' || !r.image_url || !r.affiliate_url) continue;
    const k = `${r.brand}|${r.listing_key}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const styles = [];
  for (const rs of groups.values()) {
    rs.sort((a, b) => a.price - b.price || (a.id < b.id ? -1 : 1));
    const rep = rs[0];
    const prices = rs.map(r => Number(r.price));
    const genders = new Set(rs.flatMap(r => r.gender || []));
    styles.push({
      brand: rep.brand,
      name: baseName(rep.name),
      purity: rep.purity,
      material: rep.material,
      min: Math.min(...prices), max: Math.max(...prices),
      colors: new Set(rs.map(r => r.color).filter(Boolean)).size,
      g: [genders.has('W') && 'W', genders.has('M') && 'M', (genders.has('b') || genders.has('g')) && 'K'].filter(Boolean),
      image: sizedImage(rep.image_url),
      href: resolveAffiliateUrl(rep.affiliate_url, brands.get(rep.brand)),
      published: rs.reduce((t, r) => (r.published_at > t ? r.published_at : t), ''),
    });
  }
  // Most colourways first (a proxy for a brand's core styles), then newest.
  return styles.sort((a, b) => b.colors - a.colors || (b.published > a.published ? 1 : -1) || a.name.localeCompare(b.name));
}

// ── html ─────────────────────────────────────────────────────────────────────

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
const plural = (n, one, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

function fiberLabel(p) {
  if (p.kind === 'single') return `100% ${p.fiber}`;
  if (p.kind === 'blend') return p.fibers.join(' / ');
  return '';
}

function card(s, { showBrand = true, showFabric = false } = {}) {
  const price = s.min === s.max ? money(s.min) : `${money(s.min)}–${money(s.max)}`;
  const fabric = showFabric && s.material ? s.material : fiberLabel(s.purity);
  // Brands reuse one name across fits ("100% European Linen Pants", women's and men's).
  const who = s.g.length === 1 ? { W: "Women's", M: "Men's", K: "Kids'" }[s.g[0]] : '';
  return `<li class="card" data-g="${s.g.join(' ')}"><a href="${esc(s.href)}" rel="sponsored nofollow noopener" target="_blank">
  <div class="card-img"><img src="${esc(s.image)}" alt="${esc(`${s.brand} ${s.name}`)}" loading="lazy" decoding="async" width="480" height="600"></div>
  <div class="card-body">${showBrand ? `<div class="card-brand">${esc(s.brand)}</div>` : ''}<div class="card-name">${esc(s.name)}</div>
  <div class="card-meta">${price}${s.colors > 1 ? ` · ${s.colors} colors` : ''}</div><div class="card-fiber">${esc([who, fabric].filter(Boolean).join(' · '))}</div></div>
</a></li>`;
}

function chips(styles) {
  const n = g => styles.filter(s => s.g.includes(g)).length;
  const opts = [['', 'All', styles.length], ['W', 'Women', n('W')], ['M', 'Men', n('M')], ['K', 'Kids', n('K')]].filter(o => o[2] > 0);
  if (opts.length <= 2) return '';
  return `<div class="chips" role="group" aria-label="Filter">${opts.map(([g, label], i) =>
    `<button type="button" class="chip" data-f="${g}" aria-pressed="${i === 0}">${label}</button>`).join('')}</div>`;
}

const DISCLOSURE = 'naturalonly may earn a commission when you buy through links on this page, at no extra cost to you.';

function layout({ slug, title, description, h1, lead, body, indexable, related, updated }) {
  const url = `${SITE}/${slug}/`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  ${indexable ? `<link rel="canonical" href="${url}">` : '<meta name="robots" content="noindex, follow">'}
  <meta name="apple-itunes-app" content="app-id=6788215014">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${url}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/site.css">
  ${PIXEL_HEAD}
</head>
<body>
  <nav class="top">
    <a class="nav-wordmark" href="/"><span class="natural">natural</span><span class="only">only</span></a>
    <a href="${APP_STORE}" class="nav-cta">Get the app</a>
  </nav>
  <header class="page-head">
    <h1 class="page-title">${esc(h1)}</h1>
    ${lead}
    <p class="disclosure">${DISCLOSURE}</p>
  </header>
  <main>
${body}
    <aside class="app-band">
      <h2 class="section-title">Search every natural-fiber piece</h2>
      <p class="section-sub">The naturalonly app searches the whole catalog — every fiber, every brand — and checks each listing before it goes live.</p>
      <a href="${APP_STORE}" class="btn-primary">Download free on iOS</a>
    </aside>
    <nav class="related" aria-label="More pages">
      <p class="section-label">More 100% natural</p>
      <ul>${related.filter(r => r.slug !== slug).map(r => `<li><a href="/${r.slug}/">${esc(r.label)}</a></li>`).join('')}</ul>
    </nav>
  </main>
  <footer>
    <div class="footer-wordmark"><span class="natural">natural</span><span class="only">only</span></div>
    <div class="footer-links">
      <a href="mailto:hello@naturalonly.app">Contact</a>
      <a href="/privacy">Privacy Policy</a>
      <a href="/terms">Terms of Service</a>
    </div>
    <p class="footer-note">${DISCLOSURE} Prices and availability come from each brand's site and can change. Updated ${esc(updated)}.</p>
    <p class="footer-copy">© 2026 CalShep Co LLC · naturalonly</p>
  </footer>
  <script>
    document.querySelectorAll('.chips').forEach(function (group) {
      var grid = group.nextElementSibling;
      group.addEventListener('click', function (e) {
        var b = e.target.closest('.chip'); if (!b) return;
        group.querySelectorAll('.chip').forEach(function (c) { c.setAttribute('aria-pressed', c === b); });
        var f = b.getAttribute('data-f');
        grid.querySelectorAll('.card').forEach(function (li) {
          li.hidden = !!f && li.getAttribute('data-g').split(' ').indexOf(f) < 0;
        });
      });
    });
  </script>
  ${PIXEL_EVENTS}
</body>
</html>
`;
}

function fiberPage(spec, rows, brands, related, updated) {
  const qualifying = rows.filter(r => r.purity.kind === 'single' && r.purity.fiber === spec.fiber && spec.test(r));
  const styles = toStyles(qualifying, brands);
  const shown = styles.slice(0, MAX_CARDS);
  const brandCount = new Set(styles.map(s => s.brand)).size;
  const indexable = styles.length >= MIN_STYLES;
  const title = `${cap(spec.label)} — ${plural(styles.length, 'style')}, no blends | naturalonly`;
  const description = `${plural(styles.length, 'style')} of ${spec.label} from ${plural(brandCount, 'brand')}, checked against each brand's fabric content. No blends, no elastane. Updated nightly.`;
  const lead = `<p class="page-lead">Every piece below is ${esc(`100% ${spec.fiber}`)} by the brand's own fabric listing — no blends, no elastane. ${plural(styles.length, 'style')} from ${plural(brandCount, 'brand')}, in stock as of ${esc(updated)}.</p>`;
  const why = spec.why || `Plenty of ${spec.fiber} ${spec.noun} are really ${spec.fiber} blends, or add elastane for stretch. naturalonly reads the fabric content of every listing and keeps only the ones that are ${spec.fiber} through and through.`;
  const body = `    <section class="grid-section">
      ${chips(shown)}
      <ul class="grid">
${shown.map(s => card(s)).join('\n')}
      </ul>
      ${styles.length > shown.length ? `<p class="more">Showing ${shown.length} of ${styles.length.toLocaleString('en-US')}. <a href="${APP_STORE}">See them all in the app</a>.</p>` : ''}
    </section>
    <section class="why"><h2>Why some ${esc(`${spec.fiber} ${spec.noun}`)} aren't here</h2><p>${esc(why)}</p></section>`;
  return { slug: spec.slug, label: spec.label, styles: styles.length, brands: brandCount, indexable,
    html: layout({ slug: spec.slug, title, description, h1: cap(spec.label), lead, body, indexable, related, updated }) };
}

function brandPage(name, rows, brands, blurbs, related, updated) {
  const mine = rows.filter(r => r.brand === name);
  const all = toStyles(mine, brands);
  const singles = all.filter(s => s.purity.kind === 'single');
  const blends = all.filter(s => s.purity.kind === 'blend');
  const leftOut = all.length - singles.length - blends.length;   // elastane, or fabric text that does not resolve
  const byFiber = new Map();
  for (const s of singles) {
    if (!byFiber.has(s.purity.fiber)) byFiber.set(s.purity.fiber, []);
    byFiber.get(s.purity.fiber).push(s);
  }
  const fibers = [...byFiber.keys()].sort((a, b) => byFiber.get(b).length - byFiber.get(a).length);
  const main = fibers[0] || 'cotton';
  const mainN = byFiber.get(main)?.length || 0;
  const listed = singles.length + blends.length;
  const slug = `brands/${slugify(name)}`;
  const indexable = listed >= MIN_STYLES;

  const parts = [`${mainN.toLocaleString('en-US')} ${mainN === 1 ? 'is' : 'are'} 100% ${main}`];
  const otherSingles = singles.length - mainN;
  if (otherSingles) parts.push(`${otherSingles.toLocaleString('en-US')} ${otherSingles === 1 ? 'is' : 'are'} 100% another natural fiber (${fibers.slice(1).join(', ')})`);
  if (blends.length) parts.push(`${blends.length.toLocaleString('en-US')} ${blends.length === 1 ? 'is a blend' : 'are blends'} of natural fibers`);
  const answer = mainN === all.length && all.length
    ? `Every one of the ${plural(all.length, `${name} style`)} we list is 100% ${main}. That isn't ${name}'s whole catalog: naturalonly lists natural-fiber clothing only.`
    : `Not everything. Of the ${plural(all.length, `${name} style`)} in stock in naturalonly, ${parts.join(', ').replace(/, ([^,]*)$/, ', and $1')}.${leftOut ? ` ${leftOut.toLocaleString('en-US')} more contain elastane or don't state their fabric fully, so they're left off this page.` : ''} naturalonly lists natural-fiber clothing only — anything with polyester, nylon or acrylic never appears here.`;
  const { blurb, catalog_note: note } = blurbs[name] || {};
  const lead = `<p class="page-lead"><strong>${esc(answer.split('.')[0])}.</strong>${esc(answer.slice(answer.indexOf('.') + 1))}</p>${blurb ? `\n    <p class="brand-blurb">${esc(blurb)}</p>` : ''}${note ? `\n    <p class="brand-blurb">${esc(note)}</p>` : ''}`;

  const sections = [];
  for (const f of fibers) {
    const list = byFiber.get(f);
    const shown = list.slice(0, f === main ? 48 : 24);
    sections.push(`    <section class="grid-section">
      <h2 class="grid-title">100% ${esc(f)} <span>${list.length.toLocaleString('en-US')}</span></h2>
      ${chips(shown)}
      <ul class="grid">
${shown.map(s => card(s, { showBrand: false })).join('\n')}
      </ul>
      ${list.length > shown.length ? `<p class="more">Showing ${shown.length} of ${list.length.toLocaleString('en-US')}. <a href="${APP_STORE}">See them all in the app</a>.</p>` : ''}
    </section>`);
  }
  if (blends.length) {
    const shown = blends.slice(0, 24);
    sections.push(`    <section class="grid-section">
      <h2 class="grid-title">Natural-fiber blends <span>${blends.length.toLocaleString('en-US')}</span></h2>
      <ul class="grid">
${shown.map(s => card(s, { showBrand: false, showFabric: true })).join('\n')}
      </ul>
    </section>`);
  }
  const title = `Is ${name} 100% ${main}? ${plural(listed, 'natural-fiber style')} | naturalonly`;
  const description = `Which ${name} clothing is 100% ${main}? ${plural(mainN, 'style')} checked against ${name}'s own fabric content, plus every other natural-fiber piece. Updated nightly.`;
  return { slug, label: `${name}: 100% natural`, styles: listed, brands: 1, indexable,
    html: layout({ slug, title, description, h1: `Is ${name} 100% ${main}?`, lead, body: sections.join('\n'), indexable, related, updated }) };
}

// ── main ─────────────────────────────────────────────────────────────────────

function sitemap(pages, updatedIso) {
  const urls = ['/', '/privacy', '/terms', ...pages.filter(p => p.indexable).map(p => `/${p.slug}/`)];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${SITE}${u}</loc><lastmod>${updatedIso}</lastmod></url>`).join('\n')}
</urlset>
`;
}

async function main() {
  const args = process.argv.slice(2);
  const out = path.resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : path.join(ROOT, '_site'));
  const key = process.env.SUPABASE_ANON_KEY;
  if (!key) throw new Error('SUPABASE_ANON_KEY is not set');

  const { rows, brands } = await readCatalog(key);
  for (const r of rows) r.purity = purity(r.material, r.description);
  const blurbFile = path.join(ROOT, 'data', 'brands.json');
  const blurbs = fs.existsSync(blurbFile) ? JSON.parse(fs.readFileSync(blurbFile, 'utf8')) : {};
  // A page that would list nothing is not built: "Is X 100% cotton?" over zero styles answers nothing.
  const brandNames = Object.keys(blurbs).filter(name => {
    const listed = toStyles(rows.filter(r => r.brand === name), brands).filter(s => s.purity.kind === 'single' || s.purity.kind === 'blend').length;
    if (!listed) console.log(`  skipped brand page: ${name} (no live natural-fiber styles)`);
    return listed > 0;
  });

  const now = new Date();
  const updated = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' });
  const related = [
    ...FIBER_PAGES.map(p => ({ slug: p.slug, label: p.label })),
    ...brandNames.map(b => ({ slug: `brands/${slugify(b)}`, label: b })),
  ];
  const pages = [
    ...FIBER_PAGES.map(spec => fiberPage(spec, rows, brands, related, updated)),
    ...brandNames.map(name => brandPage(name, rows, brands, blurbs, related, updated)),
  ];

  // index.html's Browse section is hand-written: every generated-page link in it must be a page this build makes.
  const built = new Set(pages.map(p => `/${p.slug}/`));
  const linked = [...fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').matchAll(/href="(\/(?:100-percent-[a-z-]+|brands\/[a-z0-9-]+)\/)"/g)].map(m => m[1]);
  const dangling = linked.filter(l => !built.has(l));
  if (dangling.length) throw new Error(`index.html links pages this build does not make: ${dangling.join(', ')}`);

  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  for (const f of STATIC_FILES) if (fs.existsSync(path.join(ROOT, f))) fs.copyFileSync(path.join(ROOT, f), path.join(out, f));
  // index.html gets the same pixel as the generated pages, from this one copy.
  const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  if (!index.includes(PIXEL_MARKER) || !index.includes('</body>')) throw new Error('index.html is missing the pixel marker comment or </body>');
  fs.writeFileSync(path.join(out, 'index.html'), index.replace(PIXEL_MARKER, PIXEL_HEAD).replace('</body>', `  ${PIXEL_EVENTS}\n</body>`));
  for (const p of pages) {
    fs.mkdirSync(path.join(out, p.slug), { recursive: true });
    fs.writeFileSync(path.join(out, p.slug, 'index.html'), p.html);
  }
  fs.writeFileSync(path.join(out, 'sitemap.xml'), sitemap(pages, now.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })));
  fs.writeFileSync(path.join(out, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);

  const tally = {};
  for (const r of rows) tally[r.purity.kind] = (tally[r.purity.kind] || 0) + 1;
  console.log(`\n  ${rows.length.toLocaleString('en-US')} live rows · purity ${JSON.stringify(tally)}\n`);
  for (const p of pages) console.log(`  ${p.indexable ? 'index  ' : 'NOINDEX'}  ${String(p.styles).padStart(5)} styles  ${String(p.brands).padStart(3)} brands  /${p.slug}/`);
  console.log(`\n  wrote ${pages.length} pages to ${out}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(`\n  error: ${e.message}\n`); process.exit(1); });
}
