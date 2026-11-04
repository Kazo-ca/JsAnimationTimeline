// e2e/conformance/tl-conformance.spec.ts
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { IPropertyTimeline, ITimelineDocument, PropertyEasing, TimelinePropertyValue } from '@kazo-ca/timeline-runtime';
import type { SerializableDescriptor } from '../../demo/editor/src/conformance/types';

/**
 * TL-C01..TL-C18 contract cases (section 9 of doc/integration/timeline-contract.md),
 * run against the BUILT packages through /conformance/conformance.html.
 * The public API is driven through page.evaluate; the UI only serves C11, C12 and C17 (Escape).
 */

const PAGE_URL = '/conformance/conformance.html';
const num = (value: number): TimelinePropertyValue => ({ kind: 'number', value });
const key = (frame: number, value: number) => ({ frame, value: num(value) });
const fade = (id: string, fromFrame: number, toFrame: number, easing?: PropertyEasing) => ({ id, fromFrame, toFrame, ...(easing === undefined ? {} : { easing }) });

function logoDocument(propertyTimelines: Record<string, IPropertyTimeline>, totalFrames = 100): ITimelineDocument {
  return {
    version: '2.0.0', settings: { fps: 24, totalFrames },
    layers: [{ id: 'logo', type: 'layer', name: 'Objet', target: { ref: 'logo' }, spans: [], propertyTimelines }]
  };
}
const opacityTween = (easing?: PropertyEasing): IPropertyTimeline => ({
  initialValue: num(1), keys: [key(1, 0.2), key(100, 1)], transitions: [fade('fade', 1, 100, easing)]
});
const xTrack = (...keys: ReturnType<typeof key>[]): IPropertyTimeline => ({ initialValue: num(0), keys });
/** Frames 1, 1.125 ... 100: the fractional grid of the contract. */
const FINE_FRAMES = Array.from({ length: 793 }, (_, index) => 1 + index / 8);
const HALF_FRAMES = Array.from({ length: 199 }, (_, index) => 1 + index / 2);

const problems = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  problems.set(page, errors);
  page.on('pageerror', (error) => errors.push('pageerror: ' + error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') errors.push(message.type() + ': ' + message.text());
  });
  page.on('requestfailed', (request) => errors.push('requestfailed: ' + request.url() + ' ' + request.failure()?.errorText));
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(PAGE_URL);
  await page.waitForFunction(() => window.tlConformance?.ready === true);
});

test.afterEach(async ({ page }) => {
  await page.evaluate(() => window.tlConformance?.dispose());
  expect(problems.get(page)).toEqual([]);
});

/** Creates a generic editor on the page; it stays reachable as `window.tlConformance.current`. */
async function openGeneric(page: Page, document: ITimelineDocument, options: { host?: 'open' | 'tween-guard'; extra?: SerializableDescriptor[] } = {}): Promise<void> {
  await page.evaluate(({ text, host, extra }) => {
    window.tlConformance?.createGenericEditor({ document: JSON.parse(text), host, extraProperties: extra });
  }, { text: JSON.stringify(document), host: options.host, extra: options.extra });
}

/** Evaluated number of `property` on the layer `logo` at each of `frames`. */
function samples(page: Page, property: string, frames: readonly number[]): Promise<(number | undefined)[]> {
  return page.evaluate(({ property, frames }) => {
    const editor = window.tlConformance?.current?.editor;
    if (editor === undefined) throw new Error('Aucun éditeur.');
    return frames.map((frame) => {
      const value = editor.sample(frame).layer('logo')?.propertyValues?.[property];
      return value?.kind === 'number' ? value.value : undefined;
    });
  }, { property, frames });
}

function currentDocument(page: Page): Promise<ITimelineDocument> {
  return page.evaluate(() => JSON.parse(JSON.stringify(window.tlConformance?.current?.editor.document)) as ITimelineDocument);
}
function timeline(document: ITimelineDocument, property: string): IPropertyTimeline | undefined {
  const layer = document.layers[0];
  return layer.type === 'layer' ? layer.propertyTimelines?.[property] : undefined;
}

