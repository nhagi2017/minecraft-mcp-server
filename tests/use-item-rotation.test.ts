import test from 'ava';
import sinon from 'sinon';
import { patchUseItemRotation } from '../src/use-item-rotation.js';
import type mineflayer from 'mineflayer';

test('patchUseItemRotation sends the bot\'s current rotation in use_item packets', (t) => {
  const write = sinon.stub();
  const bot = {
    entity: { yaw: Math.PI / 2, pitch: -Math.PI / 4 },
    _client: { write }
  } as unknown as mineflayer.Bot;

  patchUseItemRotation(bot);
  bot._client.write('use_item', { hand: 0, sequence: 1, rotation: { x: 0, y: 0 } });
  bot._client.write('arm_animation', { hand: 0 });

  t.deepEqual(write.firstCall.args, ['use_item', { hand: 0, sequence: 1, rotation: { x: 90, y: 45 } }]);
  t.deepEqual(write.secondCall.args, ['arm_animation', { hand: 0 }]);
});
