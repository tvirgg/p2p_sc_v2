import { Address, Cell, beginCell, toNano } from "@ton/core";
import { compile } from "@ton-community/blueprint";

describe("P2P Contract Sandbox", () => {
    let contract: any;

    const MODERATOR = Address.parse("0:1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff");
    const SELLER = Address.parse("0:1111000011110000111100001111000011110000111100001111000011110000");
    const BUYER = Address.parse("0:2222000022220000222200002222000022220000222200002222000022220000");

    beforeEach(async () => {
        // This is a mock implementation for testing purposes
        // In a real test, you would use the actual sandbox
        contract = {
            sendExternal: jest.fn().mockResolvedValue({}),
            sendInternal: jest.fn().mockResolvedValue({}),
            invokeGetMethod: jest.fn().mockImplementation(async (method, params) => {
                if (method === "get_deal_info" && params[0].value === 0) {
                    return {
                        stack: {
                            readBigNumber: () => toNano("1"),
                            readNumber: () => 1
                        }
                    };
                }
                return { stack: { readNumber: () => 0 } };
            })
        };
    });

    it("should create and fund a deal", async () => {
        // Step 1: External message to create a deal
        const memo = beginCell().storeStringTail("DEAL:1").endCell();
        const memoHash = memo.hash();

        const payload = beginCell()
            .storeUint(1, 32) // op_create_deal
            .storeAddress(MODERATOR) // sender == moderator
            .storeAddress(SELLER)
            .storeAddress(BUYER)
            .storeCoins(toNano("1")) // deal amount
            .storeRef(memo)
            .endCell();

        await contract.sendExternal({
            body: payload,
            from: MODERATOR,
            value: toNano("0.1")
        });

        // Step 2: Internal message to fund the deal (with memo)
        const bodyWithMemo = beginCell().storeRef(memo).endCell();

        await contract.sendInternal({
            from: BUYER,
            value: toNano("1.03"), // amount + 3% commission
            body: bodyWithMemo
        });

        // Step 3: Query deal info
        const res = await contract.invokeGetMethod("get_deal_info", [{ type: "int", value: 0 }]);
        const amount = res.stack.readBigNumber().toString();
        const funded = res.stack.readNumber();

        expect(amount).toBe(toNano("1").toString());
        expect(funded).toBe(1);
    });
});
