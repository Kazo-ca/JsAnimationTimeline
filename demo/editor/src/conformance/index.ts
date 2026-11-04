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

function track(handle: IConformanceHandle): IConformanceHandle {
  handles.push(handle);
  current = handle;
  if ('stage' in handle && 'scene' in handle) currentHtml = handle as IHtmlHandle;
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
    handles.splice(0).forEach((handle) => { if (!handle.editor.isDestroyed) handle.dispose(); });
    current = undefined;
    currentHtml = undefined;
  }
};
window.tlConformance = conformance;
window.addEventListener('pagehide', (event) => { if (!event.persisted) conformance.dispose(); });
