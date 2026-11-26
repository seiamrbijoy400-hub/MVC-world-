/**
 * Resolve a bundled asset against the page base so the game also works when
 * hosted under a subpath (e.g. /game/). Node tests have no document.baseURI,
 * so they keep the historical root-absolute URLs and their fetch stubs work.
 */
const assetRoot: string = (() => {
  try {
    if (typeof document !== 'undefined' && document.baseURI) {
      return new URL('.', document.baseURI).pathname;
    }
  } catch {
    // Fall through to root.
  }
  return '/';
})();

export function assetUrl(path: string): string {
  return `${assetRoot}${path.replace(/^\/+/, '')}`;
}
