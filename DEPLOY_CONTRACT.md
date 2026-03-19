# SuiBets Contract Deployment Guide

## Prerequisites
1. Install Sui CLI: `cargo install --locked --git https://github.com/MystenLabs/sui.git --branch mainnet sui`
2. Create wallet: `sui client new-address ed25519`
3. Fund wallet with SUI for gas (minimum 1 SUI)

## Contract Features

### Capability-Based Security (OTW Pattern)
The contract uses **One-Time Witness (OTW)** and **Capability objects** for secure access control:
- **AdminCap**: Single capability object minted at deployment, required for all admin operations
- **OracleCap**: Can be minted by admin and distributed to settlement oracles
- No address-based checks - only capability holders can perform privileged operations

### Dual Token Support
- **SUI betting**: Users can bet with native SUI tokens
- **SBETS betting**: Users can bet with SBETS platform tokens
- Separate treasuries and liability tracking for each token type

### Contract Functions

| Function | Description | Required Capability |
|----------|-------------|---------------------|
| **SUI Betting** | | |
| `place_bet` | Place a bet with SUI | None (any user) |
| `settle_bet` | Settle SUI bet with oracle | OracleCap |
| `settle_bet_admin` | Settle SUI bet with admin | AdminCap |
| `void_bet` | Void SUI bet with oracle | OracleCap |
| `void_bet_admin` | Void SUI bet with admin | AdminCap |
| **SBETS Betting** | | |
| `place_bet_sbets` | Place a bet with SBETS | None (any user) |
| `settle_bet_sbets` | Settle SBETS bet with oracle | OracleCap |
| `settle_bet_sbets_admin` | Settle SBETS bet with admin | AdminCap |
| `void_bet_sbets` | Void SBETS bet with oracle | OracleCap |
| `void_bet_sbets_admin` | Void SBETS bet with admin | AdminCap |
| **Revenue & Treasury** | | |
| `withdraw_fees` | Extract SUI revenue | AdminCap |
| `withdraw_fees_sbets` | Extract SBETS revenue | AdminCap |
| `deposit_liquidity` | Add SUI to treasury | AdminCap |
| `deposit_liquidity_sbets` | Add SBETS to treasury | AdminCap |
| `emergency_withdraw` | Emergency SUI withdrawal | AdminCap (paused only) |
| `emergency_withdraw_sbets` | Emergency SBETS withdrawal | AdminCap (paused only) |
| **Oracle Management** | | |
| `mint_oracle_cap` | Create OracleCap for settlement | AdminCap |
| `revoke_oracle_cap` | Burn an OracleCap | AdminCap |
| **Platform Settings** | | |
| `set_pause` | Pause/unpause platform | AdminCap |
| `update_fee` | Change platform fee | AdminCap |
| `update_limits` | Change min/max bet | AdminCap |

## Deployment Steps

### 1. Create project folder with these files:
```
suibets/
├── Move.toml
└── sources/
    └── betting.move
```

### 2. Move.toml content:
```toml
[package]
name = "suibets"
version = "2.0.0"
edition = "2024.beta"

[dependencies]
Sui = { git = "https://github.com/MystenLabs/sui.git", subdir = "crates/sui-framework/packages/sui-framework", rev = "mainnet-v1.64.2" }
sbets_token = { local = "./sbets_token" }

[addresses]
suibets = "0x0"
sbets_token = "0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502"
```

**Note:** The contract imports the existing SBETS token from mainnet at `0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502::sbets::SBETS`. The `sbets_token` folder must contain the token's Move.toml and source.

### 3. Build the contract
```bash
cd suibets
sui move build
```

### 4. Deploy to mainnet
```bash
sui client publish --gas-budget 100000000
```

### 5. Record the output
After deployment, you'll get THREE important IDs:
- **Package ID**: The new contract address
- **BettingPlatform Object ID**: The shared platform object
- **AdminCap Object ID**: The admin capability (transferred to deployer)

Example output (actual mainnet deployment March 19, 2026 - hardened oracle contract):
```
Published Objects:
- Package: 0x95432fe09ab4d17afeb874366fbb611d625bfabe3cbcae75dd07b328c5951ac7
Created Objects:
- ID: 0xfed2649741e4d3f6316434d6bdc51d0d0975167a0dc87447122d04830d59fdf9, Owner: Shared, Type: ...::betting::BettingPlatform
- ID: 0xe1e5fd1e5077a78bb3a8fd28bf096f32b0e031213974239ebee1dd80afcfae61, Owner: 0xa93e1f3064ad5ce96ad1db2b6ab18ff2237f2f4f0f0e14c93e32cd25ca174e43, Type: ...::betting::AdminCap
```

