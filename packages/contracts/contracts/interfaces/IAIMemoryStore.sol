// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

interface IAIMemoryStore {
    struct MemoryHandles {
        bytes32 memoryHash;
        bytes32 lastInteraction;
        bytes32 interactionCount;
        bytes32 memoryTier;
    }

    function updateMemory(
        address user,
        bytes calldata inMemoryHash,
        bytes calldata inLastInteraction
    ) external;

    function getMemoryHandles(address user) external view returns (MemoryHandles memory);
}
