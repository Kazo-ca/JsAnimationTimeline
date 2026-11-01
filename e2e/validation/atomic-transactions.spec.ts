// e2e/validation/atomic-transactions.spec.ts
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type {} from '../../demo/editor/src/atomicTransactions';

const snapshot = (page: Page) => page.evaluate(() => window.atomicTransactionsFixture!.snapshot());
type Snapshot = Awaited<ReturnType<typeof snapshot>>;
const undo = (page: Page) => page.getByRole('button', { name: 'Annuler', exact: true }).click();
const redo = (page: Page) => page.getByRole('button', { name: 'Rétablir', exact: true }).click();
const add = (page: Page) => page.getByRole('button', { name: 'Ajouter un point à l’image 50', exact: true }).click();
const middleProperties = ['middleColor', 'middleOpacity', 'middlePosition', 'middlePresent'];

function tracks(state: Pick<Snapshot, 'timeline'>) {
  const layer = state.timeline.layers.find((entry) => entry.id === 'gradient');
  if (layer?.type !== 'layer') throw new Error('Missing gradient demo layer.');
  return layer.propertyTimelines ?? {};
}
function project(state: Snapshot) {
  return { timeline: state.timeline, html: state.html, noteId: state.noteId, journal: state.journal,
    pending: state.pending, canUndo: state.canUndo, canRedo: state.canRedo, gradient: state.gradient };
}
function expectCoherentObservers(state: Snapshot): void {
  for (const observed of state.observations) {
    const hasMiddle = observed.state.html.gradients?.gradient?.[0].stops.some((stop) => stop.id === 'middle');
    const expected = hasMiddle ? middleProperties : [];
    expect(Object.keys(tracks(observed.state)).sort(), observed.event).toEqual(expected);
    expect(Object.keys(observed.state.html.bindings?.gradient ?? {}).sort(), observed.event).toEqual(expected);
    expect(observed.state.noteId, observed.event).toBe(hasMiddle ? 'gradient-point-note' : null);
    expect(observed.state.journal, observed.event).toHaveLength(hasMiddle ? 1 : 0);
  }
}
async function seek(page: Page, frame: number): Promise<void> {
  await page.getByLabel('Image', { exact: true }).fill(String(frame));
  await page.getByRole('button', { name: 'Afficher l’image', exact: true }).click();
  await expect(page.locator('#frame-output')).toHaveAttribute('data-frame', String(frame));
}