test('TL-C01 — éditer une propriété à l’image 50 crée ou modifie uniquement sa clé à 50', async ({ page }) => {
  await openGeneric(page, logoDocument({ opacity: opacityTween() }));
  const before = await currentDocument(page);
  const created = await page.evaluate(() => {
    const handle = window.tlConformance?.current;
    const result = handle?.editor.propertyTimelines.set('logo', 'x', { kind: 'number', value: 30 }, { frame: 50, initialValue: { kind: 'number', value: 0 } });
    return { result, events: handle?.events.map(({ property, frame, kind }) => ({ property, frame, kind })) };
  });
  expect(created.result).toEqual({ status: 'changed' });
  expect(created.events).toEqual([{ property: 'x', frame: 50, kind: 'key' }]);
  const afterCreate = await currentDocument(page);
  expect(timeline(afterCreate, 'x')?.keys).toEqual([key(50, 30)]);
  expect(timeline(afterCreate, 'opacity')).toEqual(timeline(before, 'opacity'));
  const updated = await page.evaluate(() => window.tlConformance?.current?.editor.propertyTimelines.set('logo', 'x', { kind: 'number', value: 45 }, { frame: 50 }));
  expect(updated).toEqual({ status: 'changed' });
  const afterUpdate = await currentDocument(page);
  expect(timeline(afterUpdate, 'x')?.keys).toEqual([key(50, 45)]);
  expect(timeline(afterUpdate, 'opacity')).toEqual(timeline(before, 'opacity'));
  const undone = await page.evaluate(() => {
    const editor = window.tlConformance?.current?.editor;
    return [editor?.undo(), editor?.undo(), editor?.canUndo];
  });
  expect(undone).toEqual([true, true, false]);
  expect(await currentDocument(page)).toEqual(before);
});

test('TL-C02 — une position à l’image 50 ne touche pas le tween d’opacité 1–100', async ({ page }) => {
  await openGeneric(page, logoDocument({ opacity: opacityTween({ kind: 'effect', family: 'sine', mode: 'in' }) }));
  const before = await currentDocument(page);
  const opacityBefore = await samples(page, 'opacity', HALF_FRAMES);
  const result = await page.evaluate(() => window.tlConformance?.current?.editor.propertyTimelines.set('logo', 'x', { kind: 'number', value: 120 }, { frame: 50, initialValue: { kind: 'number', value: 0 } }));
  expect(result).toEqual({ status: 'changed' });
  const after = await currentDocument(page);
  expect(timeline(after, 'opacity')).toEqual(timeline(before, 'opacity'));
  expect(timeline(after, 'opacity')?.keys).toHaveLength(2);
  expect(timeline(after, 'opacity')?.transitions).toHaveLength(1);
  expect(await samples(page, 'opacity', HALF_FRAMES)).toEqual(opacityBefore);
});

test('TL-C03 — une clé insérée sans changement capture la valeur évaluée, sans réinitialisation implicite', async ({ page }) => {
  await openGeneric(page, logoDocument({
    opacity: opacityTween({ kind: 'effect', family: 'cubic', mode: 'in' }),
    x: xTrack(key(1, 10), key(60, 90))
  }));
  const before = await currentDocument(page);
  const opacityBefore = await samples(page, 'opacity', HALF_FRAMES);
  const xBefore = await samples(page, 'x', HALF_FRAMES);
  const expectedOpacity = opacityBefore[HALF_FRAMES.indexOf(40)];
  const captured = await page.evaluate(() => {
    const facade = window.tlConformance?.current?.editor.propertyTimelines;
    return [facade?.capture('logo', 'opacity', { frame: 40 }), facade?.capture('logo', 'x', { frame: 30 })];
  });
  expect(captured).toEqual([{ status: 'changed' }, { status: 'changed' }]);
  const after = await currentDocument(page);
  expect(timeline(after, 'opacity')?.keys.find((entry) => entry.frame === 40)).toEqual({ frame: 40, value: num(expectedOpacity ?? Number.NaN) });
  expect(timeline(after, 'x')?.keys).toEqual([key(1, 10), key(30, 10), key(60, 90)]);
  expect(await samples(page, 'opacity', HALF_FRAMES)).toEqual(opacityBefore);
  expect(await samples(page, 'x', HALF_FRAMES)).toEqual(xBefore);
  expect(timeline(after, 'x')?.initialValue).toEqual(timeline(before, 'x')?.initialValue);
});

