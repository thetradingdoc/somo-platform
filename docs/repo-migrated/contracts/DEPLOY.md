# Deploy HealthcareEscrow to Polygon Amoy

## Prerequisites

```bash
# Install Foundry
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Or use Hardhat
npm install --save-dev hardhat @nomicfoundation/hardhat-toolbox
```

## Constructor Args

- `_usdc`: USDC on Polygon Amoy = `0x07865c6e87b9f70255377e024ace6630c1eaa37f`
- `_relayer`: Your backend wallet address (calls release)
- `_treasury`: Protocol wallet (receives 10%)
- `_investorPool`: Infrastructure investor wallet (receives 20%)

## Foundry Deploy

```bash
cd contracts
forge build
forge create HealthcareEscrow \
  --constructor-args \
    0x07865c6e87b9f70255377e024ace6630c1eaa37f \
    <RELAYER_ADDRESS> \
    <TREASURY_ADDRESS> \
    <INVESTOR_POOL_ADDRESS> \
  --rpc-url https://rpc-amoy.polygon.technology \
  --private-key $PRIVATE_KEY
```

## Verify on PolygonScan

After deploy, verify the contract at https://amoy.polygonscan.com/verifyContract

## Post-Deploy

1. Set `ESCROW_CONTRACT_ADDRESS` in .env
2. Set `ESCROW_ENABLED=1` to use impact-weighted flow
3. Ensure relayer has funds for gas
