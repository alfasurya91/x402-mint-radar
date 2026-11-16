// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/**
 * @title HardhatMinimalUUPS
 * @dev Test version of MinimalUUPS that uses msg.sender as owner.
 * Used for hardhat tests to follow the proxy -> MinimalUUPS -> upgrade pattern.
 */
contract HardhatMinimalUUPS is OwnableUpgradeable, UUPSUpgradeable {
    /// @dev Identity registry address stored at slot 0 (matches real implementations)
    address private _identityRegistry;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address identityRegistry_) public initializer {
        __Ownable_init(msg.sender);
        // NOTE (vendored 2026-11-16): the upstream file calls
        // __UUPSUpgradeable_init() here, but OZ v5.7 removed that
        // initializer — UUPSUpgradeable is stateless in v5, so the call
        // is a no-op and is dropped. Upgrade authorization is unchanged.
        _identityRegistry = identityRegistry_;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    function getVersion() external pure returns (string memory) {
        return "0.0.1";
    }
}
