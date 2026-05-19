#[test_only]
module fhe_brain::brain_registry_tests {
    use sui::test_scenario as ts;
    use sui::coin;
    use sui::sui::SUI;
    use sui::clock::{Self, Clock};
    use sui::transfer;
    use std::option;
    use fhe_brain::brain_registry::{
        Self as br,
        Brain,
        ENotOwner,
        EAlreadyPublished,
        ENotPublished,
        ESubscriptionExpired,
        EKYARequired,
    };
    use fhe_brain::subscription_policy::{Self as sp, SubscriptionPolicy};
    use fhe_brain::kya_gate;

    const ALICE: address = @0xA11CE;
    const BOB: address = @0xB0B;
    const PRICE: u64 = 100_000_000;
    const DURATION: u64 = 86_400_000;

    /// Helper: ALICE creates a policy + a brain bound to it; both go to ALICE.
    fun setup(scenario: &mut ts::Scenario, kya_required: bool): (ID, ID) {
        ts::next_tx(scenario, ALICE);
        let policy = sp::create_policy(PRICE, DURATION, scenario.ctx());
        let policy_id = object::id(&policy);
        transfer::public_share_object(policy);

        ts::next_tx(scenario, ALICE);
        let blobs = vector[b"blob-1", b"blob-2"];
        let brain = br::create_brain(blobs, b"meta-hash", policy_id, kya_required, 50, scenario.ctx());
        let brain_id = object::id(&brain);
        transfer::public_transfer(brain, ALICE);
        (policy_id, brain_id)
    }

