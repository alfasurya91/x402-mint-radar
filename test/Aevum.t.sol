// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Phase-2 forge tests for the Aevum x402 seller agent.
// Covers: TestUSD (EIP-3009 transferWithAuthorization, sequential nonces),
// the ERC-8004 reference registries deployed through the
// HardhatMinimalUUPS -> ERC1967Proxy -> upgrade pattern, agent
// registration, and reputation feedback. Written 2026-11-16.
// NOTE: these tests validate the CONTRACTS. The pure-JS EIP-712 digest
// is cross-checked separately by scripts/crosscheck-eip712.mjs, which
// signs with the JS code and submits on a local anvil chain.
import "forge-std/Test.sol";
import {TestUSD} from "../contracts/TestUSD.sol";
import {IdentityRegistryUpgradeable} from "../contracts/vendor/IdentityRegistryUpgradeable.sol";
import {ReputationRegistryUpgradeable} from "../contracts/vendor/ReputationRegistryUpgradeable.sol";
import {HardhatMinimalUUPS} from "../contracts/vendor/HardhatMinimalUUPS.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract AevumTest is Test {
    // The Identity registry _safeMint()s the agent NFT to the caller, so
    // this test contract must accept ERC-721 safe transfers.
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    TestUSD token;
    address identityProxy;
    address reputationProxy;

    uint256 constant BUYER_KEY = 0x1234;
    uint256 constant OTHER_KEY = 0x5678;
    address buyer;
    address other;

    bytes32 constant TRANSFER_TYPEHASH =
        keccak256(
            "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
        );

    function setUp() public {
        buyer = vm.addr(BUYER_KEY);
        other = vm.addr(OTHER_KEY);

        // --- TestUSD: 1,000,000 aUSD (6 dec) minted to this contract.
        token = new TestUSD(1_000_000 * 1e6);

        // --- Identity registry through the reference proxy pattern.
        HardhatMinimalUUPS minimal = new HardhatMinimalUUPS();
        bytes memory initZero = abi.encodeWithSelector(
            HardhatMinimalUUPS.initialize.selector,
            address(0)
        );
        ERC1967Proxy idProxy = new ERC1967Proxy(address(minimal), initZero);
        identityProxy = address(idProxy);
        IdentityRegistryUpgradeable idImpl = new IdentityRegistryUpgradeable();
        bytes memory idInit = abi.encodeWithSelector(
            IdentityRegistryUpgradeable.initialize.selector
        );
        HardhatMinimalUUPS(identityProxy).upgradeToAndCall(address(idImpl), idInit);

        // --- Reputation registry through the same pattern.
        HardhatMinimalUUPS minimal2 = new HardhatMinimalUUPS();
        bytes memory initId = abi.encodeWithSelector(
            HardhatMinimalUUPS.initialize.selector,
            identityProxy
        );
        ERC1967Proxy repProxy = new ERC1967Proxy(address(minimal2), initId);
        reputationProxy = address(repProxy);
        ReputationRegistryUpgradeable repImpl = new ReputationRegistryUpgradeable();
        bytes memory repInit = abi.encodeWithSelector(
            ReputationRegistryUpgradeable.initialize.selector,
            identityProxy
        );
        HardhatMinimalUUPS(reputationProxy).upgradeToAndCall(address(repImpl), repInit);
    }

    function _authDigest(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce
    ) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                TRANSFER_TYPEHASH,
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce
            )
        );
        return
            keccak256(
                abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash)
            );
    }

    // --- TestUSD ---

    function testTokenMetadata() public view {
        assertEq(token.name(), "Aevum Test USD");
        assertEq(token.symbol(), "aUSD");
        assertEq(token.decimals(), 6);
        assertEq(token.totalSupply(), 1_000_000 * 1e6);
        assertEq(token.balanceOf(address(this)), 1_000_000 * 1e6);
    }

    function testNoncesStartAtZero() public view {
        assertEq(token.nonces(buyer), bytes32(uint256(0)));
    }

    function testTransferWithAuthorization() public {
        token.transfer(buyer, 100_000);
        uint256 validBefore = block.timestamp + 600;
        bytes32 nonce = token.nonces(buyer);
        bytes32 digest = _authDigest(buyer, address(this), 10_000, 0, validBefore, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(BUYER_KEY, digest);
        token.transferWithAuthorization(buyer, address(this), 10_000, 0, validBefore, nonce, v, r, s);
        assertEq(token.balanceOf(buyer), 90_000);
        assertEq(token.balanceOf(address(this)), 1_000_000 * 1e6 - 90_000);
        assertEq(token.nonces(buyer), bytes32(uint256(1)));
    }

    function testTransferWithAuthorizationReplayReverts() public {
        token.transfer(buyer, 100_000);
        uint256 validBefore = block.timestamp + 600;
        bytes32 nonce = token.nonces(buyer);
        bytes32 digest = _authDigest(buyer, address(this), 10_000, 0, validBefore, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(BUYER_KEY, digest);
        token.transferWithAuthorization(buyer, address(this), 10_000, 0, validBefore, nonce, v, r, s);
        vm.expectRevert("nonce mismatch");
        token.transferWithAuthorization(buyer, address(this), 10_000, 0, validBefore, nonce, v, r, s);
    }

    function testTransferWithAuthorizationWrongNonceReverts() public {
        token.transfer(buyer, 100_000);
        uint256 validBefore = block.timestamp + 600;
        bytes32 badNonce = bytes32(uint256(99));
        bytes32 digest = _authDigest(buyer, address(this), 10_000, 0, validBefore, badNonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(BUYER_KEY, digest);
        vm.expectRevert("nonce mismatch");
        token.transferWithAuthorization(buyer, address(this), 10_000, 0, validBefore, badNonce, v, r, s);
    }

    function testTransferWithAuthorizationExpiredReverts() public {
        token.transfer(buyer, 100_000);
        uint256 validBefore = block.timestamp - 1;
        bytes32 nonce = token.nonces(buyer);
        bytes32 digest = _authDigest(buyer, address(this), 10_000, 0, validBefore, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(BUYER_KEY, digest);
        vm.expectRevert("authorization expired");
        token.transferWithAuthorization(buyer, address(this), 10_000, 0, validBefore, nonce, v, r, s);
    }

    function testTransferWithAuthorizationBadSignatureReverts() public {
        token.transfer(buyer, 100_000);
        uint256 validBefore = block.timestamp + 600;
        bytes32 nonce = token.nonces(buyer);
        // Signed by OTHER_KEY but claims to be from `buyer`.
        bytes32 digest = _authDigest(buyer, address(this), 10_000, 0, validBefore, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(OTHER_KEY, digest);
        vm.expectRevert("bad signature");
        token.transferWithAuthorization(buyer, address(this), 10_000, 0, validBefore, nonce, v, r, s);
    }

    // --- ERC-8004 Identity ---

    function testRegisterAgent() public {
        IdentityRegistryUpgradeable reg = IdentityRegistryUpgradeable(identityProxy);
        uint256 agentId = reg.register("https://example.invalid/registration.json");
        assertEq(agentId, 0);
        assertEq(reg.ownerOf(0), address(this));
        assertEq(reg.tokenURI(0), "https://example.invalid/registration.json");
        bytes memory wallet = reg.getMetadata(0, "agentWallet");
        assertEq(wallet, abi.encodePacked(address(this)));
    }

    function testRegisterSecondAgentIncrementsId() public {
        IdentityRegistryUpgradeable reg = IdentityRegistryUpgradeable(identityProxy);
        assertEq(reg.register(), 0);
        assertEq(reg.register(), 1);
    }

    function testSetAgentURI() public {
        IdentityRegistryUpgradeable reg = IdentityRegistryUpgradeable(identityProxy);
        reg.register("https://example.invalid/old.json");
        reg.setAgentURI(0, "https://example.invalid/new.json");
        assertEq(reg.tokenURI(0), "https://example.invalid/new.json");
    }

    // --- ERC-8004 Reputation ---

    function testGiveAndReadFeedback() public {
        IdentityRegistryUpgradeable reg = IdentityRegistryUpgradeable(identityProxy);
        uint256 agentId = reg.register();
        ReputationRegistryUpgradeable rep = ReputationRegistryUpgradeable(reputationProxy);
        // `other` (not the agent owner) leaves feedback.
        vm.prank(other);
        rep.giveFeedback(agentId, 100, 0, "paid-call", "radar", "https://127.0.0.1:8787/radar", "", bytes32(0));
        (
            int128 value,
            uint8 valueDecimals,
            string memory tag1,
            string memory tag2,
            bool isRevoked
        ) = rep.readFeedback(agentId, other, 1);
        assertEq(value, 100);
        assertEq(valueDecimals, 0);
        assertEq(isRevoked, false);
        assertEq(tag1, "paid-call");
        assertEq(tag2, "radar");
    }

    function testSelfFeedbackReverts() public {
        IdentityRegistryUpgradeable reg = IdentityRegistryUpgradeable(identityProxy);
        uint256 agentId = reg.register();
        ReputationRegistryUpgradeable rep = ReputationRegistryUpgradeable(reputationProxy);
        vm.expectRevert("Self-feedback not allowed");
        rep.giveFeedback(agentId, 100, 0, "x", "y", "", "", bytes32(0));
    }

    function testRevokeFeedback() public {
        IdentityRegistryUpgradeable reg = IdentityRegistryUpgradeable(identityProxy);
        uint256 agentId = reg.register();
        ReputationRegistryUpgradeable rep = ReputationRegistryUpgradeable(reputationProxy);
        vm.prank(other);
        rep.giveFeedback(agentId, 50, 0, "t1", "t2", "", "", bytes32(0));
        vm.prank(other);
        rep.revokeFeedback(agentId, 1);
        (, , , , bool isRevoked) = rep.readFeedback(agentId, other, 1);
        assertEq(isRevoked, true);
    }
}
