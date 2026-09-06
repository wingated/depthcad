import { registerKind } from '../engine/kinds.js';

// Groups have no transform of their own: moving a group moves its children.
// Modifiers on a group act on the group's composite (adjustment-layer semantics).
registerKind({
  kind: 'group', label: 'Group', icon: '▣',
  schema: {},
  hint: 'Masks inside a group only affect the layers above them in that group. Modifiers on the group apply to everything in it.',
  measure() { return { w: 0, h: 0 }; },
  render() { return null; },
});
