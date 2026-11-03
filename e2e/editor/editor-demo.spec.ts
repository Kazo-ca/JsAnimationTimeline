// e2e/editor/editor-demo.spec.ts
import { expect, test } from '@playwright/test';
import type {} from '../../demo/editor/src/global';
import { editorPort } from '../../tools/devPorts';

const url = `http://localhost:${editorPort()}`;

test('the French editor opens with a deterministic document and optional properties panel', async ({ page }) => {
  await page.goto(url);
  await expect(page.getByRole('heading', { name: 'Éditeur de timeline' })).toBeVisible();
  await expect(page.locator('.jt-shell')).toBeVisible();
  await expect(page.locator('.jt-properties-panel')).toBeVisible();
  expect(await page.evaluate(() => window.editorDemo?.document.settings)).toEqual({ fps: 24, totalFrames: 60 });
});

test('a property edit creates a diamond and undo/redo restores the document and preview', async ({ page }) => {
  await page.goto(url);
  await page.locator('.jt-layer-row[data-row-id="logo"] .jt-layer-row__name').click();
  await page.evaluate(() => window.editorDemo?.playback.seek(30));
  const field = page.locator('.jt-properties-panel [data-property="x"] input');
  await expect(page.locator('.jt-properties-panel')).toContainText('image 30');
  await expect(field).toBeVisible();
  const before = await page.evaluate(() => window.editorDemo?.toJSON());
  await field.fill('175'); await field.press('Enter');
  const diamond = page.locator('.jt-grid__row[data-row-id="logo"] .jt-grid__mark--propertyKeyframe[data-frame="30"]');
  await expect(diamond).toBeVisible();
  await expect.poll(() => page.locator('#logo').evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41)).toBeCloseTo(175, 2);
  const after = await page.evaluate(() => window.editorDemo?.toJSON());
  expect(await page.evaluate(() => window.editorDemo?.undo())).toBe(true);
  expect(await page.evaluate(() => window.editorDemo?.toJSON())).toEqual(before);
  expect(await page.evaluate(() => window.editorDemo?.redo())).toBe(true);
  expect(await page.evaluate(() => window.editorDemo?.toJSON())).toEqual(after);
});

test('the supplied scene and stage:false both render sampled canvas and audio values', async ({ page }) => {
  await page.goto(`${url}/scene.html`);
  await expect(page.getByText('Son désactivé')).toBeVisible();
  for (const mode of ['stage', 'manual', 'stage']) {
    await page.locator('#mode').selectOption(mode);
    await expect(page.locator('#status')).toHaveText('Image 1 · position 0.0 · sprite 0 · volume 0.00');
    await page.evaluate(() => window.editorDemo?.playback.seek(24));
    await expect(page.locator('#status')).toHaveText('Image 24 · position 176.2 · sprite 5 · volume 0.73');
    const values = await page.evaluate(() => ({
      sprite: window.editorDemo?.sample(24).layer('hero')?.values.frameIndex,
      volume: window.editorDemo?.sample(24).layer('music')?.values.volume
    }));
    expect(values.sprite).toBe(5);
    expect(values.volume).toBeCloseTo(0.7333, 3);
  }
  await page.getByRole('button', { name: 'Activer le son' }).click();
  await expect(page.getByText('Son activé', { exact: true })).toBeVisible();
});