test('TL-C04 — sans tween, la valeur persiste jusqu’à la clé suivante, puis après la dernière', async ({ page }) => {
  await openGeneric(page, logoDocument({ x: xTrack(key(1, 10), key(30, 50), key(60, 90)) }));
  const frames = [1, 15, 29, 29.875, 30, 45, 59.875, 60, 80, 100];
  expect(await samples(page, 'x', frames)).toEqual([10, 10, 10, 10, 50, 50, 50, 90, 90, 90]);
  const rendered = await page.evaluate(() => {
    const handle = window.tlConformance?.current;
    return [20, 45, 75].map((frame) => {
      handle?.editor.playback.seek(frame);
      handle?.clock.advance(16);
      const value = handle?.objectValues('logo')?.x;
      return value?.kind === 'number' ? value.value : undefined;
    });
  });
  expect(rendered).toEqual([10, 50, 90]);
});

test('TL-C05 — sans recouvrement, origine à 100 % et première clé à 50 = 80 % : 100 % avant 50, aucune clé à 1', async ({ page }) => {
  await openGeneric(page, logoDocument({}));
  const result = await page.evaluate(() => window.tlConformance?.current?.editor.propertyTimelines.set('logo', 'opacity', { kind: 'number', value: 0.8 }, { frame: 50, initialValue: { kind: 'number', value: 1 } }));
  expect(result).toEqual({ status: 'changed' });
  const document = await currentDocument(page);
  expect(timeline(document, 'opacity')?.keys).toEqual([key(50, 0.8)]);
  expect(timeline(document, 'opacity')?.initialValue).toEqual(num(1));
  expect(timeline(document, 'opacity')?.transitions ?? []).toEqual([]);
  expect(await samples(page, 'opacity', [1, 25, 49, 49.875])).toEqual([1, 1, 1, 1]);
  expect(await samples(page, 'opacity', [50, 75, 100])).toEqual([0.8, 0.8, 0.8]);
});

test('TL-C07 — une insertion dans un tween non linéaire crée deux transitions indépendantes et préserve le mouvement initial', async ({ page }) => {
  await openGeneric(page, logoDocument({
    x: { initialValue: num(0), keys: [key(1, 0), key(100, 140)], transitions: [fade('move', 1, 100, { kind: 'effect', family: 'cubic', mode: 'in' })] }
  }));
  const before = await samples(page, 'x', FINE_FRAMES);
  expect(before[FINE_FRAMES.indexOf(20)]).not.toBeCloseTo((140 * 19) / 99, 3);
  const captured = await page.evaluate(() => window.tlConformance?.current?.editor.propertyTimelines.capture('logo', 'x', { frame: 40 }));
  expect(captured).toEqual({ status: 'changed' });
  const split = timeline(await currentDocument(page), 'x');
  expect(split?.keys.map(({ frame }) => frame)).toEqual([1, 40, 100]);
  expect(split?.transitions?.map(({ fromFrame, toFrame }) => [fromFrame, toFrame])).toEqual([[1, 40], [40, 100]]);
  expect(new Set(split?.transitions?.map(({ id }) => id)).size).toBe(2);
  expect(await samples(page, 'x', FINE_FRAMES)).toEqual(before);

  // Editing the first half leaves the second half untouched.
  const secondHalfFrames = FINE_FRAMES.filter((frame) => frame >= 40);
  const secondBefore = await samples(page, 'x', secondHalfFrames);
  const firstId = split?.transitions?.[0].id ?? '';
  const edited = await page.evaluate((id) => window.tlConformance?.current?.editor.propertyTimelines.setEasing('logo', 'x', id), firstId);
  expect(edited).toEqual({ status: 'changed' });
  expect(await samples(page, 'x', [20])).not.toEqual([before[FINE_FRAMES.indexOf(20)]]);
  expect(await samples(page, 'x', secondHalfFrames)).toEqual(secondBefore);

  // Removing the second half leaves the first half untouched and holds the key at 40.
  const secondId = split?.transitions?.[1].id ?? '';
  const firstHalfFrames = FINE_FRAMES.filter((frame) => frame <= 40);
  const firstAfter = await samples(page, 'x', firstHalfFrames);
  const removed = await page.evaluate((id) => window.tlConformance?.current?.editor.propertyTimelines.removeTransition('logo', 'x', id), secondId);
  expect(removed).toEqual({ status: 'changed' });
  expect(await samples(page, 'x', firstHalfFrames)).toEqual(firstAfter);
  const [held, atKey] = await Promise.all([samples(page, 'x', [70, 99.875]), samples(page, 'x', [40])]);
  expect(held).toEqual([atKey[0], atKey[0]]);
});

