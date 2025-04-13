import { Address, beginCell, toNano, Cell } from "@ton/core";
import { SmartContract, internal, stackInt, TvmRunnerAsynchronous } from "ton-contract-executor";
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
            .storeUint(5, 32) // op_fund_deal
            .storeUint(0, 64) // query_id
            .storeRef(memoCell)
            .endCell();

        // Create internal message using the utility function
        const msg = internal({
            src: BUYER,
            dest: CONTRACT_ADDRESS,
            value: value,
            bounce: true,
            body: msgBody as any
        });

        // Return the result without attempting to access potentially problematic properties
        return await contract.sendInternalMessage(msg);
    }

    // Helper function to get deal info
    async function getDealInfo(contract: SmartContract, dealId: number) {
        const result = await contract.invokeGetMethod("get_deal_info", [
            stackInt(dealId)
        ]);
        
        if (result.type !== "success") {
            throw new Error(`Failed to get deal info: ${result.exit_code}`);
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
        
        // Note: In a real implementation, we would need to properly convert the result to Address objects
        // For simplicity, we'll just use the raw values for testing
        const seller = result.result[0] as unknown as Address;
        const buyer = result.result[1] as unknown as Address;
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
        
        // Verify deal was created correctly
        expect(dealCounter).toBe(1);
        expect(dealInfo.amount.toString()).toBe(dealAmount.toString());
        expect(dealInfo.funded).toBe(0);
        
        // Get full deal info
        const fullDealInfo = await getFullDealInfo(testContract, 0);
        
        // Verify full deal info
        expect(fullDealInfo.seller.equals(SELLER)).toBe(true);
        expect(fullDealInfo.buyer.equals(BUYER)).toBe(true);
        expect(fullDealInfo.amount.toString()).toBe(dealAmount.toString());
        expect(fullDealInfo.funded).toBe(0);
    });
});
