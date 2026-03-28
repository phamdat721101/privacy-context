// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

interface IAIContextManager {
    struct ContextHandles {
        bytes32 sessionKey;
        bytes32 userId;
        bytes32 contextVersion;
        bytes32 sentimentScore;
        bytes32 trustLevel;
        bytes32 memoryTier;
        bytes32 isActive;
        bytes32 isVerified;
        bytes32 authorizedAgent;
    }

    function writeContext(
        bytes calldata inSessionKey,
        bytes calldata inUserId,
        bytes calldata inSentimentScore,
        bytes calldata inTrustLevel,
        bytes calldata inIsVerified,
        bytes calldata inAuthorizedAgent
    ) external;

    function getContextHandles(address user) external view returns (ContextHandles memory);

    function conditionalUpgrade(address user) external;
}
