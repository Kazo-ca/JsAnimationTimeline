// e2e/validation/host-rendering.spec.ts
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type {} from '../../demo/editor/src/hostRendering';

const snapshot = (page: Page) => page.evaluate(() => window.hostRenderingFixture!.snapshot());
type Snapshot = Awaited<ReturnType<typeof snapshot>>;
const click = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).click();
const undo = (page: Page) => click(page, 'Annuler');
const redo = (page: Page) => click(page, 'Rétablir');

function stateProject(state: Snapshot) {
  return { timeline: state.timeline, html: state.html, style: state.style, gradient: state.gradient,
    journal: state.journal, canUndo: state.canUndo, canRedo: state.canRedo };
}
function trackCount(state: Pick<Snapshot, 'timeline'>): number {
  const layer = state.timeline.layers.find((entry) => entry.id === 'gradient');
  return layer?.type === 'layer' ? Object.keys(layer.propertyTimelines ?? {}).length : 0;
}
async function expectObservers(page: Page, run: () => Promise<unknown>, angle: number, tracks: number, bindings: number, canUndo: boolean): Promise<void> {
  const before = await snapshot(page);
  await run();
  const after = await snapshot(page);
  expect(after.gradient).toContain(`${angle}deg`);
  const observed = after.observations.slice(before.observations.length).filter((entry) => entry.event !== 'frame:render');
  expect(observed.map((entry) => entry.event)).toEqual(expect.arrayContaining(['document:changed', 'history:changed']));
  for (const entry of observed) {
    expect(entry.state.gradient, entry.event).toContain(`${angle}deg`);
    expect(trackCount(entry.state), entry.event).toBe(tracks);
    expect(Object.keys(entry.state.html.bindings?.gradient ?? {}).length, entry.event).toBe(bindings);
    expect(entry.state.canUndo, entry.event).toBe(canUndo);
  }
}
async function seek(page: Page, frame: number): Promise<void> {
  await page.getByLabel('Image', { exact: true }).fill(String(frame));
  await click(page, 'Afficher l’image');
  await expect(page.locator('#frame-output')).toHaveAttribute('data-frame', String(frame));
}

