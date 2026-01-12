import { type Armorer, type ArmorerContext, createArmorer } from './create-armorer';

/**
 * Combine one or more Armorer instances into a fresh Armorer.
 *
 * - Tools are copied via `toJSON()` and registered into a new armorer.
 * - If multiple armorers define the same tool name, the **last** one wins.
 * - Contexts are shallow-merged in the same order (last one wins on key collisions).
 */
export function combineArmorers(...armorers: [Armorer, ...Armorer[]]): Armorer {
  if (armorers.length === 0) {
    throw new TypeError('combineArmorers() requires at least 1 Armorer');
  }

  const context: ArmorerContext = {};
  for (const armorer of armorers) {
    const ctx = armorer.getContext?.();
    if (ctx && typeof ctx === 'object') {
      Object.assign(context, ctx);
    }
  }

  const combined = createArmorer([], { context });

  for (const armorer of armorers) {
    combined.register(...armorer.toJSON());
  }

  return combined;
}