    #[test]
    fun test_create_and_publish_emits_events() {
        let mut scenario = ts::begin(ALICE);
        let (_policy, _brain) = setup(&mut scenario, false);

        ts::next_tx(&mut scenario, ALICE);
        let mut brain = ts::take_from_sender<Brain>(&scenario);
        br::publish_brain(&mut brain, scenario.ctx());
        assert!(br::is_published(&brain), 0);
        ts::return_to_sender(&scenario, brain);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = ENotOwner)]
    fun test_publish_by_non_owner_aborts() {
        let mut scenario = ts::begin(ALICE);
        let (_policy, _brain) = setup(&mut scenario, false);

        // BOB tries to publish ALICE's brain.
        ts::next_tx(&mut scenario, ALICE);
        let mut brain = ts::take_from_address<Brain>(&scenario, ALICE);
        ts::next_tx(&mut scenario, BOB);
        br::publish_brain(&mut brain, scenario.ctx()); // aborts ENotOwner
        ts::return_to_address(ALICE, brain);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = EAlreadyPublished)]
    fun test_double_publish_aborts() {
        let mut scenario = ts::begin(ALICE);
        let (_policy, _brain) = setup(&mut scenario, false);

        ts::next_tx(&mut scenario, ALICE);
        let mut brain = ts::take_from_sender<Brain>(&scenario);
        br::publish_brain(&mut brain, scenario.ctx());
        br::publish_brain(&mut brain, scenario.ctx()); // aborts EAlreadyPublished
        ts::return_to_sender(&scenario, brain);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = ENotPublished)]
    fun test_authorize_read_unpublished_aborts() {
        let mut scenario = ts::begin(ALICE);
        let (_policy, _brain) = setup(&mut scenario, false);

        ts::next_tx(&mut scenario, BOB);
        let policy = ts::take_shared<SubscriptionPolicy>(&scenario);
        let clk = clock::create_for_testing(scenario.ctx());
        let payment = coin::mint_for_testing<SUI>(PRICE, scenario.ctx());
        let sub = sp::subscribe(&policy, payment, &clk, scenario.ctx());

        ts::next_tx(&mut scenario, ALICE);
        let brain = ts::take_from_sender<Brain>(&scenario);
        br::authorize_read(&brain, &policy, &sub, &clk, option::none()); // aborts ENotPublished

        // Cleanup.
        ts::return_to_sender(&scenario, brain);
        transfer::public_transfer(sub, BOB);
        ts::return_shared(policy);
        clock::destroy_for_testing(clk);
        ts::end(scenario);
    }

    #[test]
    fun test_authorize_read_happy_path_no_kya() {
        let mut scenario = ts::begin(ALICE);
        let (_policy, _brain) = setup(&mut scenario, false);

        // Publish the brain.
        ts::next_tx(&mut scenario, ALICE);
        let mut brain = ts::take_from_sender<Brain>(&scenario);
        br::publish_brain(&mut brain, scenario.ctx());
        ts::return_to_sender(&scenario, brain);

        // BOB subscribes.
        ts::next_tx(&mut scenario, BOB);
        let policy = ts::take_shared<SubscriptionPolicy>(&scenario);
        let clk = clock::create_for_testing(scenario.ctx());
        let payment = coin::mint_for_testing<SUI>(PRICE, scenario.ctx());
        let sub = sp::subscribe(&policy, payment, &clk, scenario.ctx());

        // Authorize read with no KYA claim — succeeds (kya_required=false).
        let brain = ts::take_from_address<Brain>(&scenario, ALICE);
        br::authorize_read(&brain, &policy, &sub, &clk, option::none());

        ts::return_to_address(ALICE, brain);
        transfer::public_transfer(sub, BOB);
        ts::return_shared(policy);
        clock::destroy_for_testing(clk);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = EKYARequired)]
    fun test_authorize_read_kya_required_without_claim_aborts() {
        let mut scenario = ts::begin(ALICE);
        let (_policy, _brain) = setup(&mut scenario, true); // kya_required = true

        ts::next_tx(&mut scenario, ALICE);
        let mut brain = ts::take_from_sender<Brain>(&scenario);
        br::publish_brain(&mut brain, scenario.ctx());
        ts::return_to_sender(&scenario, brain);

        ts::next_tx(&mut scenario, BOB);
        let policy = ts::take_shared<SubscriptionPolicy>(&scenario);
        let clk = clock::create_for_testing(scenario.ctx());
        let payment = coin::mint_for_testing<SUI>(PRICE, scenario.ctx());
        let sub = sp::subscribe(&policy, payment, &clk, scenario.ctx());

        let brain = ts::take_from_address<Brain>(&scenario, ALICE);
        br::authorize_read(&brain, &policy, &sub, &clk, option::none()); // aborts EKYARequired

        ts::return_to_address(ALICE, brain);
        transfer::public_transfer(sub, BOB);
        ts::return_shared(policy);
        clock::destroy_for_testing(clk);
        ts::end(scenario);
    }

    #[test]
    fun test_authorize_read_kya_with_valid_claim_passes() {
        let mut scenario = ts::begin(ALICE);
        let (_policy, _brain) = setup(&mut scenario, true);

        ts::next_tx(&mut scenario, ALICE);
        let mut brain = ts::take_from_sender<Brain>(&scenario);
        br::publish_brain(&mut brain, scenario.ctx());
        ts::return_to_sender(&scenario, brain);

        ts::next_tx(&mut scenario, BOB);
        let policy = ts::take_shared<SubscriptionPolicy>(&scenario);
        let clk = clock::create_for_testing(scenario.ctx());
        let payment = coin::mint_for_testing<SUI>(PRICE, scenario.ctx());
        let sub = sp::subscribe(&policy, payment, &clk, scenario.ctx());

        let claim = kya_gate::new_claim(b"agent-0xabc", 80, b"oracle-signed-proof");
        let brain = ts::take_from_address<Brain>(&scenario, ALICE);
        br::authorize_read(&brain, &policy, &sub, &clk, option::some(claim));

        ts::return_to_address(ALICE, brain);
        transfer::public_transfer(sub, BOB);
        ts::return_shared(policy);
        clock::destroy_for_testing(clk);
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = ESubscriptionExpired)]
    fun test_authorize_read_expired_subscription_aborts() {
        let mut scenario = ts::begin(ALICE);
        let (_policy, _brain) = setup(&mut scenario, false);

        ts::next_tx(&mut scenario, ALICE);
        let mut brain = ts::take_from_sender<Brain>(&scenario);
        br::publish_brain(&mut brain, scenario.ctx());
        ts::return_to_sender(&scenario, brain);

        ts::next_tx(&mut scenario, BOB);
        let policy = ts::take_shared<SubscriptionPolicy>(&scenario);
        let mut clk = clock::create_for_testing(scenario.ctx());
        let payment = coin::mint_for_testing<SUI>(PRICE, scenario.ctx());
        let sub = sp::subscribe(&policy, payment, &clk, scenario.ctx());

        // Advance past expiry.
        clock::increment_for_testing(&mut clk, DURATION + 1);

        let brain = ts::take_from_address<Brain>(&scenario, ALICE);
        br::authorize_read(&brain, &policy, &sub, &clk, option::none()); // aborts ESubscriptionExpired

        ts::return_to_address(ALICE, brain);
        transfer::public_transfer(sub, BOB);
        ts::return_shared(policy);
        clock::destroy_for_testing(clk);
        ts::end(scenario);
    }
}
