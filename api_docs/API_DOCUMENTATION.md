# P2P Smart Contract API Documentation

This documentation describes how to set up and use the HTTP API for interacting with the P2P smart contract on the TON blockchain.

## Table of Contents

1. [Overview](#overview)
2. [Environment Setup](#environment-setup)
3. [Starting the API Server](#starting-the-api-server)
4. [API Endpoints](#api-endpoints)
   - [GET Endpoints](#get-endpoints)
   - [POST Endpoints](#post-endpoints)
5. [Usage Examples](#usage-examples)

## Overview

The P2P smart contract is designed to facilitate peer-to-peer transactions on the TON blockchain. It allows for creating deals between a seller and a buyer, funding those deals, and resolving them (either approving payment to the seller or refunding the buyer).

The HTTP API provides a convenient way to interact with this smart contract without having to directly construct TON blockchain messages.

## Environment Setup

Before starting the API server, you need to set up your environment variables in a `.env` file:

```
# Wallet mnemonic for the moderator wallet
WALLET_MNEMONIC="your wallet mnemonic phrase"

# Buyer wallet information (optional, for testing)
BUYER_ADDR="buyer wallet address"
BUYER_PUBLIC_KEY="buyer public key"
BUYER_SECRET_KEY="buyer secret key"

# Seller wallet information (optional, for testing)
SELLER_ADDR="seller wallet address"
SELLER_PUBLIC_KEY="seller public key"
SELLER_SECRET_KEY="seller secret key"

# TON RPC endpoint
RPC_ENDPOINT="https://testnet.toncenter.com/api/v2/jsonRPC"
RPC_KEY="your RPC API key"

# Moderator wallet mnemonic (same as WALLET_MNEMONIC)
MNEMONIC="your wallet mnemonic phrase"

# P2P contract address
CONTRACT_ADDR="your deployed contract address"

# Workchain ID (usually 0)
WORKCHAIN="0"

# API server port
PORT=3000
```

## Starting the API Server

To start the API server, run:

```bash
npm install       # Install dependencies (first time only)
npm run build     # Build TypeScript files
node dist/src/server.js
```

The server will start and listen on the port specified in your `.env` file (default: 3000).

## API Endpoints

### GET Endpoints

#### Get Deal Information

```
GET /deal/:id
```

Retrieves information about a specific deal by its ID.

**Parameters:**
- `id`: The deal ID (path parameter)

**Response:**
```json
{
  "amount": "1000000000",
  "isFunded": true
}
```

#### Get Deal Counter

```
GET /deal-counter
```

Retrieves the current deal counter (total number of deals created).

**Response:**
```json
{
  "counter": "5"
}
```

#### Get Moderator Address

```
GET /moderator
```

Retrieves the address of the moderator.

**Response:**
```json
{
  "moderator": "0:61f48c6226232ad3d5da8fcb96a29a1175dad31996b55fee7e701a6b626e3bb0"
}
```

### POST Endpoints

#### Create Deal

```
POST /deal
```

Creates a new deal between a seller and a buyer.

**Request Body:**
```json
{
  "seller": "0:3815535e02b7fb7f06f84fce6ec68f5a3a9b6428d261d899cc875c0cd77e6182",
  "buyer": "0:61f48c6226232ad3d5da8fcb96a29a1175dad31996b55fee7e701a6b626e3bb0",
  "amount": "1000000000",
  "memo": "Payment for services"
}
```

**Response:**
```json
{
  "ok": true
}
```

#### Fund Deal

```
POST /fund
```

Funds an existing deal. The memo must match the one used when creating the deal.

**Request Body:**
```json
{
  "memo": "Payment for services",
  "value": "1000000000"
}
```

**Response:**
```json
{
  "ok": true
}
```

#### Resolve Deal

```
POST /resolve
```

Resolves a deal, either approving payment to the seller or refunding the buyer.

**Request Body:**
```json
{
  "memo": "Payment for services",
  "verdict": true
}
```

Note: `verdict` is a boolean where `true` means approve payment to the seller, and `false` means refund the buyer.

**Response:**
```json
{
  "ok": true
}
```

#### Refund Unknown Funds

```
POST /refund-unknown
```

Refunds unknown funds that were sent to the contract.

**Request Body:**
```json
{
  "key": "1"
}
```

**Response:**
```json
{
  "ok": true
}
```

#### Withdraw Commissions

```
POST /withdraw
```

Withdraws accumulated commissions to the moderator's wallet.

**Request Body:**
```json
{}
```

**Response:**
```json
{
  "ok": true
}
```

## Usage Examples

### Complete P2P Transaction Flow

1. **Create a deal**

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

2. **Check the deal counter to confirm creation**

```bash
curl http://localhost:3000/deal-counter
```

3. **Fund the deal**

```bash
curl -X POST http://localhost:3000/fund \
  -H "Content-Type: application/json" \
  -d '{
    "memo": "Payment for services",
    "value": "1000000000"
  }'
```

4. **Check if the deal is funded**

```bash
curl http://localhost:3000/deal/0
```

5. **Resolve the deal (approve payment to seller)**

```bash
curl -X POST http://localhost:3000/resolve \
  -H "Content-Type: application/json" \
  -d '{
    "memo": "Payment for services",
    "verdict": true
  }'
```

### Error Handling

All endpoints return a 500 status code with an error message in case of failure:

```json
{
  "error": "Error message"
}
```

## Smart Contract Details

The P2P smart contract has the following operations:

1. **Create Deal (op = 1)**: Creates a new deal between a seller and a buyer.
2. **Resolve Deal (op = 2)**: Resolves a deal, either approving payment to the seller or refunding the buyer.
3. **Refund Unknown (op = 3)**: Refunds unknown funds that were sent to the contract.
4. **Withdraw Commissions (op = 4)**: Withdraws accumulated commissions to the moderator's wallet.
5. **Fund Deal (op = 5)**: Funds an existing deal.

The contract charges a commission of 3% on all transactions.
