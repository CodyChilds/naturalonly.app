/**
 * build-site's pure parts: the purity reading, the name and link helpers, the /app
 * page and the pixel's tap handler. No network.
 *
 *   node scripts/build-site.test.mjs
 */
import assert from 'node:assert/strict';
import { purity, baseName, slugify, resolveAffiliateUrl, sizedImage, readAll,
  adsPage, countLine, appSearchLink, fiberGridHtml, sitemap, ADS_SEARCHES, PIXEL_EVENTS, PIXEL_HEAD } from './build-site.mjs';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}
console.log('\nbuild-site\n');

test('100% of one fiber is single, whatever the wording', () => {
  assert.deepEqual(purity('100% European flax linen'), { kind: 'single', fiber: 'linen' });
  assert.deepEqual(purity('100% Regenerative Organic Cotton'), { kind: 'single', fiber: 'cotton' });
  assert.deepEqual(purity('100% Merino Wool'), { kind: 'single', fiber: 'wool' });
  assert.deepEqual(purity('Shell: 100% cotton. Lining: 100% cotton.'), { kind: 'single', fiber: 'cotton' });
  assert.deepEqual(purity('100% Grade-A Mongolian cashmere'), { kind: 'single', fiber: 'cashmere' });
});

test('natural blends are blends, filed fiber notwithstanding', () => {
  assert.deepEqual(purity('70% organic cotton, 30% linen'), { kind: 'blend', fibers: ['cotton', 'linen'] });
  assert.deepEqual(purity('55% Hemp, 45% Organic Cotton'), { kind: 'blend', fibers: ['cotton', 'hemp'] });
  assert.equal(purity('52% linen, 24% spun silk, 24% organic cotton').kind, 'blend');
});

test('elastane, synthetics and regenerated fibers are never single', () => {
  for (const m of ['98% organic cotton, 2% spandex', '95% cotton 5% elastane', '80% wool 20% nylon',
    '100% cotton; trim: polyester', '95% viscose', 'Cotton / bamboo', '100% wool, leather patch']) {
    assert.equal(purity(m).kind, 'synthetic', m);
  }
});

test('percentages that are not 100 of one fiber do not resolve', () => {
  assert.equal(purity('95% cotton').kind, 'unknown');
  assert.equal(purity('').kind, 'unknown');
  assert.equal(purity(null).kind, 'unknown');
  assert.equal(purity('see label').kind, 'unknown');
});

test('a bare single fiber counts only when the description agrees', () => {
  assert.deepEqual(purity('organic cotton', 'Soft organic cotton tee.'), { kind: 'single', fiber: 'cotton' });
  assert.equal(purity('cotton', 'A cotton tee with linen trim.').kind, 'unknown');
  assert.equal(purity('cotton', 'Comfortable stretch for all-day wear.').kind, 'unknown');
  assert.equal(purity('cotton', 'Blended with spandex.').kind, 'unknown');
});

test('words that contain fiber words do not count as fibers', () => {
  assert.deepEqual(purity('100% cotton', 'Silky hand. Camel colourway. Woolly look.'), { kind: 'single', fiber: 'cotton' });
  assert.equal(purity('100% cotton, camel').kind, 'single');
});

test('one fiber split across percentages that add to 100 is single', () => {
  assert.deepEqual(purity('80% organic cotton, 20% recycled cotton'), { kind: 'single', fiber: 'cotton' });
  assert.deepEqual(purity('70% recycled cashmere and 30% cashmere'), { kind: 'single', fiber: 'cashmere' });
  assert.equal(purity('95% merino sweatpants keep you comfortable').kind, 'unknown');
});

test('negations and "button down" are not synthetics', () => {
  assert.deepEqual(purity('100% biodegradable: no polyester, no latex, no polyamide, no synthetics'), { kind: 'unknown' });
  assert.deepEqual(purity('100% hemp', '100% elastic-free & lycra-free. No spandex. 100% cotton-free.'), { kind: 'single', fiber: 'hemp' });
  assert.deepEqual(purity('100% cotton knit button down shirt'), { kind: 'single', fiber: 'cotton' });
  assert.equal(purity('cotton', 'The hat can be pulled down over the ears.').kind, 'single');
  assert.equal(purity('100% cotton shell, goose down fill').kind, 'synthetic');
});

test('with no fabric field, only a stated "100% X" in the description counts', () => {
  assert.deepEqual(purity('', 'Our classic shirt in 100% Italian linen.'), { kind: 'single', fiber: 'linen' });
  assert.equal(purity('', 'A linen shirt, our best seller.').kind, 'unknown');
  assert.equal(purity('', '100% linen, with cotton trim.').kind, 'unknown');
  assert.equal(purity('', '100% cotton. Now 30% off.').kind, 'unknown');
  assert.equal(purity(null, '98% cotton, 2% elastane').kind, 'unknown');
});

test('base name drops the colour suffix', () => {
  assert.equal(baseName('100% European Linen Long Sleeve Shirt - Chile'), '100% European Linen Long Sleeve Shirt');
  assert.equal(baseName('Olive Hooded Shacket - color:green'), 'Olive Hooded Shacket');
  assert.equal(baseName('Waffle Knit Henley - Dark Port Heather - Dark Port Heather'), 'Waffle Knit Henley');
});