test('layer rename, color, visibility and lock are undoable', async ({ page }) => {
  await page.goto(url);
  const row = page.locator('.jt-layer-row[data-row-id="logo"]');
  const original = await page.evaluate(() => window.editorDemo?.toJSON());
  await row.locator('.jt-layer-row__name').dblclick();
  await row.locator('.jt-layer-row__name-input').fill('Titre');
  await row.locator('.jt-layer-row__name-input').press('Enter');
  await row.locator('input[type="color"]').evaluate((input: HTMLInputElement) => {
    input.value = '#248f78'; input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await row.locator('.jt-layer-flag--visibility').click();
  await row.locator('.jt-layer-flag--lock').click();
  const changed = await page.evaluate(() => window.editorDemo?.toJSON());
  expect(changed).not.toEqual(original);
  for (let i = 0; i < 4; i++) expect(await page.evaluate(() => window.editorDemo?.undo())).toBe(true);
  expect(await page.evaluate(() => window.editorDemo?.toJSON())).toEqual(original);
  for (let i = 0; i < 4; i++) expect(await page.evaluate(() => window.editorDemo?.redo())).toBe(true);
  expect(await page.evaluate(() => window.editorDemo?.toJSON())).toEqual(changed);
  expect(await page.evaluate(() => window.editorDemo?.setProperty('logo', 'x', 50, { frame: 30 }))).toBe(false);
});

test('cadence and duration changes undo, while zoom leaves the document unchanged', async ({ page }) => {
  await page.goto(url);
  const before = await page.evaluate(() => window.editorDemo?.toJSON());
  const fps = page.getByRole('spinbutton', { name: /Cadence/ });
  const duration = page.getByRole('spinbutton', { name: /Durée/ });
  await fps.fill('30'); await fps.press('Enter');
  await duration.fill('72'); await duration.press('Enter');
  const changed = await page.evaluate(() => window.editorDemo?.toJSON());
  expect(changed?.settings).toEqual({ fps: 30, totalFrames: 72 });
  await page.getByRole('combobox', { name: 'Niveau de zoom', exact: true }).selectOption('2');
  expect(await page.evaluate(() => window.editorDemo?.getService('layout.zoom')?.zoom())).toBe(2);
  expect(await page.evaluate(() => window.editorDemo?.undo())).toBe(true);
  expect(await page.evaluate(() => window.editorDemo?.undo())).toBe(true);
  expect(await page.evaluate(() => window.editorDemo?.toJSON())).toEqual(before);
  expect(await page.evaluate(() => window.editorDemo?.redo())).toBe(true);
  expect(await page.evaluate(() => window.editorDemo?.redo())).toBe(true);
  expect(await page.evaluate(() => window.editorDemo?.toJSON())).toEqual(changed);
});


test('multiple layers can be grouped and the group restored through history', async ({ page }) => {
  await page.goto(url);
  const before = await page.evaluate(() => window.editorDemo?.toJSON());
  await page.locator('.jt-layer-row[data-row-id="logo"] .jt-layer-row__name').click();
  await page.locator('.jt-layer-row[data-row-id="orb"] .jt-layer-row__name').click({ modifiers: ['Control'] });
  await page.getByRole('button', { name: 'Grouper la sélection', exact: true }).click();
  const after = await page.evaluate(() => window.editorDemo?.toJSON());
  expect(after?.layers[0]?.type).toBe('folder');
  expect(await page.evaluate(() => window.editorDemo?.undo())).toBe(true);
  expect(await page.evaluate(() => window.editorDemo?.toJSON())).toEqual(before);
  expect(await page.evaluate(() => window.editorDemo?.redo())).toBe(true);
  expect(await page.evaluate(() => window.editorDemo?.toJSON())).toEqual(after);
});

test('content keys and motion tween commands restore their exact state', async ({ page }) => {
  await page.goto(url);
  const before = await page.evaluate(() => window.editorDemo?.toJSON());
  await page.evaluate(() => window.editorDemo?.getService('frames.selection')?.select({ rowId: 'orb', frame: 15 }));
  await page.getByRole('button', { name: 'Ajouter une image clé', exact: true }).click();
  const inserted = await page.evaluate(() => window.editorDemo?.toJSON());
  expect(inserted).not.toEqual(before);
  expect(await page.evaluate(() => window.editorDemo?.undo())).toBe(true);
  expect(await page.evaluate(() => window.editorDemo?.toJSON())).toEqual(before);
  expect(await page.evaluate(() => window.editorDemo?.redo())).toBe(true);
  expect(await page.evaluate(() => window.editorDemo?.toJSON())).toEqual(inserted);
  await page.evaluate(() => window.editorDemo?.getService('frames.selection')?.select({ rowId: 'orb', frame: 15 }));
  await page.getByRole('button', { name: 'Créer une interpolation de mouvement', exact: true }).click();
  const tweened = await page.evaluate(() => window.editorDemo?.toJSON());
  expect(tweened).not.toEqual(inserted);
  expect(await page.evaluate(() => window.editorDemo?.undo())).toBe(true);
  expect(await page.evaluate(() => window.editorDemo?.toJSON())).toEqual(inserted);
  expect(await page.evaluate(() => window.editorDemo?.redo())).toBe(true);
  expect(await page.evaluate(() => window.editorDemo?.toJSON())).toEqual(tweened);
});

test('scrubbing renders the expected transform and opacity and keeps scrolling aligned', async ({ page }) => {
  await page.goto(url);
  await page.evaluate(() => window.editorDemo?.playback.seek(30));
  const expectedX = 300 * 29 / 59;
  const expectedOpacity = 0.3 + 0.7 * 29 / 59;
  await expect.poll(() => page.locator('#logo').evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).m41)).toBeCloseTo(expectedX, 2);
  await expect.poll(() => page.locator('#logo').evaluate((element) => Number(getComputedStyle(element).opacity))).toBeCloseTo(expectedOpacity, 3);
  await page.locator('.jt-zone--frames').evaluate((node) => node.scrollTo({ left: 200, top: 0 }));
  await expect.poll(() => page.evaluate(() => {
    const frames = document.querySelector('.jt-zone--frames');
    const ruler = document.querySelector('.jt-zone--ruler');
    return frames !== null && ruler !== null ? Math.abs(frames.scrollLeft - ruler.scrollLeft) : -1;
  })).toBe(0);
  await expect(page.locator('.jt-zone--layers')).toBeVisible();
});

