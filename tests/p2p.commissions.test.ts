import { Address, beginCell, toNano, Dictionary, Cell, Slice } from "ton-core";
import { compile } from "@ton-community/blueprint";
import { Blockchain, SandboxContract, TreasuryContract } from "@ton-community/sandbox";
import { P2P } from "../wrappers/P2P";
import '@ton-community/test-utils';

// Define constants from the contract
const COMMISSION_WITH_MEMO = 3; // 3% commission for deals with memo
const CP_RESERVE_GAS = toNano("0.5"); // Reserve gas for commissions pool

describe("P2P - Commissions Tests", () => {
    let blockchain: Blockchain;
    let contract: SandboxContract<P2P>;
    let moderatorWallet: SandboxContract<TreasuryContract>;

    beforeEach(async () => {
        // 1) Создаём локальный блокчейн
        blockchain = await Blockchain.create();
        blockchain.verbosity = {
            blockchainLogs: true,
            vmLogs: "vm_logs",
            debugLogs: true,
            print: false,
        };

        // 2) Создаём "модератора" (кошелёк)
        moderatorWallet = await blockchain.treasury("moderator");

        // 3) Компилим исходный код контракта (например, P2P.fc)
        const code = await compile("P2P");

        // 4) Создаём экземпляр контракта через обёртку
        const p2pConfig = P2P.createFromConfig(moderatorWallet.address, code, 0);

        // 5) "Открываем" контракт через sandbox
        contract = blockchain.openContract(p2pConfig);

        // 6) Деплоим контракт
        await contract.sendDeploy(
            moderatorWallet.getSender(),
            toNano("0.05")
        );
        
        process.stdout.write(`🚀 Контракт задеплоен по адресу: ${contract.address.toString()}\n`);
    });

    it("should allow moderator to withdraw commissions", async () => {
        /* 1. Готовим участников */
        const sellerWallet = await blockchain.treasury("seller");
        const buyerWallet = await blockchain.treasury(
            "buyer",
            { balance: toNano("1000000") }
        )
        
        const dealAmount   = toNano("2000");
        const iterations   = 10;                 // ≥ 9 → cp > 0.5 TON

        /* 2. Накручиваем пул комиссий */
        for (let i = 0; i < iterations; i++) {
            const memo = `bulk-${i}`;
            await contract.sendCreateDeal(
                moderatorWallet.getSender(),
                sellerWallet.address,
                buyerWallet.address,
                dealAmount,
                memo
            );
            await contract.sendFundDeal(
                buyerWallet.getSender(),
                memo,
                toNano("2000.1")
            );
            await contract.sendResolveDealExternal(
                moderatorWallet.getSender(),
                memo,
                true                         // к продавцу ⇒ комиссия в пул
            );
        }

        /* 3. Сколько накопили перед выводом */
        const dataBefore = await contract.getContractData();
        const cpBefore   = BigInt(dataBefore.commissionsPool);   // ← приводим к bigint
        expect(cpBefore).toBeGreaterThanOrEqual(toNano("0.5"));

        /* 4. Выводим комиссии */
        const modBalanceBefore = await moderatorWallet.getBalance();
        await contract.sendWithdrawCommissions(moderatorWallet.getSender());

        /* 5. Проверяем результат */
        const dataAfter = await contract.getContractData();
        const cpAfter   = BigInt(dataAfter.commissionsPool);
        expect(cpAfter).toBe(toNano("0.5"));                     // в пуле остался резерв

        const modBalanceAfter = await moderatorWallet.getBalance();
        const margin = toNano("0.07");        // 0.05 TON + небольшой запас на fee

        expect(
          BigInt(modBalanceAfter) - BigInt(modBalanceBefore)
        ).toBeGreaterThanOrEqual(
          cpBefore - toNano("0.5") - margin   // учли входящий value + fee
        );
    });
});

describe("P2P – пустой пул комиссий", () => {
    let bc: Blockchain, moderator: SandboxContract<TreasuryContract>,
        contract: SandboxContract<P2P>;

    beforeEach(async () => {
        bc        = await Blockchain.create();
        moderator = await bc.treasury("moderator");
        const code = await compile("P2P");
        contract   = bc.openContract(P2P.createFromConfig(moderator.address, code));
        await contract.sendDeploy(moderator.getSender(), toNano("0.05"));
    });

    test("вывод невозможен, exit 401", async () => {
        const bal0 = await moderator.getBalance();

        const tx = await contract.sendWithdrawCommissions(moderator.getSender());
        expect(tx.transactions).toHaveTransaction({ success: false, exitCode: 401 });

        const bal1 = await moderator.getBalance();
        const maxGasLoss = toNano("0.02");   // ~0.02 TON — щадящий потолок fee
        expect(bal0 - bal1).toBeLessThanOrEqual(maxGasLoss);
    });
});

describe("P2P – вывод комиссий (reserve 0.5 TON)", () => {
    let bc: Blockchain,
        moderator: SandboxContract<TreasuryContract>,
        seller: SandboxContract<TreasuryContract>,
        buyer: SandboxContract<TreasuryContract>,
        contract: SandboxContract<P2P>;

    beforeEach(async () => {
        bc        = await Blockchain.create();
        moderator = await bc.treasury("moderator");
        seller    = await bc.treasury("seller");
        buyer     = await bc.treasury("buyer", { balance: toNano("1000000") });

        const code = await compile("P2P");
        contract   = bc.openContract(P2P.createFromConfig(moderator.address, code));
        await contract.sendDeploy(moderator.getSender(), toNano("0.05"));
    });

    it("после withdraw в пуле остаётся 0.5 TON", async () => {
        const DEAL = toNano("2000");
        for (let i = 0; i < 10; i++) {
            const memo = `d-${i}`;
            await contract.sendCreateDeal(
                moderator.getSender(), seller.address, buyer.address, DEAL, memo
            );
            await contract.sendFundDeal(buyer.getSender(), memo, DEAL);
            await contract.sendResolveDealExternal(
                moderator.getSender(), memo, true
            );
        }

        const before = BigInt((await contract.getContractData()).commissionsPool);
        const bal0   = await moderator.getBalance();

        await contract.sendWithdrawCommissions(moderator.getSender());

        const after = BigInt((await contract.getContractData()).commissionsPool);
        expect(after).toBe(CP_RESERVE_GAS);

        const margin = toNano("0.07");
        expect(BigInt(await moderator.getBalance()) - BigInt(bal0))
            .toBeGreaterThanOrEqual(before - CP_RESERVE_GAS - margin);
    });
});