test('images are asked for at 480px where the host resizes', () => {
  assert.equal(sizedImage('https://cdn.shopify.com/s/files/a.jpg?v=1'), 'https://cdn.shopify.com/s/files/a.jpg?v=1&width=480');
  assert.equal(sizedImage('https://content.gapinc.com/b/cn1.png?width=1500'), 'https://content.gapinc.com/b/cn1.png?width=480');
  assert.equal(sizedImage('https://images.quince.com/x/y/W-PNT.jpg'), 'https://images.quince.com/x/y/W-PNT.jpg?w=480&fm=webp');
  assert.equal(sizedImage('https://static.wearpact.com/img/a.jpg'), 'https://static.wearpact.com/img/a.jpg');
  assert.equal(sizedImage(null), null);
});

test('slugs and affiliate links', () => {
  assert.equal(slugify('Old Navy'), 'old-navy');
  assert.equal(slugify("Burt's Bees Baby"), 'burts-bees-baby');
  assert.equal(slugify('Toad&Co'), 'toad-and-co');
  const u = 'https://x.com/products/a?variant=1';
  assert.equal(resolveAffiliateUrl(u, { affiliate_url_template: 'https://t.io/a?u={url}' }), `https://t.io/a?u=${encodeURIComponent(u)}`);
  assert.equal(resolveAffiliateUrl(u, { affiliate_param: 'ref=no' }), `${u}&ref=no`);
  assert.equal(resolveAffiliateUrl(`${u}&ref=no`, { affiliate_param: 'ref=no' }), `${u}&ref=no`);
  assert.equal(resolveAffiliateUrl(u, null), u);
});

// readAll: a fake table of ids 1..n; `timeouts` lists the page sizes that time out.
const TIMEOUT = 'Supabase products: 500 {"code":"57014","details":null,"hint":null,"message":"canceling statement due to statement timeout"}';
function fakeTable(n, timeoutAbove = Infinity, calls = []) {
  const ids = Array.from({ length: n }, (_, i) => ({ id: i + 1 }));
  return async (size, after) => {
    calls.push([size, after]);
    if (size > timeoutAbove) throw new Error(TIMEOUT);
    return ids.filter(r => after == null || r.id > after).slice(0, size);
  };
}
const quiet = { waitMs: 0, log: () => {} };