test.describe('Prepared host rendering', () => {
  let errors: string[];
  test.beforeEach(async ({ page }) => {
    errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto('/host-rendering.html');
    await page.waitForFunction(() => window.hostRenderingFixture?.ready);
  });
  test.afterEach(async ({ page }, info) => {
    await page.screenshot({ path: info.outputPath('host-rendering.png'), fullPage: true });
    if (await page.evaluate(() => Boolean(window.hostRenderingFixture))) {
      await info.attach('first-observer-states', { body: JSON.stringify(await snapshot(page), null, 2), contentType: 'application/json' });
    }
    expect(errors).toEqual([]);
  });

  test('exposes the rendered gradient and final context at the first observer for transactions and ordinary edits', async ({ page }) => {
    await expectObservers(page, () => click(page, 'Transaction : angle à 35°'), 35, 1, 2, true);
    await expectObservers(page, () => undo(page), 90, 0, 1, false);
    await expectObservers(page, () => redo(page), 35, 1, 2, true);
    await expectObservers(page, () => click(page, 'Timeline : angle à 55°'), 55, 1, 2, true);
    await expectObservers(page, () => undo(page), 35, 1, 2, true);
    await expectObservers(page, () => redo(page), 55, 1, 2, true);
    const state = await snapshot(page);
    expect(state.observations.map((entry) => entry.event)).toEqual(expect.arrayContaining(['property:changed', 'transaction:changed']));
    expect(state.style).toContain('opacity: 0.8');
    await undo(page); await undo(page);
    expect((await snapshot(page)).canUndo).toBe(false);
    expect((await snapshot(page)).gradient).toContain('90deg');
  });

  test('compensates preparation refusal and partial DOM writes without consuming redo or publishing success', async ({ page }) => {
    await click(page, 'Transaction : angle à 35°'); await undo(page);
    const before = await snapshot(page);
    for (const name of ['Refuser la préparation du rendu', 'Simuler une erreur après écriture']) {
      await click(page, name);
      const refused = await snapshot(page);
      expect(refused.lastResult?.status).toBe('refused');
      expect(stateProject(refused)).toEqual(stateProject(before));
      expect(refused.observations.filter((entry) => entry.event !== 'frame:render')).toEqual(before.observations.filter((entry) => entry.event !== 'frame:render'));
      await expect(page.locator('#status')).toContainText('Modification refusée');
    }
    await redo(page);
    expect((await snapshot(page)).gradient).toContain('35deg');
  });

  test('renders navigation through the same participant without adding history', async ({ page }) => {
    await click(page, 'Ajouter 120° à l’image 50');
    const before = await snapshot(page);
    expect(before.gradient).toContain('90deg');
    await seek(page, 50);
    const at50 = await snapshot(page);
    expect(at50.gradient).toContain('120deg');
    expect(at50.timeline).toEqual(before.timeline);
    expect(at50.canUndo).toBe(before.canUndo); expect(at50.canRedo).toBe(before.canRedo);
    const frameEvents = at50.observations.slice(before.observations.length).filter((entry) => entry.event === 'frame:render' && entry.state.frame === 50);
    expect(frameEvents.length).toBeGreaterThan(0);
    for (const entry of frameEvents) expect(entry.state.gradient).toContain('120deg');
    expect(at50.journal[at50.journal.length - 1].cause).toBe('seek');
    await seek(page, 49); expect((await snapshot(page)).gradient).toContain('90deg');
    await undo(page);
    expect((await snapshot(page)).canUndo).toBe(false);
    await redo(page); await seek(page, 50);
    expect((await snapshot(page)).gradient).toContain('120deg');
  });

  test('refuses a synchronous callback edit and accepts it immediately after notification', async ({ page }) => {
    await page.getByLabel('Essayer une édition depuis la notification', { exact: true }).check();
    await click(page, 'Transaction : angle à 35°');
    const first = await snapshot(page);
    expect(first.gradient).toContain('35deg');
    expect(first.reentrantResults).toHaveLength(1);
    expect(first.reentrantResults[0].status).toBe('refused');
    await expect(page.locator('#reentrant-output')).toHaveText('Appel réentrant refusé.');
    await page.getByLabel('Essayer une édition depuis la notification', { exact: true }).uncheck();
    await click(page, 'Timeline : angle à 55°');
    expect((await snapshot(page)).lastResult?.status).toBe('changed');
    expect((await snapshot(page)).gradient).toContain('55deg');
    await undo(page); expect((await snapshot(page)).gradient).toContain('35deg');
    await undo(page); expect((await snapshot(page)).canUndo).toBe(false);
  });

  test('preserves an unsubmitted frame while another edit schedules a render', async ({ page }) => {
    await click(page, 'Ajouter 120° à l’image 50');
    const input = page.getByLabel('Image', { exact: true });
    await input.fill('50');
    const before = await snapshot(page);
    await click(page, 'Timeline : angle à 55°');
    await expect.poll(async () => (await snapshot(page)).observations.slice(before.observations.length)
      .some((entry) => entry.event === 'frame:render')).toBe(true);
    await expect(input).toHaveValue('50');
    await click(page, 'Afficher l’image');
    await expect(page.locator('#frame-output')).toHaveAttribute('data-frame', '50');
    expect((await snapshot(page)).gradient).toContain('120deg');
  });

  for (const width of [320, 768]) {
    test(`keeps the host-render demonstration usable at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await click(page, 'Transaction : angle à 35°');
      await expect(page.locator('#gradient-box')).toBeVisible();
      await expect(page.locator('#angle-output')).toHaveText('35°');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await undo(page); await expect(page.locator('#angle-output')).toHaveText('90°');
    });
  }
});
