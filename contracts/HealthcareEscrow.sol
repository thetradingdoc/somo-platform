// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * Healthcare Claims Escrow
 * Holds USDC in "pending" until Proof of Care is verified.
 * Enables auto-approval logic for insurer payments on Polygon.
 *
 * Flow:
 * 1. Insurer deposits USDC for a claim (claimId)
 * 2. Backend verifies Proof of Care + settlement rules
 * 3. Authorized relayer calls release(claimId) to send USDC to provider
 */
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

contract HealthcareEscrow {
    IERC20 public usdc;
    address public owner;
    address public relayer;  // Backend/oracle authorized to trigger release

    struct EscrowEntry {
        string claimId;
        address insurer;
        address provider;
        uint256 amount;
        uint256 createdAt;
        bool released;
    }

    mapping(bytes32 => EscrowEntry) public escrows;
    bytes32[] public escrowIds;

    event Deposited(bytes32 indexed escrowHash, string claimId, address insurer, address provider, uint256 amount);
    event Released(bytes32 indexed escrowHash, string claimId, address provider, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyRelayer() {
        require(msg.sender == relayer || msg.sender == owner, "Not authorized");
        _;
    }

    constructor(address _usdc, address _relayer) {
        usdc = IERC20(_usdc);
        owner = msg.sender;
        relayer = _relayer;
    }

    function setRelayer(address _relayer) external onlyOwner {
        relayer = _relayer;
    }

    function deposit(
        string calldata claimId,
        address provider,
        uint256 amount
    ) external {
        require(amount > 0, "Amount must be > 0");
        require(provider != address(0), "Invalid provider");

        bytes32 h = keccak256(abi.encodePacked(claimId, msg.sender, provider, block.timestamp));
        require(escrows[h].amount == 0, "Escrow exists");

        require(usdc.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        escrows[h] = EscrowEntry({
            claimId: claimId,
            insurer: msg.sender,
            provider: provider,
            amount: amount,
            createdAt: block.timestamp,
            released: false
        });
        escrowIds.push(h);

        emit Deposited(h, claimId, msg.sender, provider, amount);
    }

    /**
     * Release escrowed USDC to provider.
     * Only callable by relayer (backend) after Proof of Care + settlement rules pass.
     */
    function release(bytes32 escrowHash) external onlyRelayer {
        EscrowEntry storage e = escrows[escrowHash];
        require(e.amount > 0, "No escrow");
        require(!e.released, "Already released");

        e.released = true;
        require(usdc.transfer(e.provider, e.amount), "Transfer failed");

        emit Released(escrowHash, e.claimId, e.provider, e.amount);
    }

    function getEscrow(bytes32 escrowHash) external view returns (
        string memory claimId,
        address insurer,
        address provider,
        uint256 amount,
        uint256 createdAt,
        bool released
    ) {
        EscrowEntry storage e = escrows[escrowHash];
        return (e.claimId, e.insurer, e.provider, e.amount, e.createdAt, e.released);
    }
}
