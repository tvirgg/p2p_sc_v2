import { Address, beginCell, toNano, Dictionary, Cell, Slice } from "ton-core";
import { compile } from "@ton-community/blueprint";
import { Blockchain, SandboxContract, TreasuryContract } from "@ton-community/sandbox";
import { P2P } from "../wrappers/P2P";
import '@ton-community/test-utils';

// Define constants
const MIN_CREATE_FEE = 3_000_000n; // 0.003 TON

describe("P2P – сделка на 1 nanoTON", () => {
    let bc: Blockchain;
    let moderator: SandboxContract<TreasuryContract>;
    let seller: SandboxContract<TreasuryContract>;
    let buyer: SandboxContract<TreasuryContract>;
    let contract: SandboxContract<P2P>;

    beforeEach(async () => {
        bc        = await Blockchain.create();
        moderator = await bc.treasury("moderator");
        seller    = await bc.treasury("seller");
        buyer     = await bc.treasury("buyer");

        const code = await compile("P2P");
        contract   = bc.openContract(P2P.createFromConfig(moderator.address, code));
        await contract.sendDeploy(moderator.getSender(), toNano("0.05"));
    });

    it("депозит попал в пул, комиссия за сделку = 0", async () => {
        const memo = "nano-test";

        await contract.sendCreateDeal(
            seller.getSender(),            // любой адрес
            seller.address,
            buyer.address,
            1n,                            // 1 nanoTON
            memo
        );
        await contract.sendFundDeal(buyer.getSender(), memo, toNano("0.03"));

        expect((await contract.getDealInfo(0)).funded).toBe(1);
        expect(BigInt((await contract.getContractData()).commissionsPool))
              .toBe(MIN_CREATE_FEE);
    });
});
