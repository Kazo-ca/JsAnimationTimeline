// e2e/conformance/tl-conformance.spec.ts
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { IPropertyTimeline, ITimelineDocument, PropertyEasing, TimelinePropertyValue } from '@kazo-ca/timeline-runtime';
import type { HtmlDocumentName, HtmlSceneKind, HtmlSceneSnapshot } from '../../demo/editor/src/conformance/scenes/html';
import type { IRecordedFrames, IRefusedOutput } from '../../demo/editor/src/conformance/htmlTypes';
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

// ---------------------------------------------------------------------------
// HTML stage and exports: TL-C06, TL-C13, TL-C14, TL-C15
// ---------------------------------------------------------------------------

const INTEGER_FRAMES = Array.from({ length: 100 }, (_, index) => index + 1);
/** Every integer frame, in an order that jumps around: 37 is coprime with 100, so this is a permutation. */
const SHUFFLED_FRAMES = INTEGER_FRAMES.map((_, index) => ((index * 37) % 100) + 1);
/** Quarter frames from 1 to 100: the fractional grid of the continuous CSS output. */
const QUARTER_FRAMES = Array.from({ length: 397 }, (_, index) => 1 + index / 4);
const BUTTON_KEYS = [1, 2, 3, 4].map((index) => `button-${index}.opacity`);
/** Case 59: 50 % for the group, 80 % for #button-2 from the very first frame. */
const CASE_59: HtmlSceneSnapshot = { 'button-1.opacity': '0.5', 'button-2.opacity': '0.8', 'button-3.opacity': '0.5', 'button-4.opacity': '0.5' };
/** Decimals kept by the continuous CSS output, per property (HA6). */
const CSS_DECIMALS: Readonly<Record<string, number>> = { opacity: 4, left: 2 };

type Output = IRecordedFrames | IRefusedOutput;

function recorded(output: Output | undefined, label: string): IRecordedFrames {
  if (output === undefined) throw new Error(`${label} : banc HTML indisponible.`);
  if ('records' in output) return output;
  throw new Error(`${label} refusé : ${output.diagnostics.map((entry) => entry.message).join(' ')}`);
}

async function openHtml(page: Page, scene: HtmlSceneKind, document: HtmlDocumentName | ITimelineDocument, context?: unknown): Promise<void> {
  await page.evaluate(({ scene, document, context }) => {
    window.tlConformance?.html.open({ scene, document, ...(context === undefined ? {} : { context }) } as never);
  }, { scene, document, context });
}

function pick(snapshot: HtmlSceneSnapshot, keys: readonly string[]): HtmlSceneSnapshot {
  return Object.fromEntries(keys.map((key) => [key, snapshot[key]]));
}

/** Exact outputs compare their computed strings; continuous outputs compare within the decimals the CSS keeps. */
function expectSnapshot(actual: HtmlSceneSnapshot, expected: HtmlSceneSnapshot, label: string, tolerant: boolean): void {
  expect(Object.keys(actual).sort(), label).toEqual(Object.keys(expected).sort());
  for (const [key, value] of Object.entries(expected)) {
    const decimals = CSS_DECIMALS[key.slice(key.indexOf('.') + 1)];
    if (!tolerant || decimals === undefined) {
      expect(actual[key], `${label} ${key}`).toBe(value);
    } else {
      expect(Math.abs(Number.parseFloat(actual[key]) - Number.parseFloat(value)), `${label} ${key}: ${actual[key]} / ${value}`).toBeLessThanOrEqual(0.5 * 10 ** -decimals + 1e-9);
    }
  }
}

function expectSameFrames(actual: IRecordedFrames, reference: IRecordedFrames, frames: readonly number[], label: string, tolerant = false): void {
  for (const frame of frames) expectSnapshot(actual.records[String(frame)], reference.records[String(frame)], `${label} @${frame}`, tolerant);
}

interface IHtmlOutputs {
  readonly seek: IRecordedFrames;
  readonly linear: IRecordedFrames;
  readonly json: IRecordedFrames;
  readonly script: IRecordedFrames;
  readonly css: IRecordedFrames;
  readonly cssFractional: IRecordedFrames;
  readonly resolvedFractional: IRecordedFrames;
}

