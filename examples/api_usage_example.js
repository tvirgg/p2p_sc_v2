/**
 * P2P Smart Contract API Usage Example
 * 
 * This script demonstrates how to use the P2P Smart Contract API
 * to create, fund, and resolve deals.
 */

const axios = require('axios');

// API base URL
const API_BASE_URL = 'http://localhost:3000';

// Example wallet addresses (replace with your own)
const SELLER_ADDRESS = '0:3815535e02b7fb7f06f84fce6ec68f5a3a9b6428d261d899cc875c0cd77e6182';
const BUYER_ADDRESS = '0:61f48c6226232ad3d5da8fcb96a29a1175dad31996b55fee7e701a6b626e3bb0';

// Example deal parameters
const DEAL_AMOUNT = '1000000000'; // 1 TON in nanoTON
const DEAL_MEMO = 'Payment for services ' + Date.now(); // Adding timestamp to make memo unique

/**
 * Helper function to make API requests
 */
async function makeRequest(method, endpoint, data = null) {
  try {
    const url = `${API_BASE_URL}${endpoint}`;
    const config = {
      method,
      url,
      headers: {
        'Content-Type': 'application/json'
      },
      data
    };
    
    console.log(`Making ${method} request to ${url}`);
    if (data) {
      console.log('Request data:', JSON.stringify(data, null, 2));
    }
    
    const response = await axios(config);
    console.log('Response:', JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (error) {
    console.error('Error:', error.response ? error.response.data : error.message);
    throw error;
  }
}

/**
 * Get the current deal counter
 */
async function getDealCounter() {
  return makeRequest('get', '/deal-counter');
}

/**
 * Get deal information by ID
 */
async function getDealInfo(dealId) {
  return makeRequest('get', `/deal/${dealId}`);
}

/**
 * Get moderator address
 */
async function getModeratorAddress() {
  return makeRequest('get', '/moderator');
}

/**
 * Create a new deal
 */
async function createDeal(seller, buyer, amount, memo) {
  return makeRequest('post', '/deal', {
    seller,
    buyer,
    amount,
    memo
  });
}

/**
 * Fund a deal
 */
async function fundDeal(memo, value) {
  return makeRequest('post', '/fund', {
    memo,
    value
  });
}

/**
 * Resolve a deal
 */
async function resolveDeal(memo, verdict) {
  return makeRequest('post', '/resolve', {
    memo,
    verdict
  });
}

/**
 * Refund unknown funds
 */
async function refundUnknown(key) {
  return makeRequest('post', '/refund-unknown', {
    key
  });
}

/**
 * Withdraw commissions
 */
async function withdrawCommissions() {
  return makeRequest('post', '/withdraw', {});
}

/**
 * Main function to demonstrate the complete flow
 */
async function demonstrateCompleteFlow() {
  try {
    console.log('=== P2P Smart Contract API Usage Example ===');
    
    // 1. Get moderator address
    console.log('\n1. Getting moderator address...');
    await getModeratorAddress();
    
    // 2. Get initial deal counter
    console.log('\n2. Getting initial deal counter...');
    const initialCounterResponse = await getDealCounter();
    const initialCounter = initialCounterResponse.counter;
    console.log(`Initial deal counter: ${initialCounter}`);
    
    // 3. Create a new deal
    console.log('\n3. Creating a new deal...');
    await createDeal(SELLER_ADDRESS, BUYER_ADDRESS, DEAL_AMOUNT, DEAL_MEMO);
    
    // 4. Get updated deal counter
    console.log('\n4. Getting updated deal counter...');
    const updatedCounterResponse = await getDealCounter();
    const updatedCounter = updatedCounterResponse.counter;
    console.log(`Updated deal counter: ${updatedCounter}`);
    
    // Calculate the deal ID (it should be the previous counter value)
    const dealId = Number(initialCounter);
    console.log(`New deal ID: ${dealId}`);
    
    // 5. Get deal information
    console.log(`\n5. Getting information for deal ${dealId}...`);
    const dealInfo = await getDealInfo(dealId);
    console.log(`Deal amount: ${dealInfo.amount}, Funded: ${dealInfo.isFunded}`);
    
    // 6. Fund the deal
    console.log('\n6. Funding the deal...');
    await fundDeal(DEAL_MEMO, DEAL_AMOUNT);
    
    // 7. Check if the deal is funded
    console.log(`\n7. Checking if deal ${dealId} is funded...`);
    const updatedDealInfo = await getDealInfo(dealId);
    console.log(`Deal amount: ${updatedDealInfo.amount}, Funded: ${updatedDealInfo.isFunded}`);
    
    // 8. Resolve the deal (approve payment to seller)
    console.log('\n8. Resolving the deal (approving payment to seller)...');
    await resolveDeal(DEAL_MEMO, true);
    
    console.log('\n=== Complete flow demonstration finished ===');
  } catch (error) {
    console.error('Error during demonstration:', error.message);
  }
}

// Run the demonstration
demonstrateCompleteFlow();
