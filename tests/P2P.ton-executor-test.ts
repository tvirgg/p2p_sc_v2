import { Address, beginCell, toNano, Cell, Slice } from "@ton/core";
import { SmartContract, internal, stackInt, TvmRunnerAsynchronous, externalIn } from "ton-contract-executor";
import * as fs from 'fs';
import * as path from 'path';


// Global variables to share across tests
let globalCode: Cell | null = null;

describe("P2P Contract Executor", () => {
    let data: Cell;
    
    // Addresses for testing
    const MODERATOR = Address.parse("0:3333000033330000333300003333000033330000333300003333000033330000");
    const SELLER = Address.parse("0:1111000011110000111100001111000011110000111100001111000011110000");
    const BUYER = Address.parse("0:2222000022220000222200002222000022220000222200002222000022220000");

    // Contract address for messages
    const CONTRACT_ADDRESS = Address.parse("0:0000000000000000000000000000000000000000000000000000000000000000");
    
    // Helper function to create a contract instance
    async function createContract(): Promise<SmartContract> {
        // Create initial data cell
        data = beginCell()
            .storeUint(0, 32) // deals_counter
            .storeDict(null) // deals_dict
            .storeDict(null) // memo_map
            .storeDict(null) // unknown_funds
            .storeAddress(MODERATOR)
            .storeUint(0, 32) // commissions_pool
            .endCell();

        console.log("Creating contract instance with code and data");
        
        try {
            if (!globalCode) {
                throw new Error("Code cell is undefined. Make sure the contract was loaded correctly.");
            }
            
            console.log("Code cell is defined:", globalCode !== undefined);
            console.log("Code cell type:", typeof globalCode);
            
            // Create contract instance with debug enabled
            return await SmartContract.fromCell(globalCode, data, {
                debug: true // Enable debug mode
            });
        } catch (error) {
            console.error("Error creating contract:", error);
            throw error;
        }
    }

    // Helper function to create a deal
    async function createDeal(
        contract: SmartContract,
        seller: Address,
        buyer: Address,
        amount: bigint,
        memo: string
    ) {
        const memoCell = beginCell().storeStringTail(memo).endCell();

        const msgBody = beginCell()
            .storeUint(1, 32) // op_create_deal
            .storeUint(0, 64) // query_id
            .storeAddress(seller)
            .storeAddress(buyer)
            .storeCoins(amount)
            .storeRef(memoCell)
            .endCell();

        // Create internal message using the utility function
        const msg = internal({
            src: MODERATOR,
            dest: CONTRACT_ADDRESS,
            value: toNano("0.05"),
            bounce: true,
            body: msgBody
        });
        console.log("msgBody instanceof Cell:", msgBody instanceof Cell);
        console.log("msgBody type:", typeof msgBody);
        const result = await contract.sendInternalMessage(msg);
        
        // Log the full result object for diagnostic purposes
        try {
            const resultStr = JSON.stringify(result, (key, value) => 
                typeof value === 'bigint' ? value.toString() : value
            , 2);
            process.stdout.write(`\n===== CREATE DEAL FULL RESULT =====\n${resultStr}\n===== END RESULT =====\n`);
            
            // Always log VM logs regardless of result type
            process.stdout.write(`\n===== VM LOGS =====\n${result.logs || 'No logs available'}\n===== END VM LOGS =====\n`);
            
            // Analyze debug logs specially
            if (result.debugLogs && result.debugLogs.length > 0) {
                process.stdout.write(`\n===== DEBUG LOGS =====\n`);
                for (const log of result.debugLogs) {
                    process.stdout.write(`${log}\n`);
                }
                process.stdout.write(`===== END DEBUG LOGS =====\n`);
            } else {
                process.stdout.write(`\n===== NO DEBUG LOGS FOUND =====\n`);
            }
        } catch (e: any) {
            process.stdout.write(`\nError stringifying result: ${e.message || 'Unknown error'}\nResult type: ${result.type}, exit_code: ${result.exit_code}\n`);
        }
        
        return result;
    }

    // Helper function to fund a deal
    async function fundDeal(
        contract: SmartContract,
        memo: string,
        value: bigint
    ) {
        const memoCell = beginCell().storeStringTail(memo).endCell();
    
        const msgBody = beginCell()
            .storeUint(5, 32)     // op_fund_deal
            .storeUint(0, 64)     // query_id — обязательно, чтобы не съехало
            .storeRef(memoCell)   // memo как ссылка
            .endCell();
    
        const msg = internal({
            src: BUYER,
            dest: CONTRACT_ADDRESS,
            value: value,
            bounce: true,
            body: msgBody
        });
    
        const result = await contract.sendInternalMessage(msg);
    
        // Логируй, если нужно
        if (result.debugLogs && result.debugLogs.length > 0) {
            console.log(`\n===== DEBUG LOGS: fundDeal =====`);
            for (const log of result.debugLogs) {
                process.stdout.write(`${log}\n`);
            }
            console.log(`===== END DEBUG LOGS =====`);
        }
    
        return result;
    }

    // Helper function to get deal info
    async function getDealInfo(contract: SmartContract, dealId: number) {
        const result = await contract.invokeGetMethod("get_deal_info", [
            stackInt(dealId)
        ]);
        
        if (result.type !== "success") {
            throw new Error(`Failed to get deal info: ${result.exit_code}`);
        }
        
        if (result.debugLogs && result.debugLogs.length > 0) {
            console.log(`\n===== DEBUG LOGS: get_deal_info(${dealId}) =====`);
            for (const log of result.debugLogs) {
                console.log(log);
            }
            console.log(`===== END DEBUG LOGS =====\n`);
        } else {
            console.log(`\n===== NO DEBUG LOGS FOUND: get_deal_info(${dealId}) =====\n`);
        }

        const amount = BigInt(result.result[0] as any);
        const funded = Number(result.result[1] as any);
        
        return { amount, funded };
    }

    // Helper function to get deal counter
    async function getDealCounter(contract: SmartContract) {
        const result = await contract.invokeGetMethod("get_deal_counter", []);
        
        if (result.type !== "success") {
            throw new Error(`Failed to get deal counter: ${result.exit_code}`);
        }
        
        return Number(result.result[0] as unknown as any);
    }

    // Helper function to get full deal info
    async function getFullDealInfo(contract: SmartContract, dealId: number) {
        const result = await contract.invokeGetMethod("debug_get_deal", [
            stackInt(dealId)
        ]);
        
        if (result.type !== "success") {
            throw new Error(`Failed to get full deal info: ${result.exit_code}`);
        }
        
        // Convert slices to proper Address objects
        const sellerSlice = result.result[0] as unknown as Slice;
        const buyerSlice = result.result[1] as unknown as Slice;
        
        // Clone the slice to avoid modifying the original
        const sellerSliceClone = sellerSlice.clone();
        const buyerSliceClone = buyerSlice.clone();
        
        // Parse addresses from slices
        const seller = sellerSliceClone.loadAddress();
        const buyer = buyerSliceClone.loadAddress();
        
        const amount = BigInt(result.result[2] as unknown as any);
        const funded = Number(result.result[3] as unknown as any);
        
        return { seller, buyer, amount, funded };
    }

    beforeAll(async () => {
        try {
            // Load the compiled contract from the JSON file
            const compiledPath = path.resolve(__dirname, '../build/P2P.compiled.json');
            console.log("Loading compiled contract from:", compiledPath);
            
            const compiledJson = JSON.parse(fs.readFileSync(compiledPath, 'utf8'));
            console.log("Compiled JSON loaded, hex length:", compiledJson.hex.length);
            
            // Convert hex to Cell
            const cells = Cell.fromBoc(Buffer.from(compiledJson.hex, 'hex'));
            console.log("Cells created from BOC:", cells.length);
            
            globalCode = cells[0];
            console.log("Code cell assigned:", globalCode !== undefined);
            console.log("🚀 Contract loaded from compiled file");
        } catch (error) {
            console.error("Error loading compiled contract:", error);
            throw error;
        }
    });

    afterAll(async () => {
        // Clean up worker threads
        await TvmRunnerAsynchronous.getShared().cleanup();
    });

    // Run tests sequentially
    test("should create a deal", async () => {
        // Create a new contract instance for this test
        const testContract = await createContract();
        
        const dealAmount = toNano("2");
        const memoText = "1236";

        // Create a deal
        const createResult = await createDeal(
            testContract,
            SELLER,
            BUYER,
            dealAmount,
            memoText
        );
        
        expect(createResult.exit_code).toBe(0);
        
        // Get deal counter
        const dealCounter = await getDealCounter(testContract);
        console.log("deal count: "+dealCounter)
        // Get deal info
        const dealInfo = await getDealInfo(testContract, 0);
        console.log("deal info:", {
            amount: dealInfo.amount.toString(),
            funded: dealInfo.funded
        });
        // Verify deal was created correctly
        expect(dealCounter).toBe(1);
        expect(dealInfo.amount.toString()).toBe(dealAmount.toString());
        expect(dealInfo.funded).toBe(0);
        
        // Get full deal info
        const fullDealInfo = await getFullDealInfo(testContract, 0);
        
        // Verify full deal info
        expect(fullDealInfo.seller.toString()).toBe(SELLER.toString());
        expect(fullDealInfo.buyer.toString()).toBe(BUYER.toString());
        expect(fullDealInfo.amount.toString()).toBe(dealAmount.toString());
        expect(fullDealInfo.funded).toBe(0);
    });
    test("should create and fund a deal", async () => {
        // Create a new contract instance for this test
        const testContract = await createContract();
        
        const dealAmount = toNano("2");
        const memoText = "DEAL:1";

        // Create a deal
        const createResult = await createDeal(
            testContract,
            SELLER,
            BUYER,
            dealAmount,
            memoText
        );
        
        expect(createResult.exit_code).toBe(0);
        
        // Get deal counter after creation
        const dealCounterAfterCreate = await getDealCounter(testContract);
        expect(dealCounterAfterCreate).toBe(1);
        
        // Get deal info before funding
        const dealInfoBeforeFunding = await getDealInfo(testContract, 0);
        expect(dealInfoBeforeFunding.amount.toString()).toBe(dealAmount.toString());
        expect(dealInfoBeforeFunding.funded).toBe(0);
        
        // Fund the deal
        const fundResult = await fundDeal(
            testContract,
            memoText,
            toNano("2.1") // slightly more to cover commission
        );
        
        expect(fundResult.exit_code).toBe(0);
        
        // Get deal info after funding
        const dealInfoAfterFunding = await getDealInfo(testContract, 0);
        
        // Verify deal was funded correctly
        expect(dealInfoAfterFunding.amount.toString()).toBe(dealAmount.toString());
        expect(dealInfoAfterFunding.funded).toBe(1);
        
        // Get full deal info after funding
        const fullDealInfoAfterFunding = await getFullDealInfo(testContract, 0);
        
        // Verify full deal info after funding
        expect(fullDealInfoAfterFunding.seller.equals(SELLER)).toBe(true);
        expect(fullDealInfoAfterFunding.buyer.equals(BUYER)).toBe(true);
        expect(fullDealInfoAfterFunding.amount.toString()).toBe(dealAmount.toString());
        expect(fullDealInfoAfterFunding.funded).toBe(1);
    });
    function getBalance(contract: SmartContract, address: Address): bigint {
        try {
            // Access the executor directly from the contract instance
            const executor = (contract as any).executor;
            
            if (!executor) {
                console.error("Executor not found on contract instance");
                return 0n;
            }
            
            // Debug logging
            console.log("Executor type:", typeof executor);
            console.log("Executor methods:", Object.keys(executor));
            
            // Try to get account
            const account = executor.getAccount?.(address);
            
            if (!account) {
                console.error("Account not found for address:", address.toString());
                return 0n;
            }
            
            console.log("Account properties:", Object.keys(account));
            console.log("Account balance:", account.balance?.toString() || "undefined");
            
            return account.balance ?? 0n;
        } catch (error) {
            console.error("Error getting balance:", error);
            return 0n;
        }
    }
    test("should resolve deal in favor of seller", async () => {
        const contract = await createContract();
        const dealAmount = toNano("2");
        const memoText = "deal-to-seller";
    
        await createDeal(contract, SELLER, BUYER, dealAmount, memoText);
        await fundDeal(contract, memoText, toNano("2.1"));
    
        const sellerBefore = getBalance(contract, SELLER);
        process.stdout.write(`Seller balance before: ${sellerBefore.toString()}\n`);
        const memoCell = beginCell().storeStringTail(memoText).endCell();
        const externalBody = beginCell()
            .storeUint(2, 32) // op_resolve_deal
            .storeAddress(MODERATOR)
            .storeRef(memoCell)
            .storeUint(1, 1) // in favor of seller
            .endCell();
    
        const msg = externalIn({
            dest: CONTRACT_ADDRESS,
            body: externalBody
        });
        const result = await contract.sendExternalMessage(msg);
        if (result.debugLogs && result.debugLogs.length > 0) {
            console.log(`\n===== DEBUG LOGS: external =====`);
            for (const log of result.debugLogs) {
                process.stdout.write(`${log}\n`);
            }
            console.log(`===== END DEBUG LOGS =====`);
        }
        expect(result.exit_code).toBe(0);
    
        const sellerAfter = getBalance(contract, SELLER);
        const received = sellerAfter - sellerBefore;
    
        
        process.stdout.write(`Seller balance after: ${sellerAfter.toString()}\n`);
        process.stdout.write(`Amount received: ${received.toString()}\n`);
        expect(received >= dealAmount).toBe(true);
    });
});
