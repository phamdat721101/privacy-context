/// BrainRegistrySui — owns `Brain` objects whose encrypted content lives on
/// Walrus and whose access is gated by a `SubscriptionPolicy` (T7) and an
/// optional `KYAGate` (T10). Seal threshold key servers (T8) consume this
/// module's view via `seal_policy_id` to decide whether to release a key share.
module fhe_brain::brain_registry {
    use sui::event;
    use fhe_brain::subscription_policy::{Self as sp, SubscriptionPolicy, Subscription};
    use fhe_brain::kya_gate::{Self as kya, KYAClaim};
    use sui::clock::Clock;

    // --- error codes -------------------------------------------------------
    const ENotOwner: u64 = 0;
    const EAlreadyPublished: u64 = 1;
    const ENotPublished: u64 = 2;
    const EBadSubscription: u64 = 3;
    const ESubscriptionExpired: u64 = 4;
    const EKYARequired: u64 = 5;

    /// A brain in the registry. `walrus_blob_ids` are the Walrus object IDs of
    /// the encrypted chunks; `seal_policy_id` points at the SubscriptionPolicy
    /// that gates Seal key-server reads.
    public struct Brain has key, store {
        id: UID,
        owner: address,
        walrus_blob_ids: vector<vector<u8>>,
        content_metadata_hash: vector<u8>,
        seal_policy_id: ID,
        published: bool,
        kya_required: bool,
        min_reputation: u64,
    }

    public struct BrainCreated has copy, drop {
        id: ID,
        owner: address,
        seal_policy_id: ID,
    }

    public struct BrainPublished has copy, drop { id: ID }

    /// Create a private brain bound to `seal_policy_id`. Returns the Brain so
    /// the caller can `transfer::public_transfer` it to themselves (or share).
    public fun create_brain(
        walrus_blob_ids: vector<vector<u8>>,
        content_metadata_hash: vector<u8>,
        seal_policy_id: ID,
        kya_required: bool,
        min_reputation: u64,
        ctx: &mut TxContext,
    ): Brain {
        let brain = Brain {
            id: object::new(ctx),
            owner: ctx.sender(),
            walrus_blob_ids,
            content_metadata_hash,
            seal_policy_id,
            published: false,
            kya_required,
            min_reputation,
        };
        event::emit(BrainCreated {
            id: object::id(&brain),
            owner: brain.owner,
            seal_policy_id,
        });
        brain
    }

    /// Publish a brain to the catalog. Owner-only. Idempotent guard via assertion.
    public fun publish_brain(brain: &mut Brain, ctx: &TxContext) {
        assert!(brain.owner == ctx.sender(), ENotOwner);
        assert!(!brain.published, EAlreadyPublished);
        brain.published = true;
        event::emit(BrainPublished { id: object::id(brain) });
    }

    /// Authorize a read. This is the canonical access-control check for any
    /// downstream consumer (Seal key server, off-chain reader). Returns when
    /// successful; aborts with a precise error code on failure so callers can
    /// surface a clear UI error.
    public fun authorize_read(
        brain: &Brain,
        policy: &SubscriptionPolicy,
        sub: &Subscription,
        clock: &Clock,
        kya_claim: Option<KYAClaim>,
    ) {
        assert!(brain.published, ENotPublished);
        assert!(sp::policy_id(sub) == object::id(policy), EBadSubscription);
        assert!(object::id(policy) == brain.seal_policy_id, EBadSubscription);
        assert!(sp::is_valid(sub, clock), ESubscriptionExpired);

        if (brain.kya_required) {
            assert!(kya_claim.is_some(), EKYARequired);
            let claim_ref = kya_claim.borrow();
            assert!(kya::verify(claim_ref, brain.min_reputation), EKYARequired);
        };
        // Drop the option (Move requires explicit consumption).
        let _ = kya_claim;
    }

    // --- read accessors ----------------------------------------------------

    public fun walrus_blob_ids(b: &Brain): &vector<vector<u8>> { &b.walrus_blob_ids }
    public fun content_metadata_hash(b: &Brain): &vector<u8> { &b.content_metadata_hash }
    public fun seal_policy_id(b: &Brain): ID { b.seal_policy_id }
    public fun is_published(b: &Brain): bool { b.published }
    public fun kya_required(b: &Brain): bool { b.kya_required }
    public fun min_reputation(b: &Brain): u64 { b.min_reputation }
    public fun owner(b: &Brain): address { b.owner }
}
