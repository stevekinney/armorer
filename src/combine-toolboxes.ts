import { createToolbox, type Toolbox, type ToolboxContext } from './create-toolbox';

/**
 * Combine one or more Toolbox instances into a fresh Toolbox.
 *
 * - Tools are copied via `toJSON()` and registered into a new toolbox.
 * - If multiple toolboxes define the same tool name, the **last** one wins.
 * - Contexts are shallow-merged in the same order (last one wins on key collisions).
 */
export function combineToolboxes(...toolboxes: [Toolbox, ...Toolbox[]]): Toolbox {
  if (toolboxes.length === 0) {
    throw new TypeError('combineToolboxes() requires at least 1 Toolbox');
  }

  const context: ToolboxContext = {};
  for (const toolbox of toolboxes) {
    const ctx = toolbox.getContext?.();
    if (ctx && typeof ctx === 'object') {
      Object.assign(context, ctx);
    }
  }

  const combined = createToolbox([], { context });

  for (const toolbox of toolboxes) {
    combined.register(...toolbox.toJSON());
  }

  return combined;
}
