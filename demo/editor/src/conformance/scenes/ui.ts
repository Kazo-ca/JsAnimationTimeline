// demo/editor/src/conformance/scenes/ui.ts
import type { ITimelineDocument, TimelinePropertyValue } from '@kazo-ca/timeline-runtime';

const number = (value: number): TimelinePropertyValue => ({ kind: 'number', value });

/** Frozen copy of the property-editor scene: a card with three tracks and a tweened orb. */
export function uiDocument(): ITimelineDocument {
  return {
    version: '2.0.0',
    settings: { fps: 24, totalFrames: 100 },
    layers: [
      { id: 'card', type: 'layer', name: 'Carte', target: { ref: 'card' }, spans: [], propertyTimelines: {
        opacity: { label: 'Opacité', initialValue: number(1), keys: [{ frame: 1, value: number(0.2) }, { frame: 100, value: number(1) }] },
        x: { label: 'Position X', initialValue: number(0), keys: [{ frame: 1, value: number(0) }, { frame: 100, value: number(220) }] },
        rotation: { label: 'Rotation', initialValue: number(0), keys: [{ frame: 1, value: number(0) }] }
      } },
      { id: 'orb', type: 'layer', name: 'Orbe', target: { ref: 'orb' }, spans: [], propertyTimelines: {
        x: { label: 'Position X', initialValue: number(0), keys: [{ frame: 1, value: number(0) }, { frame: 100, value: number(140) }],
          transitions: [{ id: 'orb-motion', fromFrame: 1, toFrame: 100, easing: { kind: 'effect', family: 'elastic', mode: 'out' } }] }
      } }
    ]
  };
}