test('TL-C08 — un MotionTween exige exactement deux clés d’une même propriété et refuse une incompatibilité avec un motif', async ({ page }) => {
  const label: IPropertyTimeline = { initialValue: { kind: 'text', value: 'A' }, keys: [{ frame: 1, value: { kind: 'text', value: 'A' } }, { frame: 100, value: { kind: 'text', value: 'B' } }] };
  await openGeneric(page, logoDocument({ x: xTrack(key(1, 0), key(50, 20), key(100, 40)), label }));
  const before = await currentDocument(page);
  const attempts = await page.evaluate(() => {
    const handle = window.tlConformance?.current;
    const facade = handle?.editor.propertyTimelines;
    return {
      single: facade?.createTransition('logo', 'x', [1]),
      three: facade?.createTransition('logo', 'x', [1, 50, 100]),
      notAdjacent: facade?.createTransition('logo', 'x', [1, 100]),
      missingKey: facade?.createTransition('logo', 'x', [1, 77]),
      incompatible: facade?.createTransition('logo', 'label', [1, 100]),
      canUndo: handle?.editor.canUndo,
      events: handle?.events.length
    };
  });
  for (const name of ['single', 'three', 'notAdjacent', 'missingKey', 'incompatible'] as const) {
    const attempt = attempts[name];
    expect(attempt?.status, name).toBe('refused');
    expect(attempt?.status === 'refused' ? attempt.reason.length : 0, name).toBeGreaterThan(0);
  }
  expect(attempts.canUndo).toBe(false);
  expect(attempts.events).toBe(0);
  expect(await currentDocument(page)).toEqual(before);
  const accepted = await page.evaluate(() => window.tlConformance?.current?.editor.propertyTimelines.createTransition('logo', 'x', [1, 50]));
  expect(accepted).toEqual({ status: 'changed' });
  expect(timeline(await currentDocument(page), 'x')?.transitions?.map(({ fromFrame, toFrame }) => [fromFrame, toFrame])).toEqual([[1, 50]]);
});

test('TL-C09 — une édition qui invalide un tween est refusée sans détruire la transition existante', async ({ page }) => {
  await openGeneric(page, logoDocument({ opacity: opacityTween(), x: xTrack(key(1, 0), key(100, 50)) }), { host: 'tween-guard' });
  const before = await currentDocument(page);
  const outcome = await page.evaluate(() => {
    const handle = window.tlConformance?.current;
    const facade = handle?.editor.propertyTimelines;
    const initial = handle?.editor.document;
    return {
      set: facade?.set('logo', 'opacity', { kind: 'number', value: 0.5 }, { frame: 1 }),
      setInside: facade?.set('logo', 'opacity', { kind: 'number', value: 0.5 }, { frame: 50 }),
      moveKey: facade?.moveKey('logo', 'opacity', 100, 90),
      deleteKey: facade?.deleteKey('logo', 'opacity', 100),
      sameDocument: handle?.editor.document === initial,
      canUndo: handle?.editor.canUndo, events: handle?.events.length
    };
  });
  for (const name of ['set', 'setInside', 'moveKey', 'deleteKey'] as const) {
    const result = outcome[name];
    expect(result?.status, name).toBe('refused');
    expect(result?.status === 'refused' ? result.reason.length : 0, name).toBeGreaterThan(0);
  }
  expect(outcome.sameDocument).toBe(true);
  expect(outcome.canUndo).toBe(false);
  expect(outcome.events).toBe(0);
  const after = await currentDocument(page);
  expect(after).toEqual(before);
  expect(timeline(after, 'opacity')?.transitions).toEqual([fade('fade', 1, 100)]);
  const control = await page.evaluate(() => window.tlConformance?.current?.editor.propertyTimelines.set('logo', 'x', { kind: 'number', value: 25 }, { frame: 50 }));
  expect(control).toEqual({ status: 'changed' });
  expect(timeline(await currentDocument(page), 'opacity')).toEqual(timeline(before, 'opacity'));
});

