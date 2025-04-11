import { Address, beginCell, toNano } from "ton-core";
import { compile } from "@ton-community/blueprint";
import { Blockchain, SandboxContract } from "@ton-community/sandbox";
import { P2P } from "../wrappers/P2P";
import '@ton-community/test-utils';

// Fireworks-style test

describe("P2P Contract Sandbox - Fireworks style", () => {
    let blockchain: Blockchain;
    let contract: SandboxContract<P2P>;
    let MODERATOR: Address;

    const SELLER = Address.parse("0:1111000011110000111100001111000011110000111100001111000011110000");
    const BUYER = Address.parse("0:2222000022220000222200002222000022220000222200002222000022220000");

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        blockchain.verbosity = {
            blockchainLogs: true,
            vmLogs: "vm_logs_full",
            debugLogs: true,
            print: false
        };

        const moderatorWallet = await blockchain.treasury("moderator");
        MODERATOR = moderatorWallet.address;

        const code = await compile("P2P");
        const p2pContract = P2P.createFromConfig(MODERATOR, code);
        contract = blockchain.openContract(p2pContract);

        await contract.sendDeploy(moderatorWallet, toNano("0.05"));
    });

    it("should create and fund a deal", async () => {
        const dealAmount = toNano("2");
        const memoText = `DEAL:${Math.floor(Math.random() * 900000) + 100001}`;

        const moderatorWallet = await blockchain.treasury("moderator");
        const buyerWallet = await blockchain.treasury("buyer");

        // --- Step 1: Create Deal ---
        const createResult = await contract.sendCreateDeal(
            moderatorWallet,
            MODERATOR,
            SELLER,
            BUYER,
            dealAmount,
            memoText
        );
        console.log("🧾 SELLER:", SELLER.toString());
        console.log("🧾 BUYER:", BUYER.toString());
        console.log("📦 CREATE DEAL TRANSACTIONS:", createResult.transactions);

        expect(createResult.transactions).toHaveTransaction({
            from: moderatorWallet.address,
            to: contract.address,
            success: true,
            op: 1,
        });

        const dealCounter = await contract.getDealCounter();
        expect(dealCounter).toBe(1);

        // --- Step 2: Fund Deal ---
        const fundResult = await contract.sendFundDeal(
            buyerWallet,
            memoText,
            toNano("2.1") // slightly more to cover commission
        );

        console.log("💰 FUND DEAL TRANSACTIONS:", fundResult.transactions);

        expect(fundResult.transactions).toHaveTransaction({
            from: buyerWallet.address,
            to: contract.address,
            success: true,
            op: 5,
        });

        // --- Step 3: Check Deal Info ---
        const info = await contract.getDealInfo(0);
        expect(info.amount.toString()).toBe(dealAmount.toString());
        expect(info.funded).toBe(1);
    });
});