test('new layer and keyboard keyframe insertion can be undone and redone', async ({ page }) => {
  await page.goto(url);
  const original = await page.evaluate(() => window.editorDemo?.toJSON());
  await page.getByRole('button', { name: 'Nouveau calque', exact: true }).click();
  const added = await page.evaluate(() => window.editorDemo?.toJSON());
  expect(added?.layers.length).toBe(3);
  expect(await page.evaluate(() => window.editorDemo?.undo())).toBe(true);
  expect(await page.evaluate(() => window.editorDemo?.toJSON())).toEqual(original);
  expect(await page.evaluate(() => window.editorDemo?.redo())).toBe(true);
  expect(await page.evaluate(() => window.editorDemo?.toJSON())).toEqual(added);
  await page.evaluate(() => window.editorDemo?.getService('frames.selection')?.select({ rowId: 'orb', frame: 15 }));
  await page.getByRole('slider', { name: 'Tête de lecture', exact: true }).focus();
  await page.keyboard.press('F6');
  const inserted = await page.evaluate(() => window.editorDemo?.toJSON());
  expect(inserted).not.toEqual(added);
  expect(await page.evaluate(() => window.editorDemo?.undo())).toBe(true);
  expect(await page.evaluate(() => window.editorDemo?.toJSON())).toEqual(added);
  expect(await page.evaluate(() => window.editorDemo?.redo())).toBe(true);
  expect(await page.evaluate(() => window.editorDemo?.toJSON())).toEqual(inserted);
});

test('dragging and deleting a content key are each undoable', async ({ page }) => {
  await page.goto(url);
  await page.evaluate(() => window.editorDemo?.getService('frames.selection')?.select({ rowId: 'orb', frame: 15 }));
  await page.getByRole('button', { name: 'Ajouter une image clé', exact: true }).click();
  const inserted = await page.evaluate(() => window.editorDemo?.toJSON());
  // Mouse coordinates only reach what is on screen, however long the demo links get.
  await page.evaluate(() => window.editorDemo?.getService('frames.grid')?.element()?.scrollIntoView({ block: 'center' }));
  const point = (frame: number) => page.evaluate((frame) => {
    const editor = window.editorDemo;
    const grid = editor?.getService('frames.grid');
    const ruler = editor?.getService('layout.ruler');
    const rect = grid?.element()?.getBoundingClientRect();
    const row = grid?.rows().find((item) => item.id === 'orb');
    if (!grid || !ruler || !rect || !row) throw new Error('Grid missing');
    return { x: rect.left + ruler.frameLeft(frame) + grid.frameWidth() / 2, y: rect.top + row.index * grid.rowHeight() + grid.rowHeight() / 2 };
  }, frame);
  const from = await point(15); const to = await point(18);
  await page.mouse.click(from.x, from.y);
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 }); await page.mouse.up();
  const moved = await page.evaluate(() => window.editorDemo?.toJSON());
  expect(moved).not.toEqual(inserted);
  expect(await page.evaluate(() => window.editorDemo?.undo())).toBe(true);
  expect(await page.evaluate(() => window.editorDemo?.toJSON())).toEqual(inserted);
  expect(await page.evaluate(() => window.editorDemo?.redo())).toBe(true);
  expect(await page.evaluate(() => window.editorDemo?.toJSON())).toEqual(moved);
  await page.evaluate(() => window.editorDemo?.getService('frames.selection')?.select({ rowId: 'orb', frame: 18 }));
  await page.getByRole('button', { name: "Supprimer l'image clé", exact: true }).click();
  const removed = await page.evaluate(() => window.editorDemo?.toJSON());
  expect(removed).not.toEqual(moved);
  expect(await page.evaluate(() => window.editorDemo?.undo())).toBe(true);
  expect(await page.evaluate(() => window.editorDemo?.toJSON())).toEqual(moved);
  expect(await page.evaluate(() => window.editorDemo?.redo())).toBe(true);
  expect(await page.evaluate(() => window.editorDemo?.toJSON())).toEqual(removed);
});