/** Every output of the current HTML editor over the same frames; any refusal fails the case with its explanation. */
async function collectOutputs(page: Page): Promise<IHtmlOutputs> {
  const seek = await page.evaluate((frames) => window.tlConformance?.html.seekRecords(frames), SHUFFLED_FRAMES);
  const linear = await page.evaluate(() => window.tlConformance?.html.linearRecords());
  const json = await page.evaluate((frames) => window.tlConformance?.html.jsonRecords(frames), INTEGER_FRAMES);
  const script = await page.evaluate((frames) => window.tlConformance?.html.scriptRecords(frames), INTEGER_FRAMES);
  const css = await page.evaluate((frames) => window.tlConformance?.html.cssRecords(frames), INTEGER_FRAMES);
  const cssFractional = await page.evaluate((frames) => window.tlConformance?.html.cssRecords(frames), QUARTER_FRAMES);
  const resolvedFractional = await page.evaluate((frames) => window.tlConformance?.html.resolvedRecords(frames), QUARTER_FRAMES);
  return {
    seek: recorded(seek, 'accès direct'), linear: recorded(linear, 'lecture linéaire'), json: recorded(json, 'JSON'),
    script: recorded(script, 'JavaScript'), css: recorded(css, 'CSS'), cssFractional: recorded(cssFractional, 'CSS fractionnaire'),
    resolvedFractional: recorded(resolvedFractional, 'moteur de résolution')
  };
}

/** The same state at every integer frame from every output, and at quarter frames from the continuous CSS. */
function expectSameState(outputs: IHtmlOutputs, label: string): void {
  expect(outputs.linear.frames, `${label} lecture linéaire`).toEqual(INTEGER_FRAMES);
  expect(outputs.seek.frames).toEqual(SHUFFLED_FRAMES);
  // Playback samples continuous time, a hair past each integer frame: numbers agree within the CSS decimals.
  expectSameFrames(outputs.linear, outputs.seek, INTEGER_FRAMES, `${label} lecture linéaire`, true);
  expectSameFrames(outputs.json, outputs.seek, INTEGER_FRAMES, `${label} JSON`);
  expectSameFrames(outputs.script, outputs.seek, INTEGER_FRAMES, `${label} JavaScript`);
  expectSameFrames(outputs.css, outputs.seek, INTEGER_FRAMES, `${label} CSS`, true);
  expectSameFrames(outputs.cssFractional, outputs.resolvedFractional, QUARTER_FRAMES, `${label} CSS fractionnaire`, true);
}

