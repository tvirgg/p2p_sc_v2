import { Address, beginCell, toNano, Dictionary, Cell, Slice } from "ton-core";
import { compile } from "@ton-community/blueprint";
import { Blockchain, SandboxContract, TreasuryContract } from "@ton-community/sandbox";
import { P2P } from "../wrappers/P2P";
import '@ton-community/test-utils';

describe("P2P – ошибки Fund / Resolve", () => {
    let bc: Blockchain;
    let moderator: SandboxContract<TreasuryContract>;
    let stranger: SandboxContract<TreasuryContract>;
    let seller: SandboxContract<TreasuryContract>;
    let buyer: SandboxContract<TreasuryContract>;
    let contract: SandboxContract<P2P>;

    beforeEach(async () => {
        bc        = await Blockchain.create();
        moderator = await bc.treasury("moderator");
        stranger  = await bc.treasury("stranger");
        seller    = await bc.treasury("seller");
        buyer     = await bc.treasury("buyer");

        const code = await compile("P2P");
        contract   = bc.openContract(P2P.createFromConfig(moderator.address, code));
        await contract.sendDeploy(moderator.getSender(), toNano("0.05"));
    });

    test("Partial FundDeal is now allowed", async () => {
        const memo = "need-2-ton";
        const dealAmount = toNano("2");
        const partialAmount = toNano("1.5");
        
        await contract.sendCreateDeal(
            moderator.getSender(),
            seller.address,
            buyer.address,
            dealAmount,
            memo
        );

        // Partial funding should now succeed
        const tx = await contract.sendFundDeal(
            buyer.getSender(),
            memo,
            partialAmount
        );

        expect(tx.transactions).toHaveTransaction({ success: true });
        
        // Verify the deal is partially funded
        const dealInfo = await contract.getDealInfo(0);
        expect(dealInfo.funded).toBe(0); // Not fully funded yet
        expect(dealInfo.fundedAmount.toString()).toBe(partialAmount.toString());
    });

    test("Resolve по несуществующему memo ⇒ exit 401", async () => {
        const tx = await contract.sendResolveDealExternal(
            moderator.getSender(),
            "ghost-memo",
            true
        );

        expect(tx.transactions).toHaveTransaction({ success: false, exitCode: 401 });
    });
});

describe("P2P – повторный Fund и ранний Resolve", () => {
    let bc: Blockchain,
        moderator: SandboxContract<TreasuryContract>,
        seller: SandboxContract<TreasuryContract>,
        buyer: SandboxContract<TreasuryContract>,
        contract: SandboxContract<P2P>;

    beforeEach(async () => {
        bc        = await Blockchain.create();
        moderator = await bc.treasury("moderator");
        seller    = await bc.treasury("seller");
        buyer     = await bc.treasury("buyer");

        const code = await compile("P2P");
        contract   = bc.openContract(P2P.createFromConfig(moderator.address, code));
        await contract.sendDeploy(moderator.getSender(), toNano("0.05"));
    });

    test("повторный Fund ⇒ exit 131", async () => {
        const memo = "double-fund";
        await contract.sendCreateDeal(
            moderator.getSender(), seller.address, buyer.address, toNano("2"), memo
        );
        await contract.sendFundDeal(buyer.getSender(), memo, toNano("2"));

        const tx = await contract.sendFundDeal(buyer.getSender(), memo, toNano("2"));
        expect(tx.transactions).toHaveTransaction({ success: false, exitCode: 131 });
    });

    test("Resolve до Fund ⇒ exit 111", async () => {
        const memo = "resolve-early";
        await contract.sendCreateDeal(
            moderator.getSender(), seller.address, buyer.address, toNano("1"), memo
        );

        const tx = await contract.sendResolveDealExternal(
            moderator.getSender(), memo, true
        );

        expect(tx.transactions).toHaveTransaction({ success: false, exitCode: 111 });
    });
});
