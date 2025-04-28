import { Address, beginCell, toNano, Dictionary, Cell, Slice } from "ton-core";
import { compile } from "@ton-community/blueprint";
import { Blockchain, SandboxContract, TreasuryContract } from "@ton-community/sandbox";
import { P2P } from "../wrappers/P2P";
import '@ton-community/test-utils';
import { SendMode } from "ton-core";

describe("P2P – refund unknown funds (correct check)", () => {
    let blockchain: Blockchain;
    let contract: SandboxContract<P2P>;
    let moderator: SandboxContract<TreasuryContract>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        moderator  = await blockchain.treasury("moderator");

        const code = await compile("P2P");
        const cfg  = P2P.createFromConfig(moderator.address, code, 0);

        contract = blockchain.openContract(cfg);
        await contract.sendDeploy(moderator.getSender(), toNano("0.05"));
    });

    it("stores stray payment and throws on second refund", async () => {
        /* ------------------------------------------------------------------
         * 1. «Залётный» платёж от постороннего адреса
         * ----------------------------------------------------------------*/
        const stranger = await blockchain.treasury("stranger");
        const deposit  = toNano("1000");                 // 1000 TON

        const memoCell = beginCell().storeStringTail("ghost-memo").endCell();
        const body     = beginCell().storeRef(memoCell).endCell();

        await stranger.send({
            to:   contract.address,
            value: deposit,
            bounce: true,
            sendMode: 1,                    // pay fees separately
            body,
        });

        // комиссия 3 % должна попасть в пул
        const commission  = deposit * 3n / 100n;          // 30 TON
        const expectedNet = deposit - commission;         // 970 TON – в unknown_funds[0]

        const stored = await contract.getUnknownFund(0);
        expect(stored).toBe(expectedNet);

        /* ------------------------------------------------------------------
         * 2. Первый возврат unknown funds
         * ----------------------------------------------------------------*/
        const balBefore = await stranger.getBalance();

        await contract.sendRefundUnknown(
            moderator.getSender(),
            0,                                       // key
        );

        // запись должна исчезнуть
        const storedAfter = await contract.getUnknownFund(0);
        expect(storedAfter).toBe(0n);

        // на баланс пришло ~970 TON (‑комиссии сети)
        const balAfter = await stranger.getBalance();
        expect(balAfter - balBefore)
            .toBeGreaterThanOrEqual(expectedNet - toNano("0.1")); // оставляем запас 0.1 TON

        /* ------------------------------------------------------------------
         * 3. Повторный возврат → ошибка 120
         * ----------------------------------------------------------------*/
        const tx = await contract.sendRefundUnknown(
            moderator.getSender(),
            0,
        );

        expect(tx.transactions).toHaveTransaction({
            to:      contract.address,
            success: false,
            exitCode: 120,
        });

        /* ------------------------------------------------------------------
         * 4. Модератор выводит комиссии
         *    В пуле сейчас 30 TON, контракт оставит резерв 0.5 TON
         * ----------------------------------------------------------------*/
        const modBalBefore = await moderator.getBalance();

        // ожидаемая выплата из пула: 30 TON − 0.5 TON = 29.5 TON
        const expectedPayout = commission - toNano("0.5");

        await contract.sendWithdrawCommissions(moderator.getSender());

        const modBalAfter = await moderator.getBalance();
        // учтём 0.05 TON, которое модератор приложил, и сетевые fee (<0.01 TON)
        const margin = toNano("0.11");              // 0.05 value + ~0.06 запас

        expect(modBalAfter - modBalBefore)
            .toBeGreaterThanOrEqual(expectedPayout - margin);

        // в пуле должен остаться резерв 0.5 TON
        const poolAfter = (await contract.getContractData()).commissionsPool;
        expect(BigInt(poolAfter)).toBe(toNano("0.5"));
    });
});

