// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";
import "./interfaces/IAIContextManager.sol";

contract AIContextManager is IAIContextManager {
    struct EncryptedContext {
        euint128 sessionKey;
        euint64  userId;
        euint32  contextVersion;
        euint8   sentimentScore;
        euint8   trustLevel;
        euint8   memoryTier;
        ebool    isActive;
        ebool    isVerified;
        eaddress authorizedAgent;
    }

    mapping(address => EncryptedContext) private userContexts;

    event ContextWritten(address indexed user);
    event MemoryTierUpgraded(address indexed user);

    function writeContext(
        bytes calldata inSessionKey,
        bytes calldata inUserId,
        bytes calldata inSentimentScore,
        bytes calldata inTrustLevel,
        bytes calldata inIsVerified,
        bytes calldata inAuthorizedAgent
    ) external override {
        EncryptedContext storage ctx = userContexts[msg.sender];

        ctx.sessionKey       = FHE.asEuint128(inSessionKey);
        ctx.userId           = FHE.asEuint64(inUserId);
        ctx.sentimentScore   = FHE.asEuint8(inSentimentScore);
        ctx.trustLevel       = FHE.asEuint8(inTrustLevel);
        ctx.isVerified       = FHE.asEbool(inIsVerified);
        ctx.authorizedAgent  = FHE.asEaddress(inAuthorizedAgent);
        ctx.isActive         = FHE.asEbool(true);
        ctx.contextVersion   = FHE.add(ctx.contextVersion, FHE.asEuint32(1));

        emit ContextWritten(msg.sender);
    }

    function getContextHandles(address user) external view override returns (ContextHandles memory handles) {
        EncryptedContext storage ctx = userContexts[user];
        handles.sessionKey      = euint128.unwrap(ctx.sessionKey);
        handles.userId          = euint64.unwrap(ctx.userId);
        handles.contextVersion  = euint32.unwrap(ctx.contextVersion);
        handles.sentimentScore  = euint8.unwrap(ctx.sentimentScore);
        handles.trustLevel      = euint8.unwrap(ctx.trustLevel);
        handles.memoryTier      = euint8.unwrap(ctx.memoryTier);
        handles.isActive        = ebool.unwrap(ctx.isActive);
        handles.isVerified      = ebool.unwrap(ctx.isVerified);
        handles.authorizedAgent = eaddress.unwrap(ctx.authorizedAgent);
    }

    // Upgrades memoryTier from short(0) to medium(1) if trustLevel > 1, using FHE.select — no branch leak
    function conditionalUpgrade(address user) external override {
        EncryptedContext storage ctx = userContexts[user];
        ebool shouldUpgrade = FHE.gt(ctx.trustLevel, FHE.asEuint8(1));
        euint8 upgraded = FHE.select(shouldUpgrade, FHE.asEuint8(1), ctx.memoryTier);
        ctx.memoryTier = upgraded;
        emit MemoryTierUpgraded(user);
    }
}
