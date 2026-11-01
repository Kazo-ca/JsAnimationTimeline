// e2e/validation/final-candidate-conflicts.spec.ts
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type {} from '../../demo/editor/src/finalCandidateConflicts';

const snapshot = (page: Page) => page.evaluate(() => window.finalCandidateConflictsFixture!.snapshot());
type Snapshot = Awaited<ReturnType<typeof snapshot>>;
const click = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).click();
const undo = (page: Page) => click(page, 'Annuler la décision');
const redo = (page: Page) => click(page, 'Rétablir la décision');
function project(state: Snapshot) {
  return { timeline: state.timeline, html: state.html, style: state.style, opacity: state.opacity,
    canUndo: state.canUndo, canRedo: state.canRedo };
}
function keys(state: Snapshot, id: string) {
  const layer = state.timeline.layers.find((entry) => entry.id === id);
  return layer?.type === 'layer' ? layer.propertyTimelines?.opacity.keys : undefined;
}
async function open(page: Page, prefix = false): Promise<void> {
  await page.goto(`/final-candidate-conflicts.html${prefix ? '?scenario=prefix' : ''}`);
  await page.waitForFunction(() => window.finalCandidateConflictsFixture?.ready);
}

test.describe('Final-candidate conflict decisions', () => {
  let errors: string[];
  test.beforeEach(async ({ page }) => {
    errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await open(page);
  });
  test.afterEach(async ({ page }, info) => {
    await page.screenshot({ path: info.outputPath('final-candidate-conflicts.png'), fullPage: true });
    if (await page.evaluate(() => Boolean(window.finalCandidateConflictsFixture))) {
      await info.attach('conflict-observations', { body: JSON.stringify(await snapshot(page), null, 2), contentType: 'application/json' });
    }
    expect(errors).toEqual([]);
  });

  test('commits a chosen winner and the advertised key with the real final signature and one undo step', async ({ page }) => {
    const before = await snapshot(page);
    expect(before.diagnostics[0].code).toBe('priority-conflict');
    await click(page, 'Confirmer le choix et la clé');
    const after = await snapshot(page);
    expect(after.lastResult?.status).toBe('changed');
    expect(after.diagnostics).toEqual([]);
    expect(keys(after, 'first')?.map((key) => key.frame)).toEqual([1, 20]);
    expect(keys(after, 'second')).toEqual(keys(before, 'second'));
    expect(after.html.resolutions).toHaveLength(1);
    expect(after.html.resolutions?.[0].signature).toBe(after.unresolvedDiagnostics[0].signature);
    expect(after.html.resolutions?.[0].signature).not.toBe(before.diagnostics[0].signature);
    expect(after.opacity).toBe('0.3');
    const observations = after.observations.slice(before.observations.length);
    expect(observations.map((entry) => entry.event)).toEqual(expect.arrayContaining(['document:changed', 'history:changed', 'transaction:changed']));
    for (const entry of observations) {
      expect(entry.opacity, entry.event).toBe('0.3');
      expect(entry.canUndo, entry.event).toBe(true);
      expect(entry.html.resolutions).toEqual(after.html.resolutions);
    }
    await click(page, 'Voir l’image 20');
    await expect(page.locator('#opacity-output')).toHaveText('50 %');
    await click(page, 'Voir l’image 1');
    await expect(page.locator('#opacity-output')).toHaveText('30 %');
    await undo(page);
    const reverted = await snapshot(page);
    expect(project(reverted)).toEqual({ ...project(before), canRedo: true });
    expect(reverted.diagnostics).toEqual(before.diagnostics);
    await expect(page.getByRole('button', { name: 'Annuler la décision', exact: true })).toBeDisabled();
    await redo(page);
    expect(project(await snapshot(page))).toEqual(project(after));
  });

  test('refuses a stale ticket and an expired host confirmation without consuming history or redo', async ({ page }) => {
    await click(page, 'Confirmer le choix et la clé');
    const changed = await snapshot(page);
    await click(page, 'Réessayer l’ancienne confirmation');
    const stale = await snapshot(page);
    expect(stale.lastResult?.status).toBe('refused');
    expect(project(stale)).toEqual(project(changed));
    expect(stale.observations).toEqual(changed.observations);
    await undo(page);
    const before = await snapshot(page);
    await page.getByLabel('Simuler une confirmation expirée').check();
    await click(page, 'Confirmer le choix et la clé');
    const refused = await snapshot(page);
    expect(refused.lastResult?.status).toBe('refused');
    expect(project(refused)).toEqual(project(before));
    expect(refused.observations).toEqual(before.observations);
    await expect(page.locator('#status')).toContainText('Modification refusée');
    await page.getByLabel('Simuler une confirmation expirée').uncheck();
    await redo(page);
    expect(project(await snapshot(page))).toEqual(project(changed));
  });

  test('records only the chosen decision when no key was announced', async ({ page }) => {
    await page.getByLabel('Ajouter la clé annoncée').uncheck();
    await page.getByLabel('Objet prioritaire').selectOption('second');
    const before = await snapshot(page);
    await click(page, 'Confirmer le choix et la clé');
    const after = await snapshot(page);
    expect(after.lastResult?.status).toBe('changed');
    expect(after.timeline).toEqual(before.timeline);
    expect(after.html.resolutions?.[0].winnerLayerId).toBe('second');
    expect(after.opacity).toBe('0.7');
    await undo(page);
    expect(project(await snapshot(page))).toEqual({ ...project(before), canRedo: true });
  });

  test('drops an obsolete prefix decision when its announced first key removes the conflict', async ({ page }) => {
    await open(page, true);
    const before = await snapshot(page);
    expect(before.diagnostics[0].code).toBe('before-first-conflict');
    await click(page, 'Confirmer le choix et la clé');
    const after = await snapshot(page);
    expect(after.lastResult?.status).toBe('changed');
    expect(after.diagnostics).toEqual([]);
    expect(after.html.resolutions ?? []).toEqual([]);
    expect(keys(after, 'specific')?.map((key) => key.frame)).toEqual([1, 50]);
    expect(keys(after, 'all')).toEqual(keys(before, 'all'));
    await click(page, 'Voir l’image 50');
    await expect(page.locator('#opacity-output')).toHaveText('80 %');
    await click(page, 'Voir l’image 1');
    await expect(page.locator('#opacity-output')).toHaveText('100 %');
    await undo(page);
    expect(project(await snapshot(page))).toEqual({ ...project(before), canRedo: true });
    expect((await snapshot(page)).diagnostics).toEqual(before.diagnostics);
    await redo(page);
    expect(project(await snapshot(page))).toEqual(project(after));
  });

  for (const width of [320, 768]) {
    test(`keeps explicit conflict choices usable at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.getByLabel('Objet prioritaire').selectOption('second');
      await click(page, 'Confirmer le choix et la clé');
      expect((await snapshot(page)).html.resolutions?.[0].winnerLayerId).toBe('second');
      await expect(page.locator('#opacity-output')).toHaveText('70 %');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await undo(page);
      await expect(page.locator('#opacity-output')).toHaveText('100 %');
    });
  }
});