test('TL-C10 — un geste X/Y modifie deux propriétés en une seule annulation, et son annulation ne laisse rien', async ({ page }) => {
  await openGeneric(page, logoDocument({ x: xTrack(key(1, 0)), y: xTrack(key(1, 0)) }));
  const before = await currentDocument(page);
  const committed = await page.evaluate(() => {
    const handle = window.tlConformance?.current;
    const editor = handle?.editor;
    const gesture = editor?.propertyTimelines.beginTransaction('Déplacer X/Y');
    const first = editor?.propertyTimelines.set('logo', 'x', { kind: 'number', value: 30 }, { frame: 40 });
    const second = editor?.propertyTimelines.set('logo', 'y', { kind: 'number', value: 12 }, { frame: 40 });
    const preview = editor?.sample(40).layer('logo')?.propertyValues;
    const committedOk = gesture?.commit();
    return { first, second, preview, committedOk, events: handle?.events.map(({ property, transactionId }) => [property, transactionId !== undefined]) };
  });
  expect(committed.first).toEqual({ status: 'changed' });
  expect(committed.second).toEqual({ status: 'changed' });
  expect(committed.preview?.x).toEqual(num(30));
  expect(committed.preview?.y).toEqual(num(12));
  expect(committed.committedOk).toBe(true);
  expect(committed.events).toEqual([['x', true], ['y', true]]);
  const changed = await currentDocument(page);
  expect(timeline(changed, 'x')?.keys).toEqual([key(1, 0), key(40, 30)]);
  expect(timeline(changed, 'y')?.keys).toEqual([key(1, 0), key(40, 12)]);
  const undone = await page.evaluate(() => {
    const editor = window.tlConformance?.current?.editor;
    return [editor?.undo(), editor?.canUndo];
  });
  expect(undone).toEqual([true, false]);
  expect(await currentDocument(page)).toEqual(before);

  const cancelled = await page.evaluate(() => {
    const editor = window.tlConformance?.current?.editor;
    const gesture = editor?.propertyTimelines.beginTransaction('Déplacer X/Y');
    editor?.propertyTimelines.set('logo', 'x', { kind: 'number', value: 70 }, { frame: 60 });
    editor?.propertyTimelines.set('logo', 'y', { kind: 'number', value: 71 }, { frame: 60 });
    gesture?.cancel();
    return { active: gesture?.active, canUndo: editor?.canUndo };
  });
  expect(cancelled).toEqual({ active: false, canUndo: false });
  expect(await currentDocument(page)).toEqual(before);
  expect(await samples(page, 'x', [60])).toEqual([0]);
  expect(await samples(page, 'y', [60])).toEqual([0]);
});

/** UI helpers shared by C11, C12 and C17: the production editor mounted by the page. */
const layerRow = (page: Page, id: string) => page.locator(`.jt-layer-row[data-row-id="${id}"]`);
const panelField = (page: Page, name: string) => page.locator(`.jt-properties-panel [data-property="${name}"] input`);
async function openUi(page: Page): Promise<void> {
  await page.evaluate(() => { window.tlConformance?.createUiEditor(); });
  await page.getByRole('combobox', { name: 'Niveau de zoom', exact: true }).selectOption({ label: 'Ajuster à la fenêtre' });
}
function uiSnapshot(page: Page) {
  return page.evaluate(() => {
    const handle = window.tlConformance?.current;
    if (handle === undefined) throw new Error('Aucun éditeur.');
    return { document: JSON.parse(JSON.stringify(handle.editor.document)) as unknown, canUndo: handle.editor.canUndo, canRedo: handle.editor.canRedo, events: handle.events.length };
  });
}
async function clickPropertyFrame(page: Page, layerId: string, property: string, frame: number): Promise<void> {
  await page.locator(`.jt-grid__row[data-layer-id="${layerId}"][data-property="${property}"]`).scrollIntoViewIfNeeded();
  const point = await page.evaluate(({ layerId, property, frame }) => {
    const grid = window.tlConformance?.current?.editor.getService('frames.grid');
    const row = grid?.rows().find((entry) => entry.kind === 'property' && entry.layerId === layerId && entry.property === property);
    const rect = grid?.element()?.getBoundingClientRect();
    if (grid === undefined || row === undefined || rect === undefined) throw new Error('Géométrie de propriété absente.');
    return { x: rect.left + (frame - 0.5) * grid.frameWidth(), y: rect.top + (row.index + 0.5) * grid.rowHeight() };
  }, { layerId, property, frame });
  await page.mouse.click(point.x, point.y);
  // Playhead notifications ride the manual clock.
  await page.evaluate(() => window.tlConformance?.current?.clock.advance(16));
}

