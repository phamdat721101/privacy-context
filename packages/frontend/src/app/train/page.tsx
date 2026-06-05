'use client';

/**
 * /train — direct-access cognitive memory training console.
 *
 * Thin wrapper around the shared {@link TrainAndPublishPanel}. The same
 * component is also embedded in `/studio/[agentId]` (Train tab) so seller
 * actions live in one canonical surface; this top-level route exists for
 * advanced users + linking. Sui-only via {@link RequireSuiNetwork}.
 */

import { RequireSuiNetwork } from '@/components/RequireSuiNetwork';
import { TrainAndPublishPanel } from './_panel';

export default function TrainPage() {
  return (
    <RequireSuiNetwork
      title="Training is Sui-only"
      description="Switch to Sui to write memories into your Walrus account."
    >
      <TrainAndPublishPanel />
    </RequireSuiNetwork>
  );
}
