// e2e/runtime/demoUrl.ts
/**
 * Adresse de la démo du runtime (demo/runtime), servie après `npm run build:demo`.
 * Le port vient de `E2E_RUNTIME_PORT` (9001 par défaut), comme pour la
 * configuration Vite de la démo : voir tools/devPorts.ts.
 */
import { devUrl, runtimePort } from '../../tools/devPorts';

export const RUNTIME_DEMO_PORT = runtimePort();
export const RUNTIME_DEMO_URL = devUrl(RUNTIME_DEMO_PORT);
