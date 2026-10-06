import type mineflayer from 'mineflayer';

/**
 * Since 1.21 the server turns the player to the rotation carried in the use_item packet,
 * but mineflayer's activateItem() (also used by consume() and fishing) always sends 0/0,
 * so buckets and bows ignore look-at. Rewrite that field with the bot's actual yaw and
 * pitch, converted like mineflayer's conversions.toNotchianYaw/toNotchianPitch.
 * Remove once mineflayer sends the real rotation itself.
 */
export function patchUseItemRotation(bot: mineflayer.Bot): void {
  const client = bot._client;
  const write = client.write.bind(client);
  client.write = (name: string, params: Record<string, unknown>) => {
    if (name === 'use_item' && params.rotation) {
      params = {
        ...params,
        rotation: {
          x: (Math.PI - bot.entity.yaw) * 180 / Math.PI,
          y: -bot.entity.pitch * 180 / Math.PI
        }
      };
    }
    return write(name, params);
  };
}
