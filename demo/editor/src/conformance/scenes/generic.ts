// demo/editor/src/conformance/scenes/generic.ts
import type { ITimelineDocument } from '@kazo-ca/timeline-runtime';

/** Frozen copy of the empty generic scene used by the TL-C cases: one object, no keys. */
export function emptyGenericDocument(totalFrames = 100): ITimelineDocument {
  return {
    version: '2.0.0',
    settings: { fps: 24, totalFrames },
    layers: [{ id: 'logo', type: 'layer', name: 'Objet', target: { ref: 'logo' }, spans: [] }]
  };
}