test('a locked layer rejects the toolbar and F6 without changing history', async ({ page }) => {
  await page.goto(url);
  await page.locator('.jt-layer-row[data-row-id="orb"] .jt-layer-flag--lock').click();
  const locked = await page.evaluate(() => window.editorDemo?.toJSON());
  await page.evaluate(() => window.editorDemo?.getService('frames.selection')?.select({ rowId: 'orb', frame: 15 }));
  const insert = page.getByRole('button', { name: 'Ajouter une image clé', exact: true });
  await expect(insert).toHaveAttribute('aria-disabled', 'true');
  await insert.focus(); await page.keyboard.press('Enter');
  await page.getByRole('slider', { name: 'Tête de lecture', exact: true }).focus();
  await page.keyboard.press('F6');
  expect(await page.evaluate(() => window.editorDemo?.toJSON())).toEqual(locked);
  expect(await page.evaluate(() => window.editorDemo?.undo())).toBe(true);
  expect(await page.evaluate(() => window.editorDemo?.redo())).toBe(true);
  expect(await page.evaluate(() => window.editorDemo?.toJSON())).toEqual(locked);
});

test('keyboard reorder changes the layer order and restores it', async ({ page }) => {
  await page.goto(url);
  const original = await page.evaluate(() => window.editorDemo?.toJSON());
  const row = page.locator('.jt-layer-row[data-row-id="logo"]');
  await row.locator('.jt-layer-row__name').click();
  await row.press('Control+Alt+ArrowDown');
  const moved = await page.evaluate(() => window.editorDemo?.toJSON());
  expect(moved?.layers.map((layer) => layer.id)).toEqual(['orb', 'logo']);
  expect(await page.evaluate(() => window.editorDemo?.undo())).toBe(true);
  expect(await page.evaluate(() => window.editorDemo?.toJSON())).toEqual(original);
  expect(await page.evaluate(() => window.editorDemo?.redo())).toBe(true);
  expect(await page.evaluate(() => window.editorDemo?.toJSON())).toEqual(moved);
});


test('two content keys create a tween which can be removed and restored', async ({ page }) => {
  await page.goto(url);
  const original = await page.evaluate(() => window.editorDemo?.toJSON());
  await page.evaluate(() => window.editorDemo?.getService('frames.selection')?.set([{ rowId: 'orb', frame: 1 }, { rowId: 'orb', frame: 31 }]));
  await page.getByRole('button', { name: 'Créer une interpolation de mouvement', exact: true }).click();
  const tween = await page.evaluate(() => window.editorDemo?.toJSON());
  const orb = tween?.layers.find((node) => node.id === 'orb');
  expect(orb?.type === 'layer' && orb.spans[0].kind).toBe('tween');
  expect(await page.evaluate(() => window.editorDemo?.undo())).toBe(true);
  expect(await page.evaluate(() => window.editorDemo?.toJSON())).toEqual(original);
  expect(await page.evaluate(() => window.editorDemo?.redo())).toBe(true);
  expect(await page.evaluate(() => window.editorDemo?.toJSON())).toEqual(tween);
  await page.evaluate(() => window.editorDemo?.getService('frames.selection')?.select({ rowId: 'orb', frame: 15 }));
  await page.getByRole('button', { name: "Supprimer l'interpolation", exact: true }).click();
  const removed = await page.evaluate(() => window.editorDemo?.toJSON());
  expect(removed).not.toEqual(tween);
  expect(await page.evaluate(() => window.editorDemo?.undo())).toBe(true);
  expect(await page.evaluate(() => window.editorDemo?.toJSON())).toEqual(tween);
  expect(await page.evaluate(() => window.editorDemo?.redo())).toBe(true);
  expect(await page.evaluate(() => window.editorDemo?.toJSON())).toEqual(removed);
});