test('TL-C11 — la navigation et la sélection actualisent les valeurs affichées sans édition ni clé ajoutée', async ({ page }) => {
  await openUi(page);
  const before = await uiSnapshot(page);
  await layerRow(page, 'orb').locator('.jt-layer-row__name').click();
  await clickPropertyFrame(page, 'orb', 'x', 1);
  await expect(page.locator('.jt-properties-panel__context')).toContainText('image 1');
  await expect(panelField(page, 'x')).toHaveValue('0');
  // The playhead notifies on the next clock frame: the manual clock drives it.
  await page.evaluate(() => {
    const handle = window.tlConformance?.current;
    handle?.editor.playback.seek(50);
    handle?.clock.advance(16);
  });
  const expected = await page.evaluate(() => {
    const value = window.tlConformance?.current?.editor.sample(50).layer('orb')?.propertyValues?.x;
    return value?.kind === 'number' ? value.value : undefined;
  });
  expect(expected).toBeGreaterThan(0);
  await expect(page.locator('.jt-properties-panel__context')).toContainText('image 50');
  await expect(panelField(page, 'x')).toHaveValue(String(expected));
  const rendered = await page.evaluate(() => {
    const value = window.tlConformance?.current?.objectValues('orb')?.x;
    return value?.kind === 'number' ? value.value : undefined;
  });
  expect(rendered).toBe(expected);
  await clickPropertyFrame(page, 'orb', 'x', 100);
  await expect(page.locator('.jt-properties-panel__context')).toContainText('image 100');
  await expect(panelField(page, 'x')).toHaveValue('140');
  await layerRow(page, 'card').locator('.jt-layer-row__name').click();
  const after = await uiSnapshot(page);
  expect(after.document).toEqual(before.document);
  expect(after.canUndo).toBe(false);
  expect(after.events).toBe(0);
});

test('TL-C12 — la sélection déplie temporairement les propriétés et restaure le repli manuel', async ({ page }) => {
  await openUi(page);
  const before = await uiSnapshot(page);
  const rows = (layer: string) => page.locator(`.jt-property-row[data-layer-id="${layer}"]`);
  await expect(rows('card')).toHaveCount(0);
  await layerRow(page, 'card').locator('.jt-layer-row__name').click();
  await expect(rows('card')).toHaveCount(3);
  await layerRow(page, 'orb').locator('.jt-layer-row__name').click();
  await expect(rows('card')).toHaveCount(0);
  await expect(rows('orb')).toHaveCount(1);
  // A manual unfold survives selection and deselection.
  await layerRow(page, 'card').getByRole('button', { name: 'Déplier les propriétés', exact: true }).click();
  await layerRow(page, 'card').locator('.jt-layer-row__name').click();
  await layerRow(page, 'orb').locator('.jt-layer-row__name').click();
  await expect(rows('card')).toHaveCount(3);
  // A manual fold made while the layer is selected is kept once the selection leaves it.
  await layerRow(page, 'card').locator('.jt-layer-row__name').click();
  await layerRow(page, 'card').getByRole('button', { name: 'Replier les propriétés', exact: true }).click();
  await expect(rows('card')).toHaveCount(0);
  await layerRow(page, 'orb').locator('.jt-layer-row__name').click();
  await expect(rows('card')).toHaveCount(0);
  const after = await uiSnapshot(page);
  expect(after.document).toEqual(before.document);
  expect(after.canUndo).toBe(false);
  expect(after.events).toBe(0);
});