describe("P2P – refund unknown funds (random memo)", () => {
    let blockchain: Blockchain;
    let moderator: SandboxContract<TreasuryContract>;
    let contract:   SandboxContract<P2P>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        moderator  = await blockchain.treasury("moderator");

        const code = await compile("P2P");
        const cfg  = P2P.createFromConfig(moderator.address, code, 0);
        contract   = blockchain.openContract(cfg);

        await contract.sendDeploy(moderator.getSender(), toNano("0.05"));
    });

    it("handles unknown memo correctly", async () => {
        /* ------------------------------------------------------------------
         * 1. «Залётный» перевод с random‑memo
         * ----------------------------------------------------------------*/
        const stranger   = await blockchain.treasury("stranger");
        const deposit    = toNano("1");                   // 1 TON

        const randomMemo = `unknown-memo-${Math.floor(Math.random() * 1e6)}`;
        const memoCell   = beginCell().storeStringTail(randomMemo).endCell();
        const body       = beginCell().storeRef(memoCell).endCell();

        await stranger.send({
            to:       contract.address,
            value:    deposit,
            bounce:   true,
            sendMode: 1,
            body,
        });

        const commission  = deposit * 3n / 100n;           // 0.03 TON
        const expectedNet = deposit  - commission;         // 0.97 TON

        expect(await contract.getUnknownFund(0)).toBe(expectedNet);

        /* ------------------------------------------------------------------
         * 2. Первый возврат
         * ----------------------------------------------------------------*/
        const balBefore = await stranger.getBalance();

        await contract.sendRefundUnknown(moderator.getSender(), 0);

        expect(await contract.getUnknownFund(0)).toBe(0n);

        const balAfter = await stranger.getBalance();
        expect(balAfter - balBefore)
            .toBeGreaterThanOrEqual(expectedNet - toNano("0.05"));

        /* ------------------------------------------------------------------
         * 3. Повторный возврат → throw 120
         * ----------------------------------------------------------------*/
        const tx = await contract.sendRefundUnknown(moderator.getSender(), 0);
        expect(tx.transactions).toHaveTransaction({
            to:       contract.address,
            success:  false,
            exitCode: 120,
        });

        /* ------------------------------------------------------------------
         * 4. Попытка вывести комиссии, которых меньше 0.5 TON
         * ----------------------------------------------------------------*/
        const modBalBefore = await moderator.getBalance();

        await contract.sendWithdrawCommissions(moderator.getSender());

        const modBalAfter = await moderator.getBalance();
        // модератор только заплатил 0.05 TON + fee, выплаты не было
        expect(modBalAfter).toBeLessThan(modBalBefore);

        const { commissionsPool } = await contract.getContractData();
        // пул не тронут, там всё ещё наши 0.03 TON
        expect(BigInt(commissionsPool)).toBe(commission);
    });
});