test('dragging a layer into and out of a folder preserves undo and redo', async ({ page }) => {
  await page.goto(url);
  await page.getByRole('button', { name: 'Nouveau dossier', exact: true }).click();
  const folderId = await page.evaluate(() => window.editorDemo?.document.layers.find((node) => node.type === 'folder')?.id);
  if (!folderId) throw new Error('Folder missing');
  const before = await page.evaluate(() => window.editorDemo?.toJSON());
  expect(await page.evaluate(() => window.editorDemo?.undo())).toBe(true);
  expect(await page.evaluate(() => window.editorDemo?.redo())).toBe(true);
  expect(await page.evaluate(() => window.editorDemo?.toJSON())).toEqual(before);
  const drag = async (sourceId: string, targetId: string, ratio: number): Promise<void> => {
    const source = await page.locator(`.jt-layer-row[data-row-id="${sourceId}"] .jt-layer-row__name`).boundingBox();
    const target = await page.locator(`.jt-layer-row[data-row-id="${targetId}"]`).boundingBox();
    if (!source || !target) throw new Error('Layer row missing');
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down(); await page.mouse.move(target.x + target.width / 2, target.y + target.height * ratio, { steps: 8 }); await page.mouse.up();
  };
  await drag('orb', folderId, 0.5);
  const inside = await page.evaluate(() => window.editorDemo?.toJSON());
  const folder = inside?.layers.find((node) => node.id === folderId);
  expect(folder?.type === 'folder' && folder.children.some((node) => node.id === 'orb')).toBe(true);
  expect(await page.evaluate(() => window.editorDemo?.undo())).toBe(true);
  expect(await page.evaluate(() => window.editorDemo?.toJSON())).toEqual(before);
  expect(await page.evaluate(() => window.editorDemo?.redo())).toBe(true);
  expect(await page.evaluate(() => window.editorDemo?.toJSON())).toEqual(inside);
  await drag('orb', 'logo', 0.1);
  const outside = await page.evaluate(() => window.editorDemo?.toJSON());
  expect(outside?.layers.some((node) => node.id === 'orb')).toBe(true);
  expect(await page.evaluate(() => window.editorDemo?.undo())).toBe(true);
  expect(await page.evaluate(() => window.editorDemo?.toJSON())).toEqual(inside);
  expect(await page.evaluate(() => window.editorDemo?.redo())).toBe(true);
  expect(await page.evaluate(() => window.editorDemo?.toJSON())).toEqual(outside);
});

test('vertical scrolling keeps the layer rows and grid aligned', async ({ page }) => {
  await page.goto(url);
  await page.evaluate(() => {
    const editor = window.editorDemo;
    if (!editor) throw new Error('Editor missing');
    const doc = editor.toJSON();
    editor.load({ ...doc, layers: Array.from({ length: 30 }, (_, index) => ({ id: `row-${index}`, type: 'layer' as const,
      name: `Calque ${index}`, spans: [{ id: `span-${index}`, kind: 'static' as const, start: 1, end: 60 }] })) });
  });
  await page.locator('.jt-zone--frames').evaluate((node) => node.scrollTo({ top: 150 }));
  await expect.poll(() => page.evaluate(() => {
    const frames = document.querySelector('.jt-zone--frames'); const layers = document.querySelector('.jt-zone--layers');
    return frames && layers ? { top: frames.scrollTop, difference: Math.abs(frames.scrollTop - layers.scrollTop) } : null;
  })).toEqual({ top: 150, difference: 0 });
});

