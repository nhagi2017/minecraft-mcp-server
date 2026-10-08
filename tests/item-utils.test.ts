import test from 'ava';
import { findMatch } from '../src/tools/item-utils.js';
import type { Item } from 'prismarine-item';

const items = (...fields: { name: string; count: number; type: number }[]): Item[] =>
  fields.map((f) => ({ ...f, metadata: 0 })) as unknown as Item[];

test('findMatch prefers an exact name over an earlier partial match', (t) => {
  const result = findMatch(
    items({ name: 'wheat_seeds', count: 5, type: 1 }, { name: 'wheat', count: 2, type: 2 }),
    'wheat'
  );
  t.is(result?.item.name, 'wheat');
});

test('findMatch falls back to the first partial match', (t) => {
  const result = findMatch(
    items({ name: 'oak_log', count: 3, type: 1 }, { name: 'birch_log', count: 4, type: 2 }),
    'log'
  );
  t.is(result?.item.name, 'oak_log');
});

test('findMatch ignores case and surrounding whitespace', (t) => {
  const result = findMatch(items({ name: 'cobblestone', count: 1, type: 1 }), '  Cobblestone ');
  t.is(result?.item.name, 'cobblestone');
});

test('findMatch returns undefined when nothing matches', (t) => {
  t.is(findMatch(items({ name: 'dirt', count: 1, type: 1 }), 'diamond'), undefined);
});

test('findMatch totals every stack of the matched type and caps the requested count', (t) => {
  const inventory = items(
    { name: 'cobblestone', count: 64, type: 1 },
    { name: 'dirt', count: 10, type: 2 },
    { name: 'cobblestone', count: 6, type: 1 }
  );
  t.is(findMatch(inventory, 'cobblestone')?.amount, 70);
  t.is(findMatch(inventory, 'cobblestone', 10)?.amount, 10);
  t.is(findMatch(inventory, 'cobblestone', 100)?.amount, 70);
});
