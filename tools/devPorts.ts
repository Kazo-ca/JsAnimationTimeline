// tools/devPorts.ts
/**
 * Ports des serveurs de démo (dev et preview), seule source pour les
 * configurations Vite et pour Playwright.
 *
 * Chaque dossier de travail qui lance les tests e2e en parallèle choisit sa
 * paire de ports par l'environnement, par exemple :
 *
 * ```bash
 * # bash, zsh (pour cette commande seulement)
 * E2E_V2_EDITOR_PORT=9100 E2E_RUNTIME_PORT=9101 npm run test:e2e
 * # PowerShell (pour toute la session du terminal)
 * $env:E2E_V2_EDITOR_PORT='9100'; $env:E2E_RUNTIME_PORT='9101'; npm run test:e2e
 * # cmd (pour toute la session du terminal)
 * set E2E_V2_EDITOR_PORT=9100&& set E2E_RUNTIME_PORT=9101&& npm run test:e2e
 * ```
 *
 * Sans variable, les ports par défaut restent 9002 (démo de l'éditeur) et
 * 9001 (démo du runtime). Les serveurs démarrent avec `strictPort` : un port
 * déjà pris fait échouer le démarrage au lieu d'en choisir un autre.
 */

/**
 * Adresse d'écoute des démos et adresse visitée par Playwright. « localhost »
 * peut désigner [::1] pour Vite et 127.0.0.1 pour Chromium : le serveur
 * refusait alors des requêtes au hasard (ERR_CONNECTION_REFUSED).
 */
export const DEV_HOST = '127.0.0.1';

/** URL d'une démo servie sur `port`, à l'adresse `DEV_HOST`. */
export function devUrl(port: number): string {
  return `http://${DEV_HOST}:${port}`;
}

/** Port par défaut de la démo de l'éditeur (demo/editor). */
export const DEFAULT_EDITOR_PORT = 9002;

/** Port par défaut de la démo du runtime (demo/runtime). */
export const DEFAULT_RUNTIME_PORT = 9001;

/** Variable d'environnement du port de la démo de l'éditeur. */
export const EDITOR_PORT_ENV = 'E2E_V2_EDITOR_PORT';

/** Variable d'environnement du port de la démo du runtime. */
export const RUNTIME_PORT_ENV = 'E2E_RUNTIME_PORT';

/** Variables d'environnement lues (par défaut, celles du processus). */
type Env = Record<string, string | undefined>;

/**
 * Port lu dans `env[name]`, ou `fallback` si la variable est absente ou vide.
 * Seuls des chiffres sont acceptés (`9e3`, `0x2328`, `9000.0` sont refusés).
 *
 * @throws Error si la valeur n'est pas un entier de 1 à 65535.
 */
export function portFromEnv(name: string, fallback: number, env: Env = process.env): number {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === '') return fallback;
  const port = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} doit être un port entier de 1 à 65535 (reçu : « ${raw} »).`);
  }
  return port;
}

/**
 * Les deux ports, valeurs par défaut comprises.
 *
 * @throws Error si une valeur est invalide ou si les deux ports sont égaux.
 */
function bothPorts(env: Env): { readonly editor: number; readonly runtime: number } {
  const editor = portFromEnv(EDITOR_PORT_ENV, DEFAULT_EDITOR_PORT, env);
  const runtime = portFromEnv(RUNTIME_PORT_ENV, DEFAULT_RUNTIME_PORT, env);
  if (editor === runtime) {
    throw new Error(
      `${EDITOR_PORT_ENV} et ${RUNTIME_PORT_ENV} doivent être différents (les deux valent ${editor}).`
    );
  }
  return { editor, runtime };
}

/** Port de la démo de l'éditeur (`E2E_V2_EDITOR_PORT`, 9002 par défaut, différent de celui du runtime). */
export function editorPort(env: Env = process.env): number {
  return bothPorts(env).editor;
}

/** Port de la démo du runtime (`E2E_RUNTIME_PORT`, 9001 par défaut, différent de celui de l'éditeur). */
export function runtimePort(env: Env = process.env): number {
  return bothPorts(env).runtime;
}
