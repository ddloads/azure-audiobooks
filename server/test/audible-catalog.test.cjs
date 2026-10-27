const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const distDirectory = fs.existsSync(path.join(__dirname, '..', '.test-dist'))
  ? path.join(__dirname, '..', '.test-dist')
  : path.join(__dirname, '..', 'dist');
const { catalogRuntimeMatches, cleanTitleForSearch, pickCatalogMatch, splitAuthorNames } = require(
  path.join(distDirectory, 'utils', 'audibleCatalog.js'),
);

test('library titles are cleaned down to the searchable part', () => {
  assert.equal(cleanTitleForSearch("Stark's Crusade - Stark's War, Book 3"), "Stark's Crusade");
  assert.equal(cleanTitleForSearch('Parable of the Talents 01/22'), 'Parable of the Talents');
  assert.equal(cleanTitleForSearch('Orphan X (Unabridged)'), 'Orphan X');
  assert.equal(
    cleanTitleForSearch('Trials of Cydaria: A LitRPG Adventure (System Universe, Book 4) (Unabridged)'),
    'Trials of Cydaria',
  );
  assert.equal(cleanTitleForSearch('Guild Master - A LitRPG Adventure (Tower of Power, Book 1)'), 'Guild Master');
});

test('runtime must be within 2% or 2 minutes', () => {
  assert.equal(catalogRuntimeMatches(926, 939 * 60), true); // 1.4% off
  assert.equal(catalogRuntimeMatches(600, 600 * 60 + 100), true);
  assert.equal(catalogRuntimeMatches(600, 630 * 60), false); // 5% off
  assert.equal(catalogRuntimeMatches(10, 10 * 60 + 110), true); // 2-minute floor
  assert.equal(catalogRuntimeMatches(600, 0), false);
});

const book = { title: 'The Dwarves', author: 'Markus Heitz', duration: 1353 * 60 };

test('a product only matches with the same runtime, author and title', () => {
  const products = [
    { asin: 'WRONGAUTHR', title: 'The Dwarves', runtime_length_min: 1353, authors: [{ name: 'Someone Else' }] },
    { asin: 'WRONGLENGT', title: 'The Dwarves', runtime_length_min: 900, authors: [{ name: 'Markus Heitz' }] },
    { asin: 'WRONGTITLE', title: 'Something Unrelated', runtime_length_min: 1353, authors: [{ name: 'Markus Heitz' }] },
    { asin: 'B008OIOYXO', title: 'The Dwarves', runtime_length_min: 1352, authors: [{ name: 'Markus Heitz' }] },
  ];
  assert.equal(pickCatalogMatch(products, book)?.asin, 'B008OIOYXO');
  assert.equal(pickCatalogMatch(products.slice(0, 3), book), null);
});

test('the closest runtime wins when several editions match', () => {
  const products = [
    { asin: 'EDITION001', title: 'The Dwarves', runtime_length_min: 1365, authors: [{ name: 'Markus Heitz' }] },
    { asin: 'EDITION002', title: 'The Dwarves', runtime_length_min: 1353, authors: [{ name: 'Markus Heitz' }] },
  ];
  assert.equal(pickCatalogMatch(products, book)?.asin, 'EDITION002');
});

test('author initials and spacing differences still match on surname', () => {
  const products = [{ asin: 'B0036M2HXW', title: 'Parable of the Talents', runtime_length_min: 926, authors: [{ name: 'Octavia E. Butler' }] }];
  assert.equal(
    pickCatalogMatch(products, { title: 'Parable of the Talents 01/22', author: 'Octavia E Butler', duration: 939 * 60 })?.asin,
    'B0036M2HXW',
  );
});

test('books by "Unknown Author" are never matched', () => {
  const products = [{ asin: 'B000000001', title: 'Mystery', runtime_length_min: 600, authors: [{ name: 'Unknown Author' }] }];
  assert.equal(pickCatalogMatch(products, { title: 'Mystery', author: 'Unknown Author', duration: 600 * 60 }), null);
});

test('author fields are split into names, dropping "Unknown Author"', () => {
  assert.deepEqual(splitAuthorNames('Brandon Sanderson, MacLeod Andrews'), ['Brandon Sanderson', 'MacLeod Andrews']);
  assert.deepEqual(splitAuthorNames('B. V. Larson, David VanDyke, Mark Boyett'), ['B. V. Larson', 'David VanDyke', 'Mark Boyett']);
  assert.deepEqual(splitAuthorNames('Ilona Andrews & Jeffrey Kafer'), ['Ilona Andrews', 'Jeffrey Kafer']);
  assert.deepEqual(splitAuthorNames('Douglas Preston and Lincoln Child'), ['Douglas Preston', 'Lincoln Child']);
  assert.deepEqual(splitAuthorNames('Unknown Author'), []);
  assert.deepEqual(splitAuthorNames('Kevin Hearne'), ['Kevin Hearne']);
});

test('a field listing author and narrator matches on the author', () => {
  const products = [{ asin: 'B00I8CNFOU', title: 'Steelheart', runtime_length_min: 763, authors: [{ name: 'Brandon Sanderson' }] }];
  assert.equal(
    pickCatalogMatch(products, { title: 'Steelheart: The Reckoners, Book 1', author: 'Brandon Sanderson, MacLeod Andrews', duration: 763 * 60 })?.asin,
    'B00I8CNFOU',
  );
});

test('a co-author listed second still confirms the match', () => {
  const products = [{ asin: 'B07FLAGSHP', title: 'Flagship Victory', runtime_length_min: 980, authors: [{ name: 'David VanDyke' }, { name: 'B. V. Larson' }] }];
  assert.equal(
    pickCatalogMatch(products, { title: 'Flagship Victory (2018) [Galactic Liberation 3]', author: 'B. V. Larson, David VanDyke, Mark Boyett', duration: 980 * 60 })?.asin,
    'B07FLAGSHP',
  );
});

test('name suffixes like "Jr." are not treated as surnames', () => {
  const products = [{ asin: 'B000SUFFIX', title: 'The Book', runtime_length_min: 600, authors: [{ name: 'Robert W. Ross' }] }];
  assert.equal(pickCatalogMatch(products, { title: 'The Book', author: 'Robert W. Ross Jr.', duration: 600 * 60 })?.asin, 'B000SUFFIX');
  assert.equal(pickCatalogMatch(products, { title: 'The Book', author: 'Somebody Jr.', duration: 600 * 60 }), null);
});
