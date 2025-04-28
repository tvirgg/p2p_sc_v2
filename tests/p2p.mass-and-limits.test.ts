import { Address, beginCell, toNano, Dictionary, Cell, Slice } from "ton-core";
import { compile } from "@ton-community/blueprint";
import { Blockchain, SandboxContract, TreasuryContract } from "@ton-community/sandbox";
import { P2P } from "../wrappers/P2P";
import '@ton-community/test-utils';

// Define constants
const MIN_CREATE_FEE = 3_000_000n; // 0.003 TON
const DEAL_AMOUNTS = ["0.5", "0.8", "1", "1.2", "0.7"]; // TON

describe("P2P – депозит при создании множества сделок", () => {
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

    it("commissionsPool == N × MIN_CREATE_FEE", async () => {
        for (let i = 0; i < DEAL_AMOUNTS.length; i++) {
            const memo = `bulk-${i}`;
            await contract.sendCreateDeal(
                moderator.getSender(),
                seller.address,
                buyer.address,
                toNano(DEAL_AMOUNTS[i]),
                memo
            );
            await contract.sendFundDeal(buyer.getSender(), memo, toNano(DEAL_AMOUNTS[i]));
        }

        const { commissionsPool } = await contract.getContractData();
        expect(BigInt(commissionsPool)).toBe(
            MIN_CREATE_FEE * BigInt(DEAL_AMOUNTS.length)
        );
    });
});

describe("P2P – UF_MAX_RECORDS overflow", () => {
    let bc: Blockchain,
        moderator: SandboxContract<TreasuryContract>,
        spammer:   SandboxContract<TreasuryContract>,
        contract:  SandboxContract<P2P>;

    // ❶ Поднимем chain и деплоим контракт
    beforeEach(async () => {
        bc        = await Blockchain.create();
        moderator = await bc.treasury("moderator");
        spammer   = await bc.treasury("spammer", { balance: toNano("4000") });

        const code = await compile("P2P");
        contract   = bc.openContract(P2P.createFromConfig(moderator.address, code));
        await contract.sendDeploy(moderator.getSender(), toNano("0.05"));
    });

    /** UF_MAX_RECORDS = 10 000 ⇒ 10 001-й платёж должен упасть с exit 152 */
    it("> UF_MAX_RECORDS ⇒ exit 152", async () => {
        const UF_MAX = 10_000;                 // см. константу в P2P.fc
        const deposit = toNano("0.2");         // 0.2 TON: маленький, но >0.1 TON

        // ❷ «Забиваем» unknown_funds до лимита
        for (let i = 0; i < UF_MAX; i++) {
            await spammer.send({
                to:       contract.address,
                value:    deposit,
                bounce:   true,
                sendMode: 1,                   // pay fees separately
            });
        }

        // ❸ 10 001-й платёж – ждём throw(152)
        const trace = await spammer.send({
            to:       contract.address,
            value:    deposit,
            bounce:   true,
            sendMode: 1,
        });

        expect(trace.transactions).toHaveTransaction({
            to:       contract.address,
            success:  false,
            exitCode: 152,                    // UF_MAX_RECORDS overflow
        });

        // ❹ Убедимся, что счётчик больше не растёт
        const lastKey = await contract.getUnknownFund(UF_MAX /* 10 000 */);
        expect(lastKey).toBe(0n);             // записи нет
    }, 300_000);  // ⏱ увеличим таймаут – 10 001 tx ≈ 3-4 с
});