### 6. Update environment variables in Replit secrets:
```
# Current mainnet deployment (March 19, 2026 - hardened oracle contract)
BETTING_PACKAGE_ID=0x95432fe09ab4d17afeb874366fbb611d625bfabe3cbcae75dd07b328c5951ac7
BETTING_PLATFORM_ID=0xfed2649741e4d3f6316434d6bdc51d0d0975167a0dc87447122d04830d59fdf9
ADMIN_CAP_ID=0xe1e5fd1e5077a78bb3a8fd28bf096f32b0e031213974239ebee1dd80afcfae61
VITE_BETTING_PACKAGE_ID=0x95432fe09ab4d17afeb874366fbb611d625bfabe3cbcae75dd07b328c5951ac7
VITE_BETTING_PLATFORM_ID=0xfed2649741e4d3f6316434d6bdc51d0d0975167a0dc87447122d04830d59fdf9
VITE_ADMIN_CAP_ID=0xe1e5fd1e5077a78bb3a8fd28bf096f32b0e031213974239ebee1dd80afcfae61
SBETS_TOKEN_ADDRESS=0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502::sbets::SBETS
```

## Post-Deployment Setup

### 1. Set the Oracle Public Key (REQUIRED before any bets work):
Generate an Ed25519 keypair for oracle signing. The public key goes on-chain, the private key goes to ORACLE_SIGNING_KEY env var on Railway.
```bash
sui client call --package 0xNEW_PACKAGE_ID --module betting --function set_oracle_public_key \
  --args 0xADMIN_CAP_ID 0xNEW_PLATFORM_ID 0xYOUR_32_BYTE_PUBLIC_KEY --gas-budget 10000000
```

### 2. Unpause the platform (REQUIRED):
```bash
sui client call --package 0xNEW_PACKAGE_ID --module betting --function set_pause \
  --args 0xADMIN_CAP_ID 0xNEW_PLATFORM_ID false 0x6 --gas-budget 10000000
```

### 3. Deposit initial SUI liquidity:
```bash
sui client call --package 0xNEW_PACKAGE_ID --module betting --function deposit_liquidity \
  --args 0xADMIN_CAP_ID 0xNEW_PLATFORM_ID 0xYOUR_SUI_COIN_ID 0x6 --gas-budget 10000000
```

### 3. Deposit initial SBETS liquidity:
Get your SBETS coin object ID first: `sui client coins --coin-type 0x6a4d9c0eab7ac40371a7453d1aa6c89b130950e8af6868ba975fdd81371a7285::sbets::SBETS`
```bash
sui client call --package 0xNEW_PACKAGE_ID --module betting --function deposit_liquidity_sbets \
  --args 0xADMIN_CAP_ID 0xNEW_PLATFORM_ID 0xYOUR_SBETS_COIN_ID 0x6 --gas-budget 10000000
```

## Revenue Withdrawal

### Withdraw SUI fees:
```bash
sui client call --package 0xNEW_PACKAGE_ID --module betting --function withdraw_fees \
  --args 0xADMIN_CAP_ID 0xNEW_PLATFORM_ID AMOUNT_IN_MIST 0xRECIPIENT_ADDRESS 0x6 --gas-budget 10000000
```

### Withdraw SBETS fees:
```bash
sui client call --package 0xNEW_PACKAGE_ID --module betting --function withdraw_fees_sbets \
  --args 0xADMIN_CAP_ID 0xNEW_PLATFORM_ID AMOUNT_IN_MIST 0xRECIPIENT_ADDRESS 0x6 --gas-budget 10000000
```

## Security Best Practices

### AdminCap Protection
- The AdminCap is the **most critical security object**
- Store the wallet holding AdminCap securely (hardware wallet recommended)
- The ADMIN_CAP_ID environment variable is safe to store - it's just an object reference
- Only the wallet that **owns** the AdminCap can use it in transactions
- The private key (ADMIN_PRIVATE_KEY) is what authorizes transactions

### OracleCap Management
- Mint OracleCaps only for trusted settlement services
- Revoke OracleCaps immediately if a settlement service is compromised
- Each OracleCap has a unique ID that can be tracked on-chain

### Operational Security
- Use `set_pause(true)` immediately if suspicious activity detected
- Emergency withdrawal functions only work when platform is paused
- All capability operations emit events for audit trail

## Verification

### Check platform status:
```bash
sui client object 0xNEW_PLATFORM_ID
```

### Check your AdminCap:
```bash
sui client object 0xADMIN_CAP_ID
```

### View contract events:
```bash
sui client events --query '{"Package":"0xNEW_PACKAGE_ID"}'
```
