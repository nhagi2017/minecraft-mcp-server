import test from 'ava';
import prismarineRegistry from 'prismarine-registry';
import prismarineBlock from 'prismarine-block';
import { patchDigSpeeds } from '../src/dig-speeds.js';
import type mineflayer from 'mineflayer';

const registry = prismarineRegistry('1.21.11');
const Block = prismarineBlock(registry);
patchDigSpeeds(registry as unknown as mineflayer.Bot['registry']);

const id = (name: string) => registry.itemsByName[name].id;
const digTime = (blockName: string, tool: string | null) =>
  Block.fromStateId(registry.blocksByName[blockName].defaultState, 0)
    .digTime(tool ? id(tool) : null, false, false, false, [], []);

test('patchDigSpeeds makes a copper pickaxe mine stone faster than a stone pickaxe', (t) => {
  t.true(digTime('stone', 'copper_pickaxe') < digTime('stone', 'stone_pickaxe'));
  t.true(digTime('stone', 'stone_pickaxe') < digTime('stone', 'iron_pickaxe') * 2);
});

test('patchDigSpeeds gives copper shovels and axes their speed too', (t) => {
  t.true(digTime('dirt', 'copper_shovel') < digTime('dirt', null));
  t.true(digTime('oak_log', 'copper_axe') < digTime('oak_log', 'stone_axe'));
});

test('patchDigSpeeds times ores at pickaxe speed instead of by hand', (t) => {
  t.true(digTime('iron_ore', 'stone_pickaxe') < digTime('iron_ore', null) / 3);
});
