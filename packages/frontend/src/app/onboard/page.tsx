import { redirect } from 'next/navigation';

// PRD Agent Training Pipeline v1.0 — /onboard is a stable shortcut into the
// onboarding wizard. Kept so external links (Substack, Twitter, docs) still
// land users in the flow. Points at /seller/onboard (the V1 wizard); the old
// /studio?tab=onboard tab never existed in the V1 seller portal.
export default function OnboardRedirect(): never {
  redirect('/seller/onboard');
}
