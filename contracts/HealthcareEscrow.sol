// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * Healthcare Escrow v2 — Impact-Weighted Value Distribution
 *
 * Holds USDC until Proof of Care + settlement rules pass, then splits to:
 * - 50% Patient HSA (wealth)
 * - 20% Healthcare Staff (care)
 * - 20% Investor Pool (infrastructure)
 * - 10% Protocol Treasury (AI/dev)
 *
 * Supports: Impact tiers, data revocation (GDPR/HIPAA), reputation slashing.
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
    address public relayer;
    address public treasury;
    address public investorPool;

    // Impact tier: 1 = Common, 2 = Rare/Cancer (may require M-of-N specialist verification off-chain)
    uint8 public constant TIER_COMMON = 1;
    uint8 public constant TIER_RARE = 2;

    // Split basis points (10000 = 100%)
    uint16 public constant PATIENT_BPS = 5000;   // 50%
    uint16 public constant STAFF_BPS = 2000;     // 20%
    uint16 public constant INVESTOR_BPS = 2000;  // 20%
    uint16 public constant PROTOCOL_BPS = 1000;  // 10%
    uint16 public constant BPS_DENOM = 10000;

    struct EscrowEntry {
        string claimId;
        address insurer;
        address patientHSA;
        address healthcareStaff;
        uint256 totalAmount;
        uint8 impactTier;
        uint256 createdAt;
        bool released;
        bytes32 dataIntegrityHash;  // Salted hash linking to Octopi scan (PHI-safe)
    }

    mapping(bytes32 => EscrowEntry) public escrows;
    bytes32[] public escrowIds;

    // Data revocation: patient can revoke future research access (GDPR/HIPAA)
    mapping(bytes32 => address) public dataHashToOwner;
    mapping(bytes32 => bool) public revokedDataHashes;

    // Reputation slash: staff share goes to treasury when slashed for false positives
    mapping(bytes32 => mapping(address => bool)) public staffSlashed;

    // Incentive pool for Tier 2 bonuses (funded separately)
    uint256 public incentivePoolBalance;

    event Deposited(
        bytes32 indexed escrowHash,
        string claimId,
        address insurer,
        address patientHSA,
        address healthcareStaff,
        uint256 amount,
        uint8 impactTier
    );
    event Released(
        bytes32 indexed escrowHash,
        string claimId,
        address patientHSA,
        address healthcareStaff,
        address investorPool,
        address treasury,
        uint256 patientAmount,
        uint256 staffAmount,
        uint256 investorAmount,
        uint256 protocolAmount
    );
    event DataAccessRevoked(bytes32 indexed dataHash, address revokedBy);
    event StaffSlashed(bytes32 indexed escrowHash, address staff, uint256 amountToTreasury);
    event IncentivePoolFunded(uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyRelayer() {
        require(msg.sender == relayer || msg.sender == owner, "Not authorized");
        _;
    }

    constructor(address _usdc, address _relayer, address _treasury, address _investorPool) {
        usdc = IERC20(_usdc);
        owner = msg.sender;
        relayer = _relayer;
        treasury = _treasury;
        investorPool = _investorPool;
    }

    function setRelayer(address _relayer) external onlyOwner {
        relayer = _relayer;
    }

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }

    function setInvestorPool(address _pool) external onlyOwner {
        investorPool = _pool;
    }

    /**
     * Deposit with multi-recipient addresses (wallet addresses, not internal IDs).
     * Links optional dataIntegrityHash for revocation support.
     */
    function deposit(
        string calldata claimId,
        address patientHSA,
        address healthcareStaff,
        uint256 amount,
        uint8 impactTier,
        bytes32 dataIntegrityHash
    ) external {
        require(amount > 0, "Amount must be > 0");
        require(patientHSA != address(0), "Invalid patient HSA");
        require(healthcareStaff != address(0), "Invalid staff");
        require(impactTier == TIER_COMMON || impactTier == TIER_RARE, "Invalid tier");

        bytes32 h = keccak256(abi.encodePacked(claimId, msg.sender, patientHSA, block.timestamp));
        require(escrows[h].totalAmount == 0, "Escrow exists");

        require(usdc.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        escrows[h] = EscrowEntry({
            claimId: claimId,
            insurer: msg.sender,
            patientHSA: patientHSA,
            healthcareStaff: healthcareStaff,
            totalAmount: amount,
            impactTier: impactTier,
            createdAt: block.timestamp,
            released: false,
            dataIntegrityHash: dataIntegrityHash
        });
        escrowIds.push(h);

        if (dataIntegrityHash != bytes32(0)) {
            dataHashToOwner[dataIntegrityHash] = patientHSA;
        }

        emit Deposited(h, claimId, msg.sender, patientHSA, healthcareStaff, amount, impactTier);
    }

    /**
     * Legacy deposit for backward compatibility (single provider).
     * Splits as: provider gets staff share, patientHSA and investorPool must be set via defaults.
     * Prefer deposit() for new flows.
     */
    function depositLegacy(
        string calldata claimId,
        address provider,
        uint256 amount
    ) external {
        require(amount > 0, "Amount must be > 0");
        require(provider != address(0), "Invalid provider");

        bytes32 h = keccak256(abi.encodePacked(claimId, msg.sender, provider, block.timestamp));
        require(escrows[h].totalAmount == 0, "Escrow exists");

        require(usdc.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        escrows[h] = EscrowEntry({
            claimId: claimId,
            insurer: msg.sender,
            patientHSA: provider,  // Legacy: no HSA, use provider
            healthcareStaff: provider,
            totalAmount: amount,
            impactTier: TIER_COMMON,
            createdAt: block.timestamp,
            released: false,
            dataIntegrityHash: bytes32(0)
        });
        escrowIds.push(h);

        emit Deposited(h, claimId, msg.sender, provider, provider, amount, TIER_COMMON);
    }

    /**
     * Impact-weighted release: 50/20/20/10 split.
     * Patient, Staff, Investor, Protocol. Staff share goes to treasury if slashed.
     */
    function releaseImpactWeighted(bytes32 escrowHash) external onlyRelayer {
        EscrowEntry storage e = escrows[escrowHash];
        require(e.totalAmount > 0, "No escrow");
        require(!e.released, "Already released");

        if (e.dataIntegrityHash != bytes32(0)) {
            require(!revokedDataHashes[e.dataIntegrityHash], "Data access revoked");
        }

        e.released = true;

        uint256 patientAmount = (e.totalAmount * PATIENT_BPS) / BPS_DENOM;
        uint256 staffAmount = (e.totalAmount * STAFF_BPS) / BPS_DENOM;
        uint256 investorAmount = (e.totalAmount * INVESTOR_BPS) / BPS_DENOM;
        uint256 protocolAmount = (e.totalAmount * PROTOCOL_BPS) / BPS_DENOM;

        bool slashed = staffSlashed[escrowHash][e.healthcareStaff];
        if (slashed) {
            protocolAmount += staffAmount;
            staffAmount = 0;
        }

        require(usdc.transfer(e.patientHSA, patientAmount), "Patient transfer failed");
        if (staffAmount > 0) {
            require(usdc.transfer(e.healthcareStaff, staffAmount), "Staff transfer failed");
        }
        require(usdc.transfer(investorPool, investorAmount), "Investor transfer failed");
        require(usdc.transfer(treasury, protocolAmount), "Treasury transfer failed");

        emit Released(
            escrowHash, e.claimId,
            e.patientHSA, e.healthcareStaff, investorPool, treasury,
            patientAmount, staffAmount, investorAmount, protocolAmount
        );
    }

    /**
     * Legacy single-recipient release (backward compatibility).
     */
    function release(bytes32 escrowHash) external onlyRelayer {
        EscrowEntry storage e = escrows[escrowHash];
        require(e.totalAmount > 0, "No escrow");
        require(!e.released, "Already released");

        e.released = true;
        require(usdc.transfer(e.healthcareStaff, e.totalAmount), "Transfer failed");

        emit Released(
            escrowHash, e.claimId,
            e.patientHSA, e.healthcareStaff, investorPool, treasury,
            0, e.totalAmount, 0, 0
        );
    }

    /**
     * Patient revokes future research access to their data (GDPR Right to be Forgotten / HIPAA).
     * Only the data owner (patient HSA) can revoke. Blocks release for escrows using this hash.
     */
    function revokeDataAccess(bytes32 dataHash) external {
        require(dataHashToOwner[dataHash] == msg.sender, "Not data owner");
        require(!revokedDataHashes[dataHash], "Already revoked");
        revokedDataHashes[dataHash] = true;
        emit DataAccessRevoked(dataHash, msg.sender);
    }

    /**
     * Slash staff for verified false positives. Their share goes to treasury instead.
     * Callable by relayer after off-chain verification (e.g., biopsy contradicts AI/specialist).
     */
    function slashStaff(bytes32 escrowHash, address staff) external onlyRelayer {
        EscrowEntry storage e = escrows[escrowHash];
        require(e.healthcareStaff == staff, "Staff mismatch");
        require(e.totalAmount > 0, "No escrow");
        require(!e.released, "Already released");
        require(!staffSlashed[escrowHash][staff], "Already slashed");

        staffSlashed[escrowHash][staff] = true;
        uint256 slashAmount = (e.totalAmount * STAFF_BPS) / BPS_DENOM;
        emit StaffSlashed(escrowHash, staff, slashAmount);
    }

    function fundIncentivePool(uint256 amount) external onlyOwner {
        require(usdc.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        incentivePoolBalance += amount;
        emit IncentivePoolFunded(amount);
    }

    function getEscrow(bytes32 escrowHash) external view returns (
        string memory claimId,
        address insurer,
        address patientHSA,
        address healthcareStaff,
        uint256 totalAmount,
        uint8 impactTier,
        uint256 createdAt,
        bool released,
        bytes32 dataIntegrityHash
    ) {
        EscrowEntry storage e = escrows[escrowHash];
        return (
            e.claimId, e.insurer, e.patientHSA, e.healthcareStaff,
            e.totalAmount, e.impactTier, e.createdAt, e.released,
            e.dataIntegrityHash
        );
    }

    function isDataRevoked(bytes32 dataHash) external view returns (bool) {
        return revokedDataHashes[dataHash];
    }

    function isStaffSlashed(bytes32 escrowHash, address staff) external view returns (bool) {
        return staffSlashed[escrowHash][staff];
    }
}
