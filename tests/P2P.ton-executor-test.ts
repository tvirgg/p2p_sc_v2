import { Address, beginCell, toNano, Cell } from "@ton/core";
import { compile } from "@ton-community/blueprint";
import { SmartContract, internal, stackInt, TvmRunnerAsynchronous } from "ton-contract-executor";

describe("P2P Contract Executor", () => {
    let code: Cell;
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
            // Create contract instance
            return await SmartContract.fromCell(code as unknown as any, data as unknown as any);
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
            body: msgBody as unknown as any
        });

        return await contract.sendInternalMessage(msg);
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
            body: msgBody as unknown as any
        });

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
        
        const amount = BigInt(result.result[0] as unknown as any);
        const funded = Number(result.result[1] as unknown as any);
        
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
            // Compile the contract once for all tests
            const compiledCode = await compile("P2P");
            code = compiledCode as unknown as Cell;
            console.log("🚀 Contract compiled");
        } catch (error) {
            console.error("Error compiling contract:", error);
            throw error;
        }
    });

    afterAll(async () => {
        // Clean up worker threads
        await TvmRunnerAsynchronous.getShared().cleanup();
    });

    // Run tests in parallel
    test.concurrent("should create a deal", async () => {
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

    test.concurrent("should create and fund a deal", async () => {
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

    test.concurrent("should handle multiple deals in parallel", async () => {
        // Create a new contract instance for this test
        const testContract = await createContract();
        
        // Create multiple deals with different memo texts
        const dealAmount = toNano("2");
        const memoTexts = ["DEAL:A", "DEAL:B", "DEAL:C"];
        
        // Create deals in parallel
        await Promise.all(memoTexts.map(async (memo, index) => {
            const createResult = await createDeal(
                testContract,
                SELLER,
                BUYER,
                dealAmount,
                memo
            );
            
            expect(createResult.exit_code).toBe(0);
            
            // Fund the deal
            if (index % 2 === 0) { // Fund every other deal
                const fundResult = await fundDeal(
                    testContract,
                    memo,
                    toNano("2.1") // slightly more to cover commission
                );
                
                expect(fundResult.exit_code).toBe(0);
            }
        }));
        
        // Get deal counter
        const dealCounter = await getDealCounter(testContract);
        expect(dealCounter).toBe(memoTexts.length);
        
        // Verify each deal
        for (let i = 0; i < memoTexts.length; i++) {
            const dealInfo = await getDealInfo(testContract, i);
            expect(dealInfo.amount.toString()).toBe(dealAmount.toString());
            expect(dealInfo.funded).toBe(i % 2 === 0 ? 1 : 0); // Every other deal should be funded
        }
    });
});
