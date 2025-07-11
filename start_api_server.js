/**
 * P2P Smart Contract API Server Starter
 * 
 * This script starts the API server with proper error handling and logging.
 * It checks for required environment variables and provides helpful error messages.
 */

require('dotenv').config();
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Check if the server.js file exists in the dist directory
const serverPath = path.join(__dirname, 'dist', 'src', 'server.js');
if (!fs.existsSync(serverPath)) {
  console.error('\x1b[31mError: Server file not found at ' + serverPath);
  console.log('\x1b[33mMake sure you have built the project with "npm run build" first.\x1b[0m');
  process.exit(1);
}

// Check for required environment variables
const requiredEnvVars = [
  'WALLET_MNEMONIC',
  'MNEMONIC',
  'RPC_ENDPOINT',
  'RPC_KEY',
  'CONTRACT_ADDR',
];

const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  console.error('\x1b[31mError: Missing required environment variables:');
  missingEnvVars.forEach(varName => {
    console.error(`  - ${varName}`);
  });
  console.log('\x1b[33mPlease check your .env file and make sure all required variables are set.\x1b[0m');
  process.exit(1);
}

// Start the server
console.log('\x1b[36m=== Starting P2P Smart Contract API Server ===\x1b[0m');
console.log('\x1b[36mPress Ctrl+C to stop the server\x1b[0m');

const port = process.env.PORT || 3000;
console.log(`\x1b[36mServer will listen on port ${port}\x1b[0m`);

const server = spawn('node', [serverPath], { stdio: 'inherit' });

server.on('error', (err) => {
  console.error('\x1b[31mFailed to start server:', err.message, '\x1b[0m');
  process.exit(1);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\x1b[36mShutting down server...\x1b[0m');
  server.kill('SIGINT');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\x1b[36mShutting down server...\x1b[0m');
  server.kill('SIGTERM');
  process.exit(0);
});
