// demo/editor/src/conformance/index.ts
import * as editorModule from '@kazo-ca/timeline-editor';
import * as exportCssModule from '@kazo-ca/timeline-export-css';
import * as runtimeModule from '@kazo-ca/timeline-runtime';
import '@kazo-ca/timeline-editor/timeline-editor.css';
import { createGenericHandle, createUiHandle } from './factories';
import { createHtmlConformance } from './html';
import type { IHtmlHandle } from './htmlTypes';
import { emptyGenericDocument } from './scenes/generic';
import { uiDocument } from './scenes/ui';
import type { IConformanceHandle, ITlConformance } from './types';

const handles: IConformanceHandle[] = [];
let current: IConformanceHandle | undefined;
let currentHtml: IHtmlHandle | undefined;

function isHtmlHandle(handle: IConformanceHandle): handle is IHtmlHandle { return handle.handleKind === 'html'; }

function track<T extends IConformanceHandle>(handle: T): T {
  handles.push(handle);
  current = handle;
  if (isHtmlHandle(handle)) currentHtml = handle;
  return handle;
}

const conformance: ITlConformance = {
  ready: true,
  runtime: runtimeModule,
  editor: editorModule,
  exportCss: exportCssModule,
  get current() { return current; },
  html: createHtmlConformance(track, () => currentHtml),
  createGenericEditor: (options) => track(createGenericHandle(options)),
  createUiEditor: () => track(createUiHandle()),
  scenes: { emptyGeneric: emptyGenericDocument, ui: uiDocument },
  dispose() {
    const failures: unknown[] = [];
    for (const handle of handles.splice(0)) {
      try { handle.dispose(); } catch (error) { failures.push(error); }
    }
    current = undefined;
    currentHtml = undefined;
    if (failures.length > 0) throw new Error(`La libération de ${failures.length} éditeur(s) a échoué : ${failures.map(String).join(' ; ')}`);
  }
};
window.tlConformance = conformance;
window.addEventListener('pagehide', (event) => { if (!event.persisted) conformance.dispose(); });
