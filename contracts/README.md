# Healthcare Escrow Smart Contracts

Impact-weighted USDC escrow for the Decentralized Diagnostic Economy. Holds funds until Proof of Care + settlement rules pass, then distributes via **50/20/20/10** split.

## Split (Impact Matrix)

| Recipient | Share | Purpose |
|-----------|-------|---------|
| Patient HSA | 50% | Wealth to the patient |
| Healthcare Staff | 20% | Care providers |
| Investor Pool | 20% | Infrastructure |
| Protocol Treasury | 10% | AI/Dev |

## Contracts

- **HealthcareEscrow.sol** (v2)
  - `deposit()` — Multi-recipient with `patientHSA`, `healthcareStaff`, `impactTier`, `dataIntegrityHash`
  - `releaseImpactWeighted()` — 50/20/20/10 split
  - `revokeDataAccess(bytes32)` — Patient revokes research access (GDPR/HIPAA)
  - `slashStaff(bytes32, address)` — Penalize false positives; staff share → treasury
  - `depositLegacy()` / `release()` — Backward compatible single-provider flow

## Deployment

### Constructor

```solidity
constructor(
  address _usdc,
  address _relayer,
  address _treasury,
  address _investorPool
)
```

### Polygon Amoy (Testnet)

- USDC: `0x07865c6e87b9f70255377e024ace6630c1eaa37f`
- Relayer: Backend wallet (calls release after PoC + settlement)
- Treasury: Protocol wallet (10% share)
- InvestorPool: Infrastructure investor wallet (20% share)

### Compile & Deploy

```bash
# Foundry
curl -L https://foundry.paradigm.xyz | bash
foundryup
forge build
forge create HealthcareEscrow --constructor-args <USDC> <RELAYER> <TREASURY> <INVESTOR_POOL> --rpc-url https://rpc-amoy.polygon.technology --private-key $PRIVATE_KEY

# Or Hardhat
npm install --save-dev hardhat @nomicfoundation/hardhat-toolbox
```

### Hardhat Config Example

```javascript
// hardhat.config.js
module.exports = {
  solidity: "0.8.20",
  networks: {
    polygonAmoy: {
      url: "https://rpc-amoy.polygon.technology",
      accounts: [process.env.PRIVATE_KEY]
    }
  }
};
```

## Integration Flow

1. **Deposit** (insurer or Pharma):  
   `deposit(claimId, patientHSA, healthcareStaff, amount, impactTier, dataIntegrityHash)`

2. **Backend** verifies Proof of Care (Octopi hash + specialist sign-off) and settlement rules.

3. **Optional**: If false positive verified, relayer calls `slashStaff(escrowHash, staff)`.

4. **Release**: Relayer calls `releaseImpactWeighted(escrowHash)` → 50/20/20/10 split.

5. **Patient revocation**: Patient HSA can call `revokeDataAccess(dataHash)` anytime → blocks future releases for that data.

## Gasless UX (ERC-4337)

For rural users (e.g., Busia), use **Account Abstraction** on Polygon so the treasury pays gas. Patients see full amounts (e.g., $10.00) without gas deductions.

## Security

- Relayer key must be secure and not exposed.
- Consider multisig for production.
- Audit before mainnet.
- `dataIntegrityHash` = salted SHA-256; never store raw PHI on-chain.
