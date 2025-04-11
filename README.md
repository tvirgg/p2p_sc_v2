# P2P Escrow Smart Contract

A secure peer-to-peer escrow system built on TON blockchain for facilitating transactions between buyers and sellers with moderator oversight.

## Overview

This smart contract implements a P2P escrow system that allows:

- Creating deals between buyers and sellers
- Funding deals with TON coins
- Resolving deals (paying the seller or refunding the buyer)
- Handling unknown funds
- Collecting and withdrawing commissions

The contract uses a memo system to uniquely identify deals and requires a moderator for certain operations.

## Contract Structure

### State Variables

The contract stores the following data:

- `deals_counter`: Counter for generating unique deal IDs
- `deals_dict`: Dictionary storing deal data (seller, buyer, amount, funded status)
- `memo_map`: Dictionary mapping memo hashes to deal IDs
- `unknown_funds`: Dictionary storing funds sent without proper identification
- `moderator_address`: Address of the moderator who can perform administrative operations
- `commissions_pool`: Accumulated commissions from transactions

### Commission Rates

- With memo: 3%
- Without memo (unknown funds): 3%

## Operations

### 1. Create Deal (`op_create_deal = 1`)

Creates a new escrow deal between a buyer and seller.

**Parameters:**
- `seller`: Address of the seller
- `buyer`: Address of the buyer
- `amount`: Amount of TON coins for the deal
- `memo`: Unique identifier for the deal (stored as a cell)

### 2. Fund Deal (`op_fund_deal = 5`)

Funds an existing deal by the buyer.

**Parameters:**
- `memo`: Identifier of the deal to fund
- `value`: Amount sent (must cover deal amount + commission)

### 3. Resolve Deal (`op_resolve_deal = 2`)

Resolves a deal by either paying the seller or refunding the buyer.

**Parameters:**
- `memo`: Identifier of the deal
- `decision`: 1 to pay seller, 0 to refund buyer

### 4. Refund Unknown (`op_refund_unknown = 3`)

Refunds funds that were sent without proper identification.

**Parameters:**
- `key`: Unique key for the unknown funds entry

### 5. Withdraw Commissions (`op_withdraw_commissions = 4`)

Allows the moderator to withdraw accumulated commissions.

**Parameters:**
- `amount`: Amount of TON coins to withdraw

## Get Methods

### `get_deal_info(deal_id)`

Returns information about a specific deal.

**Returns:**
- `amount`: Deal amount
- `is_funded`: Funding status (0 = not funded, 1 = funded)

### `get_deal_counter()`

Returns the current deal counter value.

## Testing the Contract

### Prerequisites

- Node.js and npm installed
- TON development environment set up

### Installation

1. Clone the repository
2. Install dependencies:

```bash
npm install
```

### Running Tests

The contract includes a test suite that verifies its functionality:

```bash
npm test
```

This will run the Jest test suite that:
1. Deploys the contract to a sandbox environment
2. Creates a deal between a seller and buyer
3. Funds the deal
4. Verifies the deal state

### Test Example

The test file (`tests/P2P.test.ts`) demonstrates how to:

1. Set up a sandbox blockchain environment
2. Deploy the P2P contract
3. Create a deal with a memo
4. Fund the deal
5. Verify the deal's state

```typescript
// Example test snippet
it("should create and fund a deal", async () => {
    const dealAmount = toNano("1");
    const memoText = "DEAL:1";

    // Create deal
    await contract.sendCreateDeal(
        moderatorWallet,
        MODERATOR,
        SELLER,
        BUYER,
        dealAmount,
        memoText
    );

    // Fund deal
    await contract.sendFundDeal(
        buyerWallet,
        memoText,
        toNano("1.05") // Amount + commission
    );

    // Verify deal state
    const dealInfo = await contract.getDealInfo(0);
    expect(dealInfo.amount.toString()).toBe(dealAmount.toString());
    expect(dealInfo.funded).toBe(1);
});
```

## Manual Testing

You can manually test the contract using the following steps:

### 1. Deploy the Contract

```bash
npm run bp deploy
```

### 2. Create a Deal

```typescript
// Using the wrapper
const p2p = P2P.createFromAddress(contractAddress);
await p2p.sendCreateDeal(
    wallet, // Moderator wallet
    moderatorAddress,
    sellerAddress,
    buyerAddress,
    toNano("1"), // 1 TON
    "DEAL:123" // Memo
);
```

### 3. Fund a Deal

```typescript
await p2p.sendFundDeal(
    buyerWallet,
    "DEAL:123", // Same memo as when creating
    toNano("1.05") // Amount + commission
);
```

### 4. Resolve a Deal

```typescript
// Pay to seller
await p2p.sendResolveDeal(
    moderatorWallet,
    moderatorAddress,
    "DEAL:123",
    true // true = pay seller, false = refund buyer
);
```

### 5. Check Deal Status

```typescript
const dealCounter = await p2p.getDealCounter();
console.log("Total deals:", dealCounter);

const dealInfo = await p2p.getDealInfo(0);
console.log("Deal amount:", dealInfo.amount);
console.log("Deal funded:", dealInfo.funded);
```

## Complete Flow Example

Here's a complete example of how to use the contract for a P2P transaction:

1. Moderator creates a deal with a unique memo
2. Buyer funds the deal (sends TON + commission)
3. Once goods/services are delivered, moderator resolves the deal:
   - If successful, funds go to the seller
   - If unsuccessful, funds are returned to the buyer

## Security Considerations

- The contract uses memo hashes to identify deals, ensuring uniqueness
- Funds are only released with moderator approval
- The contract includes checks to prevent duplicate memos
- Funding requires the exact amount plus commission

## Development

### Building the Contract

```bash
npm run build
```

### Deploying to Testnet

Update the `.env` file with your mnemonic and then run:

```bash
npm run bp deploy --network testnet
```

## License

[MIT License](LICENSE)
