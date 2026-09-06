import { registerKind, KINDS } from '../engine/kinds.js';
import './image.js';

// A mesh layer is a baked depth image (an image asset with coverage) that remembers the
// mesh it came from and the bake parameters, so it can be re-baked from the import dialog.
registerKind({
  kind: 'mesh', label: 'Mesh', icon: '◭',
  schema: {},
  hint: 'A depth "screenshot" of a 3D model. Re-bake to change orientation, framing, resolution or the clipping planes.',
  measure(n, ctx) { return KINDS.image.measure(n, ctx); },
  cacheKey(n) { return 'mesh|' + n.params.imageId; },
  render(n, opts) { return KINDS.image.render(n, opts); },
});