test.describe('Atomic host transactions', () => {
  let errors: string[];
  test.beforeEach(async ({ page }) => {
    errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto('/atomic-transactions.html');
    await page.waitForFunction(() => window.atomicTransactionsFixture?.ready);
  });
  test.afterEach(async ({ page }, info) => {
    await page.screenshot({ path: info.outputPath('atomic-transactions.png'), fullPage: true });
    if (await page.evaluate(() => Boolean(window.atomicTransactionsFixture))) {
      await info.attach('atomic-transaction-observations', { body: JSON.stringify(await snapshot(page), null, 2), contentType: 'application/json' });
    }
    expect(errors).toEqual([]);
  });

  test('adds a genuinely new point and undoes its definition, keys and HTML journal together', async ({ page }) => {
    const original = await snapshot(page);
    expect(original.html.gradients?.gradient?.[0].stops.map((stop) => stop.id)).toEqual(['left', 'right']);
    expect(tracks(original)).toEqual({});
    expect(original.journal).toEqual([]);
    await seek(page, 50);
    await add(page);
    const added = await snapshot(page);
    expect(added.lastResult?.status).toBe('changed');
    expect(added.html.gradients?.gradient?.[0].stops.map((stop) => stop.id)).toEqual(['left', 'middle', 'right']);
    expect(Object.keys(tracks(added)).sort()).toEqual(middleProperties);
    for (const property of middleProperties) expect(tracks(added)[property].keys.map((key) => key.frame)).toEqual([50]);
    expect(tracks(added).middlePresent.initialValue).toEqual({ kind: 'boolean', value: false });
    expect(tracks(added).middlePresent.keys[0].value).toEqual({ kind: 'boolean', value: true });
    expect(added.noteId).toBe('gradient-point-note');
    expect(added.journal).toEqual([{ xpath: '/html/body/main[1]/section[1]/article[2]/p[1]/span[1]', attribute: 'id', oldValue: null, newValue: 'gradient-point-note' }]);
    expect(added.hostEvents).toHaveLength(1);
    expect(added.gradient).toContain('0, 255, 0');
    await seek(page, 49);
    expect((await snapshot(page)).gradient).not.toContain('0, 255, 0');
    await seek(page, 50);
    expect((await snapshot(page)).gradient).toBe(added.gradient);
    await undo(page);
    const undone = await snapshot(page);
    expect(undone.timeline).toEqual(original.timeline);
    expect(undone.html).toEqual(original.html);
    expect(undone.noteId).toBeNull();
    expect(undone.journal).toEqual([]);
    expect(undone.pending).toEqual([]);
    expect(undone.canUndo).toBe(false);
    expect(undone.gradient).toBe(original.gradient);
    expect(undone.intentCount).toBe(1);
    await redo(page);
    const redone = await snapshot(page);
    expect(project(redone)).toEqual(project(added));
    expect(redone.intentCount).toBe(1);
    expect(redone.hostEvents.map((event) => event.cause)).toEqual(['execute', 'undo', 'redo']);
    expectCoherentObservers(redone);
  });

  test('keeps redo and every participant intact on validation refusal and a partially applied host failure', async ({ page }) => {
    await seek(page, 50); await add(page); await undo(page);
    const original = await snapshot(page);
    for (const label of ['Essayer une modification refusée', 'Simuler une erreur après écriture']) {
      await page.getByRole('button', { name: label, exact: true }).click();
      const refused = await snapshot(page);
      expect(refused.lastResult?.status).toBe('refused');
      expect(project(refused)).toEqual(project(original));
      expect(refused.hostEvents).toEqual(original.hostEvents);
      expect(refused.observations).toEqual(original.observations);
    }
    await redo(page);
    const redone = await snapshot(page);
    expect(redone.noteId).toBe('gradient-point-note');
    expect(redone.gradient).toContain('0, 255, 0');
    expectCoherentObservers(redone);
  });

  test('cancels a preview with Escape, preserves redo and commits a later gesture as one undo', async ({ page }) => {
    await seek(page, 50); await add(page); await undo(page);
    const before = await snapshot(page);
    await page.getByRole('button', { name: 'Prévisualiser l’ajout', exact: true }).click();
    expect((await snapshot(page)).gradient).toContain('0, 255, 0');
    await page.keyboard.press('Escape');
    const canceled = await snapshot(page);
    expect(project(canceled)).toEqual(project(before));
    expect(canceled.observations.some((entry) => entry.event === 'transaction:preview:execute')).toBe(true);
    expect(canceled.observations.some((entry) => entry.event === 'transaction:cancel:group-cancel')).toBe(true);
    await redo(page); await undo(page);
    await page.getByRole('button', { name: 'Prévisualiser l’ajout', exact: true }).click();
    await page.getByRole('button', { name: 'Valider le geste', exact: true }).click();
    expect((await snapshot(page)).gradient).toContain('0, 255, 0');
    await undo(page);
    const undone = await snapshot(page);
    expect(project(undone)).toEqual(project(before));
    expectCoherentObservers(undone);
    await redo(page);
    expect((await snapshot(page)).gradient).toContain('0, 255, 0');
  });

  test('refuses an edit from the commit notification and accepts the same request immediately afterwards', async ({ page }) => {
    await seek(page, 50);
    await page.getByLabel('Essayer une édition depuis la notification', { exact: true }).check();
    await add(page);
    const added = await snapshot(page);
    expect(added.reentrantResults).toHaveLength(1);
    expect(added.reentrantResults[0]).toMatchObject({ status: 'refused' });
    expect(added.html.gradients?.gradient?.[0].angle).toBe(90);
    await expect(page.locator('#reentrant-output')).toContainText('Appel réentrant refusé');
    await page.getByLabel('Essayer une édition depuis la notification', { exact: true }).uncheck();
    await page.getByRole('button', { name: 'Orienter le dégradé après la notification', exact: true }).click();
    const rotated = await snapshot(page);
    expect(rotated.lastResult?.status).toBe('changed');
    expect(rotated.html.gradients?.gradient?.[0].angle).toBe(135);
    expect(rotated.timeline).toEqual(added.timeline);
    expect(rotated.gradient).toContain('135deg');
    await undo(page);
    expect((await snapshot(page)).html).toEqual(added.html);
    await undo(page);
    const undone = await snapshot(page);
    expect(undone.canUndo).toBe(false);
    expect(undone.noteId).toBeNull();
    expectCoherentObservers(undone);
  });

  for (const width of [320, 768]) {
    test(`keeps the reusable demonstration usable at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await seek(page, 50); await add(page);
      await expect(page.locator('#gradient-box')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Annuler', exact: true })).toBeEnabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await undo(page);
      expect((await snapshot(page)).noteId).toBeNull();
    });
  }
});
