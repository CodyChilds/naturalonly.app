/**
 * build-site's pure parts: the purity reading, the name and link helpers. No network.
 *
 *   node scripts/build-site.test.mjs
 */
import assert from 'node:assert/strict';
import { purity, baseName, slugify, resolveAffiliateUrl, sizedImage } from './build-site.mjs';

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

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