async function testAsync(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

await testAsync('readAll pages by id and reads every row once', async () => {
  const calls = [];
  const rows = await readAll(fakeTable(2500, Infinity, calls), quiet);
  assert.equal(rows.length, 2500);
  assert.equal(new Set(rows.map(r => r.id)).size, 2500);
  assert.deepEqual(calls, [[1000, null], [1000, 1000], [1000, 2000]]);
});

await testAsync('readAll halves the page on a statement timeout and keeps the smaller size', async () => {
  const calls = [];
  const rows = await readAll(fakeTable(700, 300, calls), quiet);
  assert.equal(rows.length, 700);
  assert.deepEqual(calls.map(c => c[0]), [1000, 500, 250, 250, 250]);
});

await testAsync('readAll gives up after five tries at the smallest page', async () => {
  const calls = [];
  await assert.rejects(readAll(fakeTable(100, 0, calls), quiet), /57014/);
  assert.deepEqual(calls.map(c => c[0]), [1000, 500, 250, 125, 62, 31, 25, 25, 25, 25, 25, 25]);
});

await testAsync('readAll does not retry other errors', async () => {
  let n = 0;
  await assert.rejects(readAll(async () => { n++; throw new Error('Supabase products: 401 {"message":"Invalid API key"}'); }, quiet), /401/);
  assert.equal(n, 1);
});

// ── /app ─────────────────────────────────────────────────────────────────────

const PAGES = [
  { slug: '100-percent-linen-dresses', label: '100% linen dresses', fiber: 'linen', noun: 'dresses', indexable: true },
  { slug: '100-percent-wool-sweaters-men', label: "100% wool men's sweaters", fiber: 'wool', noun: 'sweaters', gender: 'men', indexable: true },
  { slug: '100-percent-silk-socks', label: '100% silk socks', fiber: 'silk', noun: 'socks', indexable: false },
  { slug: 'brands/flax', label: 'FLAX', name: 'FLAX', indexable: true },
];
const ADS = adsPage({ pieces: 27_946, brands: 60, grid: fiberGridHtml(PAGES), updated: 'November 14, 2026' }).html;

test('count line: pieces rounded down to the thousand, never up', () => {
  assert.equal(countLine(28_412, 60), '28,000+ pieces from 60 brands. Search anything.');
  assert.equal(countLine(27_999, 61), '27,000+ pieces from 61 brands. Search anything.');
  assert.equal(countLine(28_000, 1), '28,000+ pieces from 1 brand. Search anything.');
  assert.equal(countLine(640, 3), '640 pieces from 3 brands. Search anything.');
});

test('app search links open discover with the query encoded', () => {
  assert.equal(appSearchLink("men's wool sweater"), "naturalonly://discover?query=men's%20wool%20sweater");
  assert.equal(appSearchLink('linen dress'), 'naturalonly://discover?query=linen%20dress');
});

test('/app above the fold: headline, live count, badge to the App Store, three search chips', () => {
  assert.ok(ADS.includes('<h1 class="ads-headline">100% natural fibers. No polyester, no nylon, no acrylic.</h1>'));
  assert.ok(ADS.includes('27,000+ pieces from 60 brands. Search anything.'));
  assert.match(ADS, /<a class="ads-badge" href="https:\/\/apps\.apple\.com\/app\/naturalonly\/id6788215014"><img src="\/app-store-badge\.svg" alt="Download on the App Store"/);
  const chips = [...ADS.matchAll(/<a class="ads-search" href="([^"]+)" data-search>([^<]+)<\/a>/g)];
  assert.deepEqual(chips.map(m => m[2].replace(/&#39;/g, "'")), ADS_SEARCHES);
  assert.deepEqual(ADS_SEARCHES, ['linen dress', "men's wool sweater", 'cotton pajamas']);
  for (const m of chips) assert.ok(m[1].startsWith('naturalonly://discover?query='), m[1]);
  assert.ok(ADS.indexOf('ads-search') < ADS.indexOf('browse-group'), 'the chips come before the fiber grid');
});

test('/app is noindex with no canonical; the sitemap lists it anyway', () => {
  assert.ok(ADS.includes('<meta name="robots" content="noindex, follow">'));
  assert.ok(!ADS.includes('rel="canonical"'));
  const xml = sitemap(PAGES, '2026-11-14');
  assert.ok(xml.includes('<loc>https://naturalonly.app/app/</loc>'));
  assert.ok(!xml.includes('100-percent-silk-socks'), 'noindex fiber pages stay out');
});

test('/app below the fold: the fiber grid (indexed fiber pages only, no brands); footer elastane note and disclosure', () => {
  assert.ok(ADS.includes('href="/100-percent-linen-dresses/"') && ADS.includes('>sweaters for men<'));
  assert.ok(!ADS.includes('100-percent-silk-socks') && !ADS.includes('/brands/flax/'));
  const footer = ADS.slice(ADS.indexOf('<footer>'), ADS.indexOf('</footer>'));
  assert.ok(footer.includes('A small amount of elastane (up to 10%) is allowed for stretch.'));
  assert.ok(footer.includes('naturalonly may earn a commission when you buy through links on this page'));
  assert.ok(ADS.includes(PIXEL_HEAD) && ADS.includes(PIXEL_EVENTS));
});

test('/app carries utm_* params to the App Store and app links, and falls back to the App Store', () => {
  assert.match(ADS, /if \(\/\^utm_\/i\.test\(k\)\) utm\.append\(k, v\)/);
  assert.ok(ADS.includes(`a[href^="https://apps.apple.com/"], a[data-search]`));
  assert.match(ADS, /location\.href = withUtm\(STORE\); \}, 1500\)/);
});

// The pixel's tap handler, run against a stub document: one tap, one event.
function pixelHarness() {
  const handlers = [], sent = [];
  const document = { addEventListener: (type, fn) => handlers.push({ type, fn }) };
  const window = { oaiq: (...a) => sent.push(a) };
  new Function('document', 'window', 'oaiq', PIXEL_EVENTS.replace(/<\/?script>/g, ''))(document, window, window.oaiq);
  const link = (href, { sponsored = false, search = false } = {}) => {
    const u = new URL(href);
    return { hostname: u.hostname, relList: { contains: r => sponsored && r === 'sponsored' }, hasAttribute: n => search && n === 'data-search' };
  };
  const tap = (a, t, type = 'click', button = type === 'click' ? 0 : 1) =>
    handlers.filter(h => h.type === type).forEach(h => h.fn({ button, timeStamp: t, target: { closest: () => a } }));
  return { sent, link, tap };
}

test('pixel: badge tap is lead_created, chip tap is the custom "search" event, product tap is checkout_started', () => {
  const { sent, link, tap } = pixelHarness();
  tap(link('https://apps.apple.com/app/naturalonly/id6788215014?utm_source=chatgpt'), 5000);
  tap(link(appSearchLink('linen dress'), { search: true }), 5010);
  tap(link('https://flax.com/products/a', { sponsored: true }), 5020);
  tap(link('https://naturalonly.app/100-percent-linen-dresses/'), 5030);
  assert.deepEqual(sent, [
    ['measure', 'lead_created', { type: 'customer_action' }],
    ['measure', 'custom', { type: 'custom' }, { custom_event_name: 'search' }],
    ['measure', 'checkout_started', { type: 'contents' }],
  ]);
});

test('pixel: a double tap or a second chip within a second sends one search; a right click sends none', () => {
  const { sent, link, tap } = pixelHarness();
  const chip = link(appSearchLink('cotton pajamas'), { search: true });
  tap(chip, 5000); tap(chip, 5400); tap(link(appSearchLink('linen dress'), { search: true }), 5900);
  tap(chip, 5100, 'auxclick', 2);
  tap(chip, 6500);
  assert.equal(sent.length, 2);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
