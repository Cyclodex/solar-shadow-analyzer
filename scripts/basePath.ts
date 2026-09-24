/**
 * Public base path of the build, from the environment variable BASE_PATH: '/' by default, e.g.
 * '/solar-shadow-analyzer/' for GitHub Pages. Always with a leading and a trailing slash, as Vite's `base`
 * and the e2e base URL expect. Shared by vite.config.ts and playwright.config.ts.
 */
export function basePath(raw: string | undefined = process.env.BASE_PATH): string {
  const inner = (raw ?? '').trim().replace(/^\/+|\/+$/g, '');
  return inner ? `/${inner}/` : '/';
}
