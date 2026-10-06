import test from 'ava';
import sinon from 'sinon';
import { registerInventoryTools } from '../src/tools/inventory-tools.js';
import { ToolFactory } from '../src/tool-factory.js';
import { BotConnection } from '../src/bot-connection.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type mineflayer from 'mineflayer';

test('registerInventoryTools registers list-inventory tool', (t) => {
  const mockServer = {
    tool: sinon.stub()
  } as unknown as McpServer;
  const mockConnection = {
    checkConnectionAndReconnect: sinon.stub().resolves({ connected: true })
  } as unknown as BotConnection;
  const factory = new ToolFactory(mockServer, mockConnection);
  const mockBot = {} as Partial<mineflayer.Bot>;
  const getBot = () => mockBot as mineflayer.Bot;

  registerInventoryTools(factory, getBot);

  const toolCalls = (mockServer.tool as sinon.SinonStub).getCalls();
  const listInventoryCall = toolCalls.find(call => call.args[0] === 'list-inventory');

  t.truthy(listInventoryCall);
  t.is(listInventoryCall!.args[1], 'List all items in the bot\'s inventory');
});

test('registerInventoryTools registers equip-item tool', (t) => {
  const mockServer = {
    tool: sinon.stub()
  } as unknown as McpServer;
  const mockConnection = {
    checkConnectionAndReconnect: sinon.stub().resolves({ connected: true })
  } as unknown as BotConnection;
  const factory = new ToolFactory(mockServer, mockConnection);
  const mockBot = {} as Partial<mineflayer.Bot>;
  const getBot = () => mockBot as mineflayer.Bot;

  registerInventoryTools(factory, getBot);

  const toolCalls = (mockServer.tool as sinon.SinonStub).getCalls();
  const equipItemCall = toolCalls.find(call => call.args[0] === 'equip-item');

  t.truthy(equipItemCall);
  t.is(equipItemCall!.args[1], 'Equip a specific item');
});

test('list-inventory returns empty when no items', async (t) => {
  const mockServer = {
    tool: sinon.stub()
  } as unknown as McpServer;
  const mockConnection = {
    checkConnectionAndReconnect: sinon.stub().resolves({ connected: true })
  } as unknown as BotConnection;
  const factory = new ToolFactory(mockServer, mockConnection);

  const mockBot = {
    inventory: {
      items: () => []
    }
  } as unknown as mineflayer.Bot;
  const getBot = () => mockBot;

  registerInventoryTools(factory, getBot);

  const toolCalls = (mockServer.tool as sinon.SinonStub).getCalls();
  const listInventoryCall = toolCalls.find(call => call.args[0] === 'list-inventory');
  const executor = listInventoryCall!.args[3];

  const result = await executor({});

  t.true(result.content[0].text.includes('empty'));
});

test('list-inventory returns items with counts', async (t) => {
  const mockServer = {
    tool: sinon.stub()
  } as unknown as McpServer;
  const mockConnection = {
    checkConnectionAndReconnect: sinon.stub().resolves({ connected: true })
  } as unknown as BotConnection;
  const factory = new ToolFactory(mockServer, mockConnection);

  const mockBot = {
    inventory: {
      items: () => [
        { name: 'diamond_pickaxe', count: 1, slot: 0 },
        { name: 'cobblestone', count: 64, slot: 1 }
      ]
    }
  } as unknown as mineflayer.Bot;
  const getBot = () => mockBot;

  registerInventoryTools(factory, getBot);

  const toolCalls = (mockServer.tool as sinon.SinonStub).getCalls();
  const listInventoryCall = toolCalls.find(call => call.args[0] === 'list-inventory');
  const executor = listInventoryCall!.args[3];

  const result = await executor({});

  t.true(result.content[0].text.includes('diamond_pickaxe'));
  t.true(result.content[0].text.includes('cobblestone'));
  t.true(result.content[0].text.includes('64'));
});