test('TL-C06 — le cas groupe/ID donne 80 % au bouton spécifique dès l’image 1 et 50 % aux autres, sans clé ajoutée ni dialogue', async ({ page }) => {
  await openHtml(page, 'main', 'reference');
  const stageState = await page.evaluate(() => {
    const handle = window.tlConformance?.html.current;
    if (handle === undefined) throw new Error('Aucun éditeur HTML.');
    const document = JSON.parse(JSON.stringify(handle.editor.document)) as ITimelineDocument;
    return {
      diagnostics: handle.stage.diagnostics.map(({ code, blocking }) => ({ code, blocking })),
      resolutions: handle.stage.animationContext.resolutions ?? [],
      document, canUndo: handle.editor.canUndo, events: handle.events.length
    };
  });
  expect(stageState.diagnostics.filter(({ blocking }) => blocking)).toEqual([]);
  expect(stageState.resolutions).toEqual([]);
  expect(stageState.canUndo).toBe(false);
  expect(stageState.events).toBe(0);
  const layers = stageState.document.layers.flatMap((layer) => layer.type === 'layer' ? [layer] : []);
  expect(layers.find((layer) => layer.id === 'specific')?.propertyTimelines?.opacity.keys.map(({ frame }) => frame)).toEqual([50]);
  expect(layers.find((layer) => layer.id === 'buttons')?.propertyTimelines?.opacity.keys.map(({ frame }) => frame)).toEqual([1]);
  const before = stageState.document;

  const seeks = await page.evaluate(() => window.tlConformance?.html.seekRecords([20, 1, 49, 100]));
  for (const frame of [20, 1, 49, 100]) expectSnapshot(pick(seeks?.records[String(frame)] ?? {}, BUTTON_KEYS), CASE_59, `accès direct @${frame}`, false);

  const linear = recorded(await page.evaluate(() => window.tlConformance?.html.linearRecords()), 'lecture linéaire');
  expect(linear.frames).toEqual(INTEGER_FRAMES);
  for (const frame of INTEGER_FRAMES) expectSnapshot(pick(linear.records[String(frame)], BUTTON_KEYS), CASE_59, `lecture linéaire @${frame}`, false);

  const json = recorded(await page.evaluate((frames) => window.tlConformance?.html.jsonRecords(frames), INTEGER_FRAMES), 'JSON');
  const script = recorded(await page.evaluate((frames) => window.tlConformance?.html.scriptRecords(frames), INTEGER_FRAMES), 'JavaScript');
  const css = recorded(await page.evaluate((frames) => window.tlConformance?.html.cssRecords(frames), QUARTER_FRAMES), 'CSS');
  for (const frame of INTEGER_FRAMES) {
    expectSnapshot(pick(json.records[String(frame)], BUTTON_KEYS), CASE_59, `JSON @${frame}`, false);
    expectSnapshot(pick(script.records[String(frame)], BUTTON_KEYS), CASE_59, `JavaScript @${frame}`, false);
  }
  for (const frame of QUARTER_FRAMES) expectSnapshot(pick(css.records[String(frame)], BUTTON_KEYS), CASE_59, `CSS @${frame}`, true);

  const after = await page.evaluate(() => {
    const handle = window.tlConformance?.html.current;
    return {
      document: JSON.parse(JSON.stringify(handle?.editor.document)) as ITimelineDocument,
      blocking: handle?.stage.diagnostics.filter(({ blocking }) => blocking).length,
      resolutions: handle?.stage.animationContext.resolutions ?? [], canUndo: handle?.editor.canUndo, events: handle?.events.length
    };
  });
  expect(after).toEqual({ document: before, blocking: 0, resolutions: [], canUndo: false, events: 0 });
});

test('TL-C13 — accès direct, lecture linéaire et exports donnent le même état, avec ou sans sélection', async ({ page }) => {
  const runs: { selection: string[]; outputs: IHtmlOutputs }[] = [];
  for (const selection of [[], ['specific']]) {
    await openHtml(page, 'main', 'full');
    const selected = await page.evaluate((ids) => window.tlConformance?.html.current?.selectLayers(ids), selection);
    expect(selected).toEqual(selection);
    const outputs = await collectOutputs(page);
    expectSameState(outputs, selection.length === 0 ? 'sans sélection' : 'calque spécifique sélectionné');
    runs.push({ selection, outputs });
    await page.evaluate(() => window.tlConformance?.dispose());
  }
  const [free, selected] = runs.map(({ outputs }) => outputs);
  expect(selected.seek).toEqual(free.seek);
  expect(selected.linear).toEqual(free.linear);
  expect(selected.json).toEqual(free.json);
  expect(selected.script).toEqual(free.script);
  expect(selected.css).toEqual(free.css);
  expect(selected.cssFractional).toEqual(free.cssFractional);

  // The state itself is the one of the scene: case 59, a tween and a hold.
  const at = (frame: number): HtmlSceneSnapshot => free.seek.records[String(frame)];
  for (const frame of INTEGER_FRAMES) expectSnapshot(pick(at(frame), BUTTON_KEYS), CASE_59, `case 59 @${frame}`, false);
  expect(at(1)['tile.opacity']).toBe('1');
  expect(Number.parseFloat(at(45)['tile.opacity'])).toBeCloseTo(0.2 + 0.7 * (35 / 70), 6);
  expect(Number.parseFloat(at(80)['tile.opacity'])).toBeCloseTo(0.9, 6);
  expect(at(1)['tile.left']).toBe('8px');
  expect(Number.parseFloat(at(43)['tile.left'])).toBeCloseTo(8 + 92 * (23 / 45), 3);
  expect(at(65)['tile.left']).toBe('100px');
  expect([at(39)['held.color'], at(39)['held.border']]).toEqual(['rgb(26, 104, 168)', 'solid']);
  expect([at(40)['held.color'], at(40)['held.border']]).toEqual(['rgb(187, 76, 42)', 'dashed']);
});

