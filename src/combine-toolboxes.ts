import {
  createToolbox,
  type SerializedToolbox,
  type ToolboxContext,
} from './create-toolbox';

type ToolboxLike = {
  toJSON: () => SerializedToolbox;
  getContext?: () => ToolboxContext;
};

/**
 * Combine one or more Toolbox instances into a fresh Toolbox.
 *
 * - Tools are copied via `toJSON()` and provided to a new immutable toolbox.
 * - If multiple toolboxes define the same tool name, the **last** one wins.
 * - Contexts are shallow-merged in the same order (last one wins on key collisions).
 */
export function combineToolboxes(
  ...toolboxes: [ToolboxLike, ...ToolboxLike[]]
) {
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

  const configurations = toolboxes.flatMap((toolbox) => toolbox.toJSON());
  return createToolbox(configurations, { context });
}