test('equip-item calls bot.equip', async (t) => {
  const mockServer = {
    tool: sinon.stub()
  } as unknown as McpServer;
  const mockConnection = {
    checkConnectionAndReconnect: sinon.stub().resolves({ connected: true })
  } as unknown as BotConnection;
  const factory = new ToolFactory(mockServer, mockConnection);

  const equipStub = sinon.stub().resolves();
  const mockBot = {
    inventory: {
      items: () => [
        { name: 'diamond_sword', type: 1 }
      ]
    },
    equip: equipStub
  } as unknown as mineflayer.Bot;
  const getBot = () => mockBot;

  registerInventoryTools(factory, getBot);

  const toolCalls = (mockServer.tool as sinon.SinonStub).getCalls();
  const equipItemCall = toolCalls.find(call => call.args[0] === 'equip-item');
  const executor = equipItemCall!.args[3];

  const result = await executor({ itemName: 'diamond_sword', destination: 'hand' });

  t.true(equipStub.calledOnce);
  t.true(result.content[0].text.includes('Equipped'));
  t.true(result.content[0].text.includes('diamond_sword'));
});

test('equip-item returns message when item not found', async (t) => {
  const mockServer = {
    tool: sinon.stub()
  } as unknown as McpServer;
  const mockConnection = {
    checkConnectionAndReconnect: sinon.stub().resolves({ connected: true })
  } as unknown as BotConnection;
  const factory = new ToolFactory(mockServer, mockConnection);

  const mockBot = {
    inventory: {
      items: () => []
    }
  } as unknown as mineflayer.Bot;
  const getBot = () => mockBot;

  registerInventoryTools(factory, getBot);

  const toolCalls = (mockServer.tool as sinon.SinonStub).getCalls();
  const equipItemCall = toolCalls.find(call => call.args[0] === 'equip-item');
  const executor = equipItemCall!.args[3];

  const result = await executor({ itemName: 'diamond_sword', destination: 'hand' });

  t.true(result.content[0].text.includes('Couldn\'t find'));
});

const setupDropItem = (items: { name: string; count: number; type: number; metadata: number }[]) => {
  const mockServer = { tool: sinon.stub() } as unknown as McpServer;
  const mockConnection = {
    checkConnectionAndReconnect: sinon.stub().resolves({ connected: true })
  } as unknown as BotConnection;
  const factory = new ToolFactory(mockServer, mockConnection);
  const mockBot = {
    inventory: { items: () => items },
    toss: sinon.stub().resolves()
  } as unknown as Partial<mineflayer.Bot>;

  registerInventoryTools(factory, () => mockBot as mineflayer.Bot);

  const call = (mockServer.tool as sinon.SinonStub).getCalls().find(c => c.args[0] === 'drop-item');
  return { executor: call!.args[3], toss: mockBot.toss as sinon.SinonStub };
};

test('drop-item drops all matching items by default', async (t) => {
  const { executor, toss } = setupDropItem([
    { name: 'cobblestone', count: 64, type: 1, metadata: 0 },
    { name: 'cobblestone', count: 6, type: 1, metadata: 0 }
  ]);
  const result = await executor({ itemName: 'cobblestone' });
  t.is(result.content[0].text, 'Dropped 70 cobblestone');
  t.true(toss.calledOnceWith(1, 0, 70));
});

test('drop-item caps count at the amount in inventory', async (t) => {
  const { executor, toss } = setupDropItem([{ name: 'coal', count: 3, type: 5, metadata: 0 }]);
  const result = await executor({ itemName: 'coal', count: 10 });
  t.is(result.content[0].text, 'Dropped 3 coal');
  t.true(toss.calledOnceWith(5, 0, 3));
});

test('drop-item returns message when item not found', async (t) => {
  const { executor, toss } = setupDropItem([]);
  const result = await executor({ itemName: 'diamond' });
  t.true(result.content[0].text.includes("Couldn't find any item matching 'diamond'"));
  t.false(toss.called);
});

test('drop-item returns error when toss fails', async (t) => {
  const { executor, toss } = setupDropItem([{ name: 'dirt', count: 1, type: 3, metadata: 0 }]);
  toss.rejects(new Error('window closed'));
  const result = await executor({ itemName: 'dirt' });
  t.true(result.isError);
  t.true(result.content[0].text.includes('window closed'));
});

test('drop-item prefers an exact name match over an earlier partial match', async (t) => {
  const { executor, toss } = setupDropItem([
    { name: 'wheat_seeds', count: 5, type: 10, metadata: 0 },
    { name: 'wheat', count: 2, type: 11, metadata: 0 }
  ]);
  const result = await executor({ itemName: 'wheat' });
  t.is(result.content[0].text, 'Dropped 2 wheat');
  t.true(toss.calledOnceWith(11, 0, 2));
});