function conflictState(page: Page) {
  return page.evaluate(() => {
    const state = window.tlConformance?.html.state();
    if (state === undefined) throw new Error('Banc HTML indisponible.');
    return state;
  });
}
type ConflictState = Awaited<ReturnType<typeof conflictState>>;

function conflictKeys(state: ConflictState, layerId: string): number[] | undefined {
  const layer = state.document.layers.find((entry) => entry.id === layerId);
  return layer?.type === 'layer' ? layer.propertyTimelines?.opacity.keys.map(({ frame }) => frame) : undefined;
}
/** Everything the history restores: the timeline, the saved HTML context and the blocking diagnostics. */
function restorable(state: ConflictState) {
  return { document: state.document, context: state.context, blocking: state.blocking };
}

/** Opacity of the conflict target at `frames`, by direct seek and by every HTML output. */
async function conflictValues(page: Page, frames: readonly number[]): Promise<Record<string, Record<string, string>>> {
  const read = (output: Output | undefined, label: string) => Object.fromEntries(
    frames.map((frame) => [String(frame), recorded(output, label).records[String(frame)]['target.opacity']]));
  return {
    seek: read(await page.evaluate((list) => window.tlConformance?.html.seekRecords(list), frames), 'accès direct'),
    json: read(await page.evaluate((list) => window.tlConformance?.html.jsonRecords(list), frames), 'JSON'),
    script: read(await page.evaluate((list) => window.tlConformance?.html.scriptRecords(list), frames), 'JavaScript'),
    css: read(await page.evaluate((list) => window.tlConformance?.html.cssRecords(list), frames), 'CSS')
  };
}

