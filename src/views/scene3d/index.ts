import { lazy } from 'react';

/** The 3D view, code-split (three.js / R3F load only when the view is shown). Render inside <Suspense>. */
export const Scene3DLazy = lazy(() => import('./Scene3D'));