const setupUseItem = (heldItem: { name: string } | null, offHandItem: { name: string } | null = null) => {
  const mockServer = { tool: sinon.stub() } as unknown as McpServer;
  const mockConnection = {
    checkConnectionAndReconnect: sinon.stub().resolves({ connected: true })
  } as unknown as BotConnection;
  const factory = new ToolFactory(mockServer, mockConnection);
  const slots: unknown[] = [];
  slots[45] = offHandItem;
  const mockBot = {
    heldItem,
    inventory: { slots },
    getEquipmentDestSlot: () => 45,
    registry: { foodsByName: { bread: {}, cooked_beef: {} } },
    activateItem: sinon.stub(),
    deactivateItem: sinon.stub(),
    consume: sinon.stub().resolves()
  } as unknown as Partial<mineflayer.Bot>;

  registerInventoryTools(factory, () => mockBot as mineflayer.Bot);

  const call = (mockServer.tool as sinon.SinonStub).getCalls().find(c => c.args[0] === 'use-item');
  return {
    executor: call!.args[3],
    activateItem: mockBot.activateItem as sinon.SinonStub,
    deactivateItem: mockBot.deactivateItem as sinon.SinonStub,
    consume: mockBot.consume as sinon.SinonStub
  };
};

test('use-item activates a non-food held item', async (t) => {
  const { executor, activateItem, deactivateItem, consume } = setupUseItem({ name: 'snowball' });
  const result = await executor({});
  t.is(result.content[0].text, 'Used snowball');
  t.true(activateItem.calledOnceWith(false));
  t.false(deactivateItem.called);
  t.false(consume.called);
});

test('use-item consumes food until finished', async (t) => {
  const { executor, activateItem, consume } = setupUseItem({ name: 'bread' });
  const result = await executor({});
  t.is(result.content[0].text, 'Consumed bread');
  t.true(consume.calledOnce);
  t.false(activateItem.called);
});

test('use-item consumes potions', async (t) => {
  const { executor, consume } = setupUseItem({ name: 'potion' });
  const result = await executor({});
  t.is(result.content[0].text, 'Consumed potion');
  t.true(consume.calledOnce);
});

test('use-item returns error when consume fails', async (t) => {
  const { executor, consume } = setupUseItem({ name: 'cooked_beef' });
  consume.rejects(new Error('Food is full'));
  const result = await executor({});
  t.true(result.isError);
  t.true(result.content[0].text.includes('Food is full'));
});

test('use-item holds and releases the item for holdSeconds', async (t) => {
  const clock = sinon.useFakeTimers();
  t.teardown(() => clock.restore());
  const { executor, activateItem, deactivateItem } = setupUseItem({ name: 'bow' });
  const pending = executor({ holdSeconds: 1.5 });
  await clock.tickAsync(1499);
  t.true(activateItem.calledOnceWith(false));
  t.false(deactivateItem.called);
  await clock.tickAsync(1);
  const result = await pending;
  t.is(result.content[0].text, 'Used bow for 1.5s');
  t.true(deactivateItem.calledOnce);
});

test('use-item uses the off-hand item when offHand is true', async (t) => {
  const { executor, activateItem } = setupUseItem({ name: 'bread' }, { name: 'shield' });
  const result = await executor({ offHand: true });
  t.is(result.content[0].text, 'Used shield');
  t.true(activateItem.calledOnceWith(true));
});

test('use-item returns message when the hand is empty', async (t) => {
  const { executor, activateItem } = setupUseItem(null);
  const mainHand = await executor({});
  const offHand = await executor({ offHand: true });
  t.is(mainHand.content[0].text, 'The bot is not holding anything in its main hand');
  t.is(offHand.content[0].text, 'The bot is not holding anything in its off hand');
  t.false(activateItem.called);
});

test('use-item rejects a non-positive holdSeconds', async (t) => {
  const { executor, activateItem } = setupUseItem({ name: 'bow' });
  const result = await executor({ holdSeconds: 0 });
  t.true(result.isError);
  t.false(activateItem.called);
});