test('TL-C14 — un conflit de même spécificité bloque les exports tant qu’il n’est pas résolu, puis le choix est mémorisé et réversible', async ({ page }) => {
  await openHtml(page, 'conflict', 'conflict');
  const conflict = await page.evaluate(() => window.tlConformance?.html.conflict());
  expect(conflict).toMatchObject({ code: 'priority-conflict', blocking: true, property: 'opacity', fromFrame: 1, toFrame: 100 });
  expect(conflict?.choices).toEqual(['first', 'second']);
  expect(conflict?.targets).toEqual(['.first', '.second']);
  expect(conflict?.message).not.toBe('');

  // Neither the HTML playback nor the CSS accepts a conflict nobody has decided.
  const playback = await page.evaluate(() => window.tlConformance?.html.playbackData());
  expect(playback?.status).toBe('refused');
  expect(playback?.diagnostics.map((entry) => (entry as { code: string }).code)).toContain('priority-conflict');
  const refusedCss = await page.evaluate(() => window.tlConformance?.html.cssRecords([1]));
  expect(refusedCss).toMatchObject({ status: 'refused', css: '', alternatives: ['javascript', 'json'] });
  expect((refusedCss as IRefusedOutput).diagnostics.map(({ code }) => code)).toContain('priority-conflict');

  // Cancelling is not sending the ticket; a ticket whose host guard expired is refused. Neither changes anything.
  const initial = await conflictState(page);
  expect(initial.blocking).toEqual(['priority-conflict']);
  expect(initial.canUndo).toBe(false);
  expect(await conflictState(page)).toEqual(initial);
  const expired = await page.evaluate(() => window.tlConformance?.html.resolve({ winner: 'second', expired: true }));
  expect(expired?.status).toBe('refused');
  expect(await conflictState(page)).toEqual(initial);

  // The decision alone: stored, nothing added to the timeline, one undo step.
  const decided = await page.evaluate(() => window.tlConformance?.html.resolve({ winner: 'second' }));
  expect(decided?.status).toBe('changed');
  const afterDecision = await conflictState(page);
  expect(afterDecision.document).toEqual(initial.document);
  expect(afterDecision.context.resolutions).toHaveLength(1);
  expect(afterDecision.context.resolutions?.[0].winnerLayerId).toBe('second');
  expect(afterDecision.blocking).toEqual([]);
  expect(afterDecision.canUndo).toBe(true);
  expect(afterDecision.events).toBe(initial.events);

  // A ticket is good once: sending it again after the decision is stale.
  const stale = await page.evaluate(() => window.tlConformance?.html.retryLastResolution());
  expect(stale?.status).toBe('refused');
  expect(await conflictState(page)).toEqual(afterDecision);

  const frames = [1, 20, 50, 100];
  const decidedValues = await conflictValues(page, frames);
  for (const [output, values] of Object.entries(decidedValues)) {
    expect(values, output).toEqual({ 1: '0.7', 20: '0.7', 50: '0.7', 100: '0.7' });
  }

  // One undo removes the decision, the conflict comes back; one redo restores it.
  expect(await page.evaluate(() => window.tlConformance?.html.current?.editor.undo())).toBe(true);
  const undone = await conflictState(page);
  expect(restorable(undone)).toEqual(restorable(initial));
  expect([undone.canUndo, undone.canRedo]).toEqual([false, true]);
  expect(await page.evaluate(() => window.tlConformance?.html.current?.editor.redo())).toBe(true);
  const redone = await conflictState(page);
  expect(restorable(redone)).toEqual(restorable(afterDecision));
  expect([redone.canUndo, redone.canRedo]).toEqual([true, false]);

  // Save, reopen from the saved document and context: the decision still drives the HTML outputs.
  const saved = JSON.parse(JSON.stringify({ document: redone.document, context: redone.context })) as { document: ITimelineDocument; context: unknown };
  await page.evaluate(() => window.tlConformance?.dispose());
  await openHtml(page, 'conflict', saved.document, saved.context);
  const reopened = await conflictState(page);
  expect(reopened.blocking).toEqual([]);
  expect(reopened.context).toEqual(saved.context);
  const reopenedValues = await conflictValues(page, frames);
  for (const [output, values] of Object.entries(reopenedValues)) {
    expect(values, output).toEqual({ 1: '0.7', 20: '0.7', 50: '0.7', 100: '0.7' });
  }
});

test('TL-C14 — avec une clé annoncée, la clé n’existe qu’après confirmation, et une annulation retire la clé et la décision ensemble', async ({ page }) => {
  await openHtml(page, 'conflict', 'conflict');
  const initial = await conflictState(page);
  expect(conflictKeys(initial, 'first')).toEqual([1]);

  const key = { frame: 20, value: 0.5 };
  const expired = await page.evaluate((announced) => window.tlConformance?.html.resolve({ winner: 'first', key: announced, expired: true }), key);
  expect(expired?.status).toBe('refused');
  const afterRefusal = await conflictState(page);
  expect(afterRefusal).toEqual(initial);
  expect(conflictKeys(afterRefusal, 'first')).toEqual([1]);

  const decided = await page.evaluate((announced) => window.tlConformance?.html.resolve({ winner: 'first', key: announced }), key);
  expect(decided?.status).toBe('changed');
  const confirmed = await conflictState(page);
  expect(conflictKeys(confirmed, 'first')).toEqual([1, 20]);
  expect(conflictKeys(confirmed, 'second')).toEqual(conflictKeys(initial, 'second'));
  expect(confirmed.context.resolutions?.map(({ winnerLayerId }) => winnerLayerId)).toEqual(['first']);
  expect(confirmed.blocking).toEqual([]);

  const stale = await page.evaluate(() => window.tlConformance?.html.retryLastResolution());
  expect(stale?.status).toBe('refused');
  expect(await conflictState(page)).toEqual(confirmed);

  const frames = [1, 19, 20, 50, 100];
  const expectedValues = { 1: '0.3', 19: '0.3', 20: '0.5', 50: '0.5', 100: '0.5' };
  for (const [output, values] of Object.entries(await conflictValues(page, frames))) expect(values, output).toEqual(expectedValues);

  // A single undo removes the key and the decision; a single redo gives both back.
  expect(await page.evaluate(() => window.tlConformance?.html.current?.editor.undo())).toBe(true);
  const undone = await conflictState(page);
  expect(restorable(undone)).toEqual(restorable(initial));
  expect(conflictKeys(undone, 'first')).toEqual([1]);
  expect([undone.canUndo, undone.canRedo]).toEqual([false, true]);
  expect(await page.evaluate(() => window.tlConformance?.html.current?.editor.redo())).toBe(true);
  const redone = await conflictState(page);
  expect(restorable(redone)).toEqual(restorable(confirmed));
  expect(conflictKeys(redone, 'first')).toEqual([1, 20]);

  const saved = JSON.parse(JSON.stringify({ document: redone.document, context: redone.context })) as { document: ITimelineDocument; context: unknown };
  await page.evaluate(() => window.tlConformance?.dispose());
  await openHtml(page, 'conflict', saved.document, saved.context);
  expect((await conflictState(page)).blocking).toEqual([]);
  for (const [output, values] of Object.entries(await conflictValues(page, frames))) expect(values, output).toEqual(expectedValues);
});

