# Healthcare Escrow Smart Contracts

Conditional USDC escrow for autonomous financial settlement. Holds insurer funds until Proof of Care is verified.

## Contracts

- **HealthcareEscrow.sol** - Holds USDC in pending until `release()` is called by authorized relayer (backend).

## Deployment

### Polygon Amoy (Testnet)

- USDC: `0x07865c6e87b9f70255377e024ace6630c1eaa37f`
- Relayer: Backend wallet address that will call `release()` after PoC + settlement rules pass

### Compile & Deploy

```bash
# Install Foundry or Hardhat
npm install --save-dev hardhat @nomicfoundation/hardhat-toolbox

# Or use Foundry
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

### Hardhat Example

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

### Integration with Backend

1. Insurer deposits: `escrow.deposit(claimId, providerAddress, amount)`
2. Backend calls `verifyProofOfCare()` + `evaluateSettlementRules()`
3. When both pass: backend (as relayer) calls `escrow.release(escrowHash)`
4. USDC transfers to provider

## Security

- Relayer must be a secure backend key (not exposed)
- Consider multisig for production
- Audit before mainnet
