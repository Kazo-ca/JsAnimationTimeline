// packages/runtime/src/playback/html/__tests__/gradientCrossing.test.ts
import type { ILayer } from '../../../model/layer';
import type { IPropertyTimeline } from '../../../model/propertyTimeline';
import type { IHtmlAnimationContext } from '../../../stage/html/animationTypes';
import { createHtmlStage } from '../../../stage/html/createHtmlStage';
import { createHost, docOf, timeAt } from '../../../stage/__tests__/fakeStage';
import { compileHtmlPlayback } from '../compileHtmlPlayback';
import { createHtmlPlaybackPlayer } from '../createHtmlPlaybackPlayer';
import { parseHtmlPlayback } from '../parseHtmlPlayback';

const n = (value: number) => ({ kind: 'number' as const, value });
const motion = (id: string, from: number, to: number): IPropertyTimeline => ({ initialValue: n(from),
  keys: [{ frame: 1, value: n(from) }, { frame: 5, value: n(to) }], transitions: [{ id, fromFrame: 1, toFrame: 5 }] });
const context: IHtmlAnimationContext = { version: 1, bindings: { fill: {
  redPosition: { kind: 'gradient', gradientId: 'fill', stopId: 'red', component: 'position' },
  bluePosition: { kind: 'gradient', gradientId: 'fill', stopId: 'blue', component: 'position' }
} }, gradients: { fill: [{ id: 'fill', cssName: 'background-image', type: 'linear', angle: 90,
  centerX: 50, centerY: 50, radiusX: 50, radiusY: 50, stops: [
    { id: 'red', color: { kind: 'color', r: 1, g: 0, b: 0, a: 1 }, position: 20, opacity: 1, present: true },
    { id: 'blue', color: { kind: 'color', r: 0, g: 0, b: 1, a: 1 }, position: 80, opacity: 1, present: true }
  ] }] } };
const layer: ILayer = { id: 'fill', name: 'Gradient', type: 'layer', target: { selector: '#box' }, spans: [],
  propertyTimelines: { redPosition: motion('red-move', 20, 80), bluePosition: motion('blue-move', 80, 20) } };
const css = (stops: string) => `linear-gradient(90deg, ${stops})`;
const expected: Readonly<Record<number, string>> = {
  1: css('rgba(255, 0, 0, 1) 20%, rgba(0, 0, 255, 1) 80%'),
  2: css('rgba(255, 0, 0, 1) 35%, rgba(0, 0, 255, 1) 65%'),
  3: css('rgba(255, 0, 0, 1) 50%, rgba(0, 0, 255, 1) 50%'),
  4: css('rgba(0, 0, 255, 1) 35%, rgba(255, 0, 0, 1) 65%'),
  5: css('rgba(0, 0, 255, 1) 20%, rgba(255, 0, 0, 1) 80%'),
  3.5: css('rgba(0, 0, 255, 1) 42.5%, rgba(255, 0, 0, 1) 57.5%')
};
function normalized(value: string): string {
  const style = document.createElement('div').style;
  style.backgroundImage = value;
  expect(style.backgroundImage).not.toBe('');
  return style.backgroundImage;
}

beforeEach(() => { document.body.innerHTML = '<main id="scene"><div id="box" style="color:red"></div></main>'; });

test('renders crossings by stable stop identity for direct, fractional and backwards seeks', () => {
  const root = document.querySelector('main')!;
  const box = document.getElementById('box')!;
  const doc = docOf([layer], 5);
  const before = JSON.stringify({ doc, context });
  const errors: unknown[] = [];
  const stage = createHtmlStage({ root, mode: 'frame', animationContext: context });
  const host = createHost([stage], errors);
  try {
    host.load(doc);
    for (const frame of [4, 1, 3, 3.5, 5, 2]) {
      host.render(timeAt(frame));
      expect(box.style.backgroundImage).toBe(normalized(expected[frame]));
    }
    expect(JSON.stringify({ doc, context })).toBe(before);
    expect(stage.animationContext.gradients?.fill[0].stops.map((stop) => stop.id)).toEqual(['red', 'blue']);
    expect(errors).toEqual([]);
  } finally { host.destroy(); }
  expect(box.style.backgroundImage).toBe('');
  expect(box.style.color).toBe('red');
});

test('roundtrips sorted integer snapshots and preserves direct and backwards playback', () => {
  const root = document.querySelector('main')!;
  const box = document.getElementById('box')!;
  const doc = docOf([layer], 5);
  const before = JSON.stringify({ doc, context });
  const compiled = compileHtmlPlayback(doc, { root, animationContext: context });
  if (compiled.status !== 'exported') throw new Error(JSON.stringify(compiled.diagnostics));
  const roundtrip: unknown = JSON.parse(JSON.stringify(compiled.data));
  const restored = parseHtmlPlayback(roundtrip);
  const groupId = restored.groups[0].id;
  for (const frame of [1, 2, 3, 4, 5]) expect(restored.frames[String(frame)][groupId]['background-image']).toBe(expected[frame]);
  expect(JSON.stringify({ doc, context })).toBe(before);
  const player = createHtmlPlaybackPlayer(restored, { root });
  try {
    for (const frame of [4, 1, 3, 5, 2, 3.5]) {
      player.seek(frame);
      expect(box.style.backgroundImage).toBe(normalized(expected[Math.floor(frame)]));
    }
  } finally { player.destroy(); }
  expect(box.style.backgroundImage).toBe('');
  expect(box.style.color).toBe('red');
});