/** Every key of a JSON value, however deep. */
function jsonKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(jsonKeys);
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([name, inner]) => [name, ...jsonKeys(inner)]);
}

test('TL-C15 — le JSON générique ne contient aucune notion CSS, DOM ou XPath', async ({ page }) => {
  await openGeneric(page, logoDocument({ opacity: opacityTween({ kind: 'effect', family: 'sine', mode: 'in' }), x: xTrack(key(10, 5), key(60, 30)) }));
  const compiled = await page.evaluate(() => {
    const handle = window.tlConformance;
    const editor = handle?.current?.editor;
    if (handle === undefined || editor === undefined) throw new Error('Aucun éditeur.');
    const result = handle.runtime.compilePlayback(editor.document);
    return { status: result.status, data: result.status === 'exported' ? JSON.parse(JSON.stringify(result.data)) as unknown : undefined };
  });
  expect(compiled.status).toBe('exported');
  expect(jsonKeys(compiled.data).filter((name) => /css|dom|xpath|selector|style|html|element|class/i.test(name))).toEqual([]);
  expect(JSON.stringify(compiled.data)).not.toMatch(/xpath|selector|css|<[a-z]/i);
});

test('TL-C15 — le JSON et le JavaScript HTML reproduisent l’aperçu aux images entières, et un effet élastique fait refuser le CSS', async ({ page }) => {
  await openHtml(page, 'main', 'elastic');
  const before = await conflictState(page);
  const seek = recorded(await page.evaluate((frames) => window.tlConformance?.html.seekRecords(frames), SHUFFLED_FRAMES), 'accès direct');
  const json = recorded(await page.evaluate((frames) => window.tlConformance?.html.jsonRecords(frames), INTEGER_FRAMES), 'JSON');
  const script = recorded(await page.evaluate((frames) => window.tlConformance?.html.scriptRecords(frames), INTEGER_FRAMES), 'JavaScript');
  expectSameFrames(json, seek, INTEGER_FRAMES, 'JSON');
  expectSameFrames(script, seek, INTEGER_FRAMES, 'JavaScript');
  const opacities = INTEGER_FRAMES.map((frame) => Number.parseFloat(seek.records[String(frame)]['tile.opacity']));
  expect(opacities.some((value) => value > 0.9 + 1e-6), 'l’effet élastique dépasse la valeur finale').toBe(true);

  const refused = await page.evaluate(() => window.tlConformance?.html.cssRecords([1, 50]));
  expect(refused).toMatchObject({ status: 'refused' });
  const output = refused as IRefusedOutput;
  expect(output.css).toBe('');
  expect(output.alternatives).toEqual(['javascript', 'json']);
  expect(output.diagnostics.length).toBeGreaterThan(0);
  for (const diagnostic of output.diagnostics) {
    expect(typeof diagnostic.code).toBe('string');
    expect(diagnostic.code).not.toBe('');
    expect(typeof diagnostic.message).toBe('string');
    expect(diagnostic.message).not.toBe('');
  }
  expect(await conflictState(page)).toEqual(before);
});