describe("P2P – overpayment handling", () => {
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

    it("should handle overpayment: seller gets deal amount minus commission, buyer gets overpayment back", async () => {
        const DEAL_AMOUNT = toNano("5");
        const OVERPAYMENT = toNano("1");
        const TOTAL_PAYMENT = DEAL_AMOUNT + OVERPAYMENT;
        const memo = "overpayment-test";
    
        // 1. Создаём сделку
        await contract.sendCreateDeal(
            moderator.getSender(),
            seller.address,
            buyer.address,
            DEAL_AMOUNT,
            memo
        );
    
        // 2. Покупатель финансирует сделку с переплатой
        await contract.sendFundDeal(
            buyer.getSender(),
            memo,
            TOTAL_PAYMENT
        );
    
        // Проверяем, что сделка профинансирована
        const dealInfo = await contract.getDealInfo(0);
        expect(dealInfo.funded).toBe(1);
    
        // 3. Сохраняем баланс продавца перед разрешением
        const sellerBalanceBefore = await seller.getBalance();
    
        // 4. Разрешаем сделку в пользу продавца
        await contract.sendResolveDealExternal(
            moderator.getSender(),
            memo,
            true
        );
    
        // 5. Проверяем баланс продавца
        const sellerBalanceAfter = await seller.getBalance();
        const COMMISSION_PERCENT = 3;
        const expectedSellerReceive = DEAL_AMOUNT - (DEAL_AMOUNT * BigInt(COMMISSION_PERCENT) / 100n);
        const sellerDelta = sellerBalanceAfter - sellerBalanceBefore;
        expect(sellerDelta).toBeGreaterThanOrEqual(expectedSellerReceive - toNano("0.03"));
    
        // 6. Проверяем, что переплата осталась в unknown_funds
        const storedOverpay = await contract.getUnknownFund(0);
        expect(storedOverpay).toBe(OVERPAYMENT);
    
        // 7. Сохраняем баланс покупателя перед возвратом
        const buyerBalanceBeforeRefund = await buyer.getBalance();
    
        // 8. Модератор инициирует возврат переплаты
        await contract.sendRefundUnknown(moderator.getSender(), 0);
    
        // 9. Проверяем, что unknown_funds[0] очищено
        const storedAfterRefund = await contract.getUnknownFund(0);
        expect(storedAfterRefund).toBe(0n);
    
        // 10. Проверяем баланс покупателя после возврата
        const buyerBalanceAfterRefund = await buyer.getBalance();
        const buyerDelta = buyerBalanceAfterRefund - buyerBalanceBeforeRefund;
    
        // Ожидаем, что покупатель получил почти всю переплату обратно
        const margin = toNano("0.05");
        expect(buyerDelta).toBeGreaterThanOrEqual(OVERPAYMENT - margin);
    }, 60_000);

    it("should handle overpayment: deal resolved in favor of buyer, buyer gets full amount back", async () => {
        const DEAL_AMOUNT = toNano("5");
        const OVERPAYMENT = toNano("1");
        const TOTAL_PAYMENT = DEAL_AMOUNT + OVERPAYMENT;
        const memo = "overpayment-to-buyer-test";
    
        // 1. Создаём сделку
        await contract.sendCreateDeal(
            moderator.getSender(),
            seller.address,
            buyer.address,
            DEAL_AMOUNT,
            memo
        );
    
        // 2. Покупатель финансирует сделку с переплатой
        await contract.sendFundDeal(
            buyer.getSender(),
            memo,
            TOTAL_PAYMENT
        );
    
        // Проверяем, что сделка профинансирована
        const dealInfo = await contract.getDealInfo(0);
        expect(dealInfo.funded).toBe(1);
    
        // 3. Сохраняем баланс покупателя перед разрешением
        const buyerBalanceBeforeResolve = await buyer.getBalance();
    
        // 4. Разрешаем сделку в пользу покупателя (approvePayment = false)
        await contract.sendResolveDealExternal(
            moderator.getSender(),
            memo,
            false
        );
    
        // 5. Проверяем баланс покупателя после разрешения
        const buyerBalanceAfterResolve = await buyer.getBalance();
        const buyerDeltaAfterResolve = buyerBalanceAfterResolve - buyerBalanceBeforeResolve;
    
        // После разрешения покупатель должен получить сумму сделки (5 TON)
        const margin = toNano("0.05");
        expect(buyerDeltaAfterResolve).toBeGreaterThanOrEqual(DEAL_AMOUNT - margin);
    
        // 6. Проверяем, что переплата осталась в unknown_funds
        const storedOverpay = await contract.getUnknownFund(0);
        expect(storedOverpay).toBe(OVERPAYMENT);
    
        // 7. Сохраняем баланс покупателя перед возвратом переплаты
        const buyerBalanceBeforeRefund = await buyer.getBalance();
    
        // 8. Модератор инициирует возврат переплаты
        await contract.sendRefundUnknown(moderator.getSender(), 0);
    
        // 9. Проверяем, что unknown_funds[0] очищено
        const storedAfterRefund = await contract.getUnknownFund(0);
        expect(storedAfterRefund).toBe(0n);
    
        // 10. Проверяем баланс покупателя после возврата переплаты
        const buyerBalanceAfterRefund = await buyer.getBalance();
        const buyerDeltaRefund = buyerBalanceAfterRefund - buyerBalanceBeforeRefund;
    
        expect(buyerDeltaRefund).toBeGreaterThanOrEqual(OVERPAYMENT - margin);
    }, 60_000);
});