test('dragging a key on a locked layer does not change the document', async ({ page }) => {
  await page.goto(url);
  await page.evaluate(() => window.editorDemo?.getService('frames.selection')?.select({ rowId: 'orb', frame: 15 }));
  await page.getByRole('button', { name: 'Ajouter une image clé', exact: true }).click();
  await page.locator('.jt-layer-row[data-row-id="orb"] .jt-layer-flag--lock').click();
  const locked = await page.evaluate(() => window.editorDemo?.toJSON());
  const point = (frame: number) => page.evaluate((frame) => {
    const editor = window.editorDemo; const grid = editor?.getService('frames.grid');
    const ruler = editor?.getService('layout.ruler'); const rect = grid?.element()?.getBoundingClientRect();
    const row = grid?.rows().find((item) => item.id === 'orb');
    if (!grid || !ruler || !rect || !row) throw new Error('Grid missing');
    return { x: rect.left + ruler.frameLeft(frame) + grid.frameWidth() / 2, y: rect.top + row.index * grid.rowHeight() + grid.rowHeight() / 2 };
  }, frame);
  const from = await point(15); const to = await point(18);
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 }); await page.mouse.up();
  expect(await page.evaluate(() => window.editorDemo?.toJSON())).toEqual(locked);
  expect(await page.evaluate(() => window.editorDemo?.undo())).toBe(true);
  expect(await page.evaluate(() => window.editorDemo?.redo())).toBe(true);
  expect(await page.evaluate(() => window.editorDemo?.toJSON())).toEqual(locked);
});

test('shift and control select multiple layers without creating history', async ({ page }) => {
  await page.goto(url);
  const before = await page.evaluate(() => window.editorDemo?.toJSON());
  const logo = page.locator('.jt-layer-row[data-row-id="logo"] .jt-layer-row__name');
  const orb = page.locator('.jt-layer-row[data-row-id="orb"] .jt-layer-row__name');
  await logo.click(); await orb.click({ modifiers: ['Shift'] });
  expect(await page.evaluate(() => window.editorDemo?.getService('layers.selection')?.selected())).toEqual(['logo', 'orb']);
  await orb.click({ modifiers: ['Control'] });
  expect(await page.evaluate(() => window.editorDemo?.getService('layers.selection')?.selected())).toEqual(['logo']);
  expect(await page.evaluate(() => window.editorDemo?.canUndo)).toBe(false);
  expect(await page.evaluate(() => window.editorDemo?.toJSON())).toEqual(before);
});


for (const mode of ['stage', 'manual'] as const) {
  for (const layer of ['hero', 'music'] as const) {
    test(`${mode}: deleting ${layer} clears its output during playback and undo restores it`, async ({ page }) => {
      await page.goto(`${url}/scene.html`);
      await page.locator('#mode').selectOption(mode);
      await page.getByRole('button', { name: 'Activer le son' }).click();
      await expect(page.locator('#sound-status')).toHaveText('Son activé');
      await page.evaluate(() => {
        const editor = window.editorDemo;
        if (!editor) throw new Error('Editor missing');
        editor.playback.seek(24); editor.playback.speed = 0.01; editor.playback.play();
      });
      await expect(page.locator('#status')).toContainText('sprite 5 · volume 0.73');
      await page.locator(`.jt-layer-row[data-row-id="${layer}"] .jt-layer-row__name`).click();
      await page.getByRole('button', { name: 'Supprimer la sélection', exact: true }).click();
      if (layer === 'hero') await expect(page.locator('#status')).toContainText('position 0.0 · sprite 0');
      else await expect(page.locator('#status')).toContainText('volume 0.00');
      expect(await page.evaluate(() => window.editorDemo?.playback.playing)).toBe(true);
      expect(await page.evaluate(() => window.editorDemo?.undo())).toBe(true);
      await expect(page.locator('#status')).toContainText('sprite 5 · volume 0.73');
      expect(await page.evaluate(() => window.editorDemo?.playback.playing)).toBe(true);
    });
  }
  test(`${mode}: hiding music silences it during playback and undo restores it`, async ({ page }) => {
    await page.goto(`${url}/scene.html`);
    await page.locator('#mode').selectOption(mode);
    await page.getByRole('button', { name: 'Activer le son' }).click();
    await expect(page.locator('#sound-status')).toHaveText('Son activé');
    await page.evaluate(() => {
      const editor = window.editorDemo;
      if (!editor) throw new Error('Editor missing');
      editor.playback.seek(24); editor.playback.speed = 0.01; editor.playback.play();
    });
    await expect(page.locator('#status')).toContainText('volume 0.73');
    await page.locator('.jt-layer-row[data-row-id="music"] .jt-layer-flag--visibility').click();
    await expect(page.locator('#status')).toContainText('volume 0.00');
    expect(await page.evaluate(() => window.editorDemo?.playback.playing)).toBe(true);
    expect(await page.evaluate(() => window.editorDemo?.undo())).toBe(true);
    await expect(page.locator('#status')).toContainText('volume 0.73');
    expect(await page.evaluate(() => window.editorDemo?.playback.playing)).toBe(true);
  });
}