test('TL-C16 — sauvegarde et réouverture conservent les clés et transitions originales, sans réimporter des images exportées', async ({ page }) => {
  const original = logoDocument({
    x: { initialValue: num(0), keys: [key(1, 0), key(40, 60), key(100, 140)], transitions: [fade('a', 1, 40, { kind: 'effect', family: 'back', mode: 'out', parameters: { amplitude: 2 } })] },
    opacity: opacityTween({ kind: 'bezier', x1: 0.25, y1: -0.5, x2: 0.7, y2: 1.5 })
  });
  await openGeneric(page, original);
  const saved = await page.evaluate(() => JSON.stringify(window.tlConformance?.current?.editor.toJSON()));
  const xBefore = await samples(page, 'x', HALF_FRAMES);
  const opacityBefore = await samples(page, 'opacity', HALF_FRAMES);
  await page.evaluate(() => window.tlConformance?.dispose());
  await openGeneric(page, logoDocument({}));
  const reloaded = await page.evaluate((text) => {
    const editor = window.tlConformance?.current?.editor;
    editor?.load(JSON.parse(text));
    return { canUndo: editor?.canUndo, canRedo: editor?.canRedo };
  }, saved);
  expect(reloaded).toEqual({ canUndo: false, canRedo: false });
  expect(await currentDocument(page)).toEqual(original);
  expect(await samples(page, 'x', HALF_FRAMES)).toEqual(xBefore);
  expect(await samples(page, 'opacity', HALF_FRAMES)).toEqual(opacityBefore);

  const exported = await page.evaluate(() => {
    const handle = window.tlConformance;
    const editor = handle?.current?.editor;
    if (handle === undefined || editor === undefined) throw new Error('Aucun éditeur.');
    const compiled = handle.runtime.compilePlayback(editor.document);
    const data = compiled.status === 'exported' ? JSON.parse(JSON.stringify(compiled.data)) as unknown : undefined;
    const snapshot = JSON.stringify(editor.document);
    let loadError: string | undefined;
    try { editor.load(data as never); } catch (error) { loadError = error instanceof Error ? error.message : String(error); }
    return { status: compiled.status, loadError, unchanged: JSON.stringify(editor.document) === snapshot,
      issues: handle.runtime.validateDocument(data).length };
  });
  expect(exported.status).toBe('exported');
  expect(exported.loadError ?? '').not.toBe('');
  expect(exported.issues).toBeGreaterThan(0);
  expect(exported.unchanged).toBe(true);
  expect(await currentDocument(page)).toEqual(original);
});

const EFFECTS: readonly { name: string; easing: PropertyEasing }[] = [
  { name: 'back', easing: { kind: 'effect', family: 'back', mode: 'out', parameters: { amplitude: 2 } } },
  { name: 'elastic', easing: { kind: 'effect', family: 'elastic', mode: 'out', parameters: { oscillations: 4, springiness: 3 } } },
  { name: 'bounce', easing: { kind: 'effect', family: 'bounce', mode: 'out', parameters: { bounces: 3, bounciness: 2 } } },
  { name: 'power-in', easing: { kind: 'effect', family: 'power', mode: 'in', parameters: { power: 3 } } }
];

test('TL-C17 — le choix d’un effet sur une transition donne une courbe et un rendu concordants, avec annulation et sauvegarde fidèles', async ({ page }) => {
  await openGeneric(page, logoDocument({ x: { initialValue: num(0), keys: [key(1, 0), key(100, 140)], transitions: [fade('move', 1, 100)] }, opacity: opacityTween() }));
  const baseline = await currentDocument(page);
  for (const { name, easing } of EFFECTS) {
    const outcome = await page.evaluate((easing) => {
      const handle = window.tlConformance;
      const editor = handle?.current?.editor;
      if (handle === undefined || editor === undefined) throw new Error('Aucun éditeur.');
      const result = editor.propertyTimelines.setEasing('logo', 'x', 'move', easing);
      const curve = handle.runtime.createPropertyEasingFunction(easing);
      const frames = Array.from({ length: 397 }, (_, index) => 1 + index / 4);
      const evaluated = frames.map((frame) => {
        const value = editor.sample(frame).layer('logo')?.propertyValues?.x;
        return { actual: value?.kind === 'number' ? value.value : Number.NaN, expected: 140 * curve((frame - 1) / 99) };
      });
      const saved = JSON.stringify(editor.document);
      const undone = editor.undo();
      const restored = JSON.stringify(editor.document);
      const redone = editor.redo();
      return { result, evaluated, saved, undone, restored, redone, reapplied: JSON.stringify(editor.document) === saved };
    }, easing);
    expect(outcome.result, name).toEqual({ status: 'changed' });
    expect(timeline(JSON.parse(outcome.saved) as ITimelineDocument, 'x')?.transitions?.[0].easing, name).toEqual(easing);
    for (const { actual, expected } of outcome.evaluated) expect(actual, name).toBeCloseTo(expected, 9);
    expect([outcome.undone, outcome.redone, outcome.reapplied], name).toEqual([true, true, true]);
    expect(JSON.parse(outcome.restored) as unknown, name).toEqual(baseline);
    expect(timeline(await currentDocument(page), 'opacity'), name).toEqual(timeline(baseline, 'opacity'));
    const reloaded = await page.evaluate((text) => {
      const editor = window.tlConformance?.current?.editor;
      editor?.load(JSON.parse(text));
      return JSON.stringify(editor?.document) === text;
    }, outcome.saved);
    expect(reloaded, name).toBe(true);
    await page.evaluate((text) => { window.tlConformance?.current?.editor.load(JSON.parse(text)); }, JSON.stringify(baseline));
  }
});

