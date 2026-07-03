import { redirect } from 'next/navigation';

// PRD Agent Training Pipeline v1.0 — /onboard is now a tab inside /studio.
// This route is kept so external links (Substack, Twitter, docs) still land
// users in the onboarding flow.
export default function OnboardRedirect(): never {
  redirect('/studio?tab=onboard');
}
