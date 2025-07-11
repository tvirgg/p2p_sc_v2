# P2P Smart Contract API

This API provides HTTP endpoints to interact with the P2P smart contract on the TON blockchain. It allows you to create deals, fund them, and resolve them through simple HTTP requests.

## Quick Start

### Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- A TON wallet with some test TON (for testnet)
- TON API key from https://toncenter.com/

### Setup

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd p2p_sc_v2
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure your environment:
   Create a `.env` file in the root directory with the following content:
   ```
   WALLET_MNEMONIC="your wallet mnemonic phrase"
   MNEMONIC="your wallet mnemonic phrase"
   RPC_ENDPOINT="https://testnet.toncenter.com/api/v2/jsonRPC"
   RPC_KEY="your RPC API key"
   CONTRACT_ADDR="your deployed contract address"
   WORKCHAIN="0"
   PORT=3000
   ```

4. Build the project:
   ```bash
   npm run build
   ```

5. Start the API server:
   ```bash
   node dist/src/server.js
   ```

The API server will start and listen on port 3000 (or the port specified in your `.env` file).

## API Usage

### Creating a Deal

```bash
curl -X POST http://localhost:3000/deal \
  -H "Content-Type: application/json" \
  -d '{
    "seller": "0:3815535e02b7fb7f06f84fce6ec68f5a3a9b6428d261d899cc875c0cd77e6182",
    "buyer": "0:61f48c6226232ad3d5da8fcb96a29a1175dad31996b55fee7e701a6b626e3bb0",
    "amount": "1000000000",
    "memo": "Payment for services"
  }'
```

### Funding a Deal

```bash
curl -X POST http://localhost:3000/fund \
  -H "Content-Type: application/json" \
  -d '{
    "memo": "Payment for services",
    "value": "1000000000"
  }'
```

### Resolving a Deal

```bash
curl -X POST http://localhost:3000/resolve \
  -H "Content-Type: application/json" \
  -d '{
    "memo": "Payment for services",
    "verdict": true
  }'
```

### Getting Deal Information

```bash
curl http://localhost:3000/deal/0
```

### Getting Deal Counter

```bash
curl http://localhost:3000/deal-counter
```

## Running the Example Script

We've provided an example script that demonstrates the complete flow of creating, funding, and resolving a deal:

```bash
# Install axios if you haven't already
npm install axios

# Run the example script
node examples/api_usage_example.js
```

## Documentation

For detailed documentation of all API endpoints and the smart contract functionality, see [API_DOCUMENTATION.md](./API_DOCUMENTATION.md).

## Smart Contract Operations

The P2P smart contract supports the following operations:

1. **Create Deal**: Creates a new deal between a seller and a buyer.
2. **Fund Deal**: Funds an existing deal.
3. **Resolve Deal**: Resolves a deal, either approving payment to the seller or refunding the buyer.
4. **Refund Unknown**: Refunds unknown funds that were sent to the contract.
5. **Withdraw Commissions**: Withdraws accumulated commissions to the moderator's wallet.

The contract charges a commission of 3% on all transactions.