test('TL-C17 — Échap dans le dialogue d’effet annule le choix sans modifier le document', async ({ page }) => {
  await openUi(page);
  await layerRow(page, 'orb').locator('.jt-layer-row__name').click();
  await page.locator('.jt-property-row[data-layer-id="orb"][data-property="x"]').click();
  const before = await uiSnapshot(page);
  const row = page.locator('.jt-grid__row[data-layer-id="orb"][data-property="x"]');
  await expect(row).toBeVisible();
  const position = await row.evaluate((element) => {
    const width = Number.parseFloat(getComputedStyle(element).getPropertyValue('--jt-grid-frame-width'));
    return { x: (10 - 0.5) * width, y: element.getBoundingClientRect().height / 2 };
  });
  await row.click({ position, button: 'right' });
  await page.getByRole('menuitem', { name: 'Modifier l’accélération', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Effet de l’interpolation', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Famille', exact: true }).selectOption('back');
  await dialog.getByRole('spinbutton', { name: 'Amplitude', exact: true }).fill('3');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  const after = await uiSnapshot(page);
  expect(after.document).toEqual(before.document);
  expect(after.canUndo).toBe(false);
  expect(after.events).toBe(0);
});

const OVERSHOOTS: readonly { name: string; easing: PropertyEasing }[] = [
  { name: 'elastic', easing: { kind: 'effect', family: 'elastic', mode: 'out', parameters: { oscillations: 4, springiness: 3 } } },
  { name: 'back', easing: { kind: 'effect', family: 'back', mode: 'in-out', parameters: { amplitude: 2 } } },
  { name: 'bounce', easing: { kind: 'effect', family: 'bounce', mode: 'out', parameters: { bounces: 3, bounciness: 2 } } },
  { name: 'bézier avec dépassement', easing: { kind: 'bezier', x1: 0.25, y1: -0.55, x2: 0.7, y2: 1.6 } }
];

for (const { name, easing } of OVERSHOOTS) {
  test(`TL-C18 — l’insertion dans un effet à dépassement (${name}) conserve le mouvement, aux images entières et fractionnaires`, async ({ page }) => {
    const track = (id: string): IPropertyTimeline => ({ initialValue: num(0), keys: [key(1, 0), key(100, 100)], transitions: [fade(id, 1, 100, easing)] });
    const custom: SerializableDescriptor = { name: 'slide', kind: 'value', unit: '', defaultValue: 0, interpolator: 'unclamped-linear' };
    await openGeneric(page, logoDocument({ x: track('move-x'), slide: track('move-slide') }), { extra: [custom] });
    for (const property of ['x', 'slide']) {
      const before = await samples(page, property, FINE_FRAMES);
      const defined = before.filter((value): value is number => value !== undefined);
      const overshoots = defined.some((value) => value > 100 || value < 0);
      const reverses = defined.some((value, index) => index > 0 && value < defined[index - 1]);
      expect(overshoots || reverses, `${property} dépasse ou rebondit`).toBe(true);
      const result = await page.evaluate((property) => window.tlConformance?.current?.editor.propertyTimelines.capture('logo', property, { frame: 37 }), property);
      expect(result, property).toEqual({ status: 'changed' });
      const split = timeline(await currentDocument(page), property);
      expect(split?.keys.map(({ frame }) => frame), property).toEqual([1, 37, 100]);
      expect(await samples(page, property, FINE_FRAMES), property).toEqual(before);
      await page.evaluate(() => window.tlConformance?.current?.editor.undo());
    }
  });
}
