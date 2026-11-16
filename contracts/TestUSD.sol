// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Minimal test ERC-20 (6 decimals) with EIP-3009 transferWithAuthorization.
// Aevum testnet ONLY — no monetary value. Written 2026-11-16 for the
// Aevum/QDay Builder Challenge (x402 Mint Radar). No dependencies.
//
// EIP-3009 (spec-compliant): nonces are sequential per address.
// `nonces(authorizer)` returns the next unused nonce as bytes32; an
// authorization's nonce must equal it, and it increments on use.
// The EIP-712 domain is EIP712Domain(name, "1", chainId, this contract),
// matching the pure-JS domain separator in eip712.mjs.
contract TestUSD {
    string public name = "Aevum Test USD";
    string public symbol = "aUSD";
    uint8 public decimals = 6;
    uint256 public totalSupply;
    address public owner;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    // EIP-3009: next unused nonce per authorizer, stored as uint256.
    mapping(address => uint256) private _nonces;

    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
        keccak256(
            "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
        );
    bytes32 private immutable _CACHED_DOMAIN_SEPARATOR;
    uint256 private immutable _CACHED_CHAIN_ID;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);

    constructor(uint256 initialSupply) {
        owner = msg.sender;
        _CACHED_CHAIN_ID = block.chainid;
        _CACHED_DOMAIN_SEPARATOR = _buildDomainSeparator();
        _mint(msg.sender, initialSupply);
    }

    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        if (block.chainid == _CACHED_CHAIN_ID) return _CACHED_DOMAIN_SEPARATOR;
        return _buildDomainSeparator();
    }

    function _buildDomainSeparator() private view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    keccak256(
                        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                    ),
                    keccak256(bytes(name)),
                    keccak256(bytes("1")),
                    block.chainid,
                    address(this)
                )
            );
    }

    /// @notice EIP-3009: the next unused nonce for `authorizer`, as bytes32.
    function nonces(address authorizer) external view returns (bytes32) {
        return bytes32(_nonces[authorizer]);
    }

    function _mint(address to, uint256 amount) internal {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    /// @notice Testnet-only faucet: owner mints test tokens for demos.
    function mint(address to, uint256 amount) external {
        require(msg.sender == owner, "only owner");
        _mint(to, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allowance");
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }

    /// @notice EIP-3009 transferWithAuthorization. Callable by anyone
    /// (the seller server submits the buyer's signed authorization and
    /// pays the gas); the tokens move from `from` to `to`.
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        require(block.timestamp > validAfter, "authorization not yet valid");
        require(block.timestamp < validBefore, "authorization expired");
        require(nonce == bytes32(_nonces[from]), "nonce mismatch");

        bytes32 structHash = keccak256(
            abi.encode(
                TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash)
        );
        address signer = ecrecover(digest, v, r, s);
        require(signer == from, "bad signature");

        _nonces[from] += 1;
        emit AuthorizationUsed(from, nonce);
        _transfer(from, to, value);
    }
}
