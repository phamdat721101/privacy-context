/**
 * /studio — top-level dispatcher.
 *
 * Server Component. Reads FEATURE_SELLER_PORTAL_V1 at request time so
 * flag flips don't require a rebuild — only an api-side env var change +
 * frontend container restart. When the flag is off (or the master flag
 * FEATURE_OPENX_V2=false forces cascade), we render the Jul 3 mega-page
 * byte-identical (PRD-V ship-gate criterion 5).
 *
 * Both children are Client Components (they use usePrivy, useEffect,
 * hooks-that-touch-wallet). React lets a Server Component render Client
 * Components as children so this is idiomatic Next 14.
 *
 * SOLID:
 *   • SRP — dispatch only. All rendering lives in the child components.
 *   • OCP — a v1.1 rollout can add a new home component and switch the
 *          dispatch line without touching either child.
 */

import LegacyMegaPage from './legacyMega';
import StudioHomeV1 from './V1Home';

function isSellerPortalV1On(): boolean {
  // Master-flag cascade mirrors the api-side lib.isOpenxV2SubFlagOn.
  if (process.env.FEATURE_OPENX_V2 === 'false') return false;
  return process.env.FEATURE_SELLER_PORTAL_V1 === 'true';
}

export default function StudioPage(): JSX.Element {
  if (!isSellerPortalV1On()) {
    return <LegacyMegaPage />;
  }
  return <StudioHomeV1 />;
}
