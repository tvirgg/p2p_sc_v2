import { Address, beginCell, toNano, Dictionary, Cell, Slice } from "ton-core";
import { compile } from "@ton-community/blueprint";
import { Blockchain, SandboxContract, TreasuryContract } from "@ton-community/sandbox";
import { P2P } from "../wrappers/P2P";
import '@ton-community/test-utils';

describe("P2P – partial fund then resolve", () => {
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

    it("should support partial funding of a deal", async () => {
        const DEAL_AMOUNT = toNano("5");
        const FIRST_PAYMENT = toNano("2");
        const SECOND_PAYMENT = toNano("1.5");
        const FINAL_PAYMENT = toNano("1.5"); // Total = 5 TON

        const memo = "partial-deal-test";

        // 1. Создаём сделку
        await contract.sendCreateDeal(
            moderator.getSender(),
            seller.address,
            buyer.address,
            DEAL_AMOUNT,
            memo
        );

        // 2. Первый частичный платеж
        await contract.sendFundDeal(
            buyer.getSender(),
            memo,
            FIRST_PAYMENT
        );

        // Проверяем funded == 0 и funded_amount == FIRST_PAYMENT
        let dealInfo = await contract.getDealInfo(0);
        expect(dealInfo.funded).toBe(0);
        expect(dealInfo.fundedAmount.toString()).toBe(FIRST_PAYMENT.toString());

        // Получаем полную информацию о сделке
        let fullDealInfo = await contract.getFullDealInfo(0);
        expect(fullDealInfo.fundedAmount.toString()).toBe(FIRST_PAYMENT.toString());

        // 3. Второй частичный платеж
        await contract.sendFundDeal(
            buyer.getSender(),
            memo,
            SECOND_PAYMENT
        );

        // Проверяем funded == 0 и funded_amount == FIRST_PAYMENT + SECOND_PAYMENT
        dealInfo = await contract.getDealInfo(0);
        expect(dealInfo.funded).toBe(0);
        expect(dealInfo.fundedAmount.toString()).toBe((FIRST_PAYMENT + SECOND_PAYMENT).toString());

        // 4. Пытаемся разрешить сделку (ожидаем фейл, т.к. сделка не полностью профинансирована)
        const txBefore = await contract.sendResolveDealExternal(
            moderator.getSender(),
            memo,
            true
        );

        expect(txBefore.transactions).toHaveTransaction({
            success: false,
            exitCode: 111,
        });

        // 5. Финальный платеж
        await contract.sendFundDeal(
            buyer.getSender(),
            memo,
            FINAL_PAYMENT
        );

        // Проверяем funded == 1 и funded_amount == DEAL_AMOUNT
        dealInfo = await contract.getDealInfo(0);
        expect(dealInfo.funded).toBe(1);
        expect(dealInfo.fundedAmount.toString()).toBe(DEAL_AMOUNT.toString());

        // 6. Проверяем баланс продавца до разрешения
        const sellerBalanceBefore = await seller.getBalance();

        // 7. Теперь можно разрешить
        const txAfter = await contract.sendResolveDealExternal(
            moderator.getSender(),
            memo,
            true
        );

        expect(txAfter.transactions).toHaveTransaction({
            success: true,
        });

        // 8. Проверяем баланс продавца после разрешения
        const sellerBalanceAfter = await seller.getBalance();

        // Продавец должен получить сумму сделки минус комиссия (3%)
        const COMMISSION_PERCENT = 3;
        const expectedReceived = DEAL_AMOUNT - (DEAL_AMOUNT * BigInt(COMMISSION_PERCENT) / 100n);

        const delta = sellerBalanceAfter - sellerBalanceBefore;

        expect(delta).toBeGreaterThanOrEqual(expectedReceived - toNano("0.03")); // допустим маленькую погрешность на fee

    }, 60_000);
});

describe("P2P – partial fund then resolve", () => {
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

    it("should not allow resolve on partially funded deal", async () => {
        const DEAL_AMOUNT = toNano("5");
        const PARTIAL_AMOUNT = toNano("3");
        const REMAINING_AMOUNT = DEAL_AMOUNT - PARTIAL_AMOUNT;

        const memo = "partial-deal-test";

        // 1. Создаём сделку
        await contract.sendCreateDeal(
            moderator.getSender(),
            seller.address,
            buyer.address,
            DEAL_AMOUNT,
            memo
        );

        // 2. Частично финансируем
        await contract.sendFundDeal(
            buyer.getSender(),
            memo,
            PARTIAL_AMOUNT
        );

        // Проверяем funded == 0
        let dealInfo = await contract.getDealInfo(0);
        expect(dealInfo.funded).toBe(0);

        // 3. Пытаемся разрешить сделку (ожидаем фейл)
        const txBefore = await contract.sendResolveDealExternal(
            moderator.getSender(),
            memo,
            true
        );

        expect(txBefore.transactions).toHaveTransaction({
            success: false,
            exitCode: 111,
        });

        // 4. Дофинансируем оставшуюся сумму
        await contract.sendFundDeal(
            buyer.getSender(),
            memo,
            REMAINING_AMOUNT
        );

        // Проверяем funded == 1
        dealInfo = await contract.getDealInfo(0);
        expect(dealInfo.funded).toBe(1);

        // 5. Проверяем баланс продавца до разрешения
        const sellerBalanceBefore = await seller.getBalance();

        // 6. Теперь можно разрешить
        const txAfter = await contract.sendResolveDealExternal(
            moderator.getSender(),
            memo,
            true
        );

        expect(txAfter.transactions).toHaveTransaction({
            success: true,
        });

        // 7. Проверяем баланс продавца после разрешения
        const sellerBalanceAfter = await seller.getBalance();

        // Продавец должен получить сумму сделки минус комиссия (3%)
        const COMMISSION_PERCENT = 3;
        const expectedReceived = DEAL_AMOUNT - (DEAL_AMOUNT * BigInt(COMMISSION_PERCENT) / 100n);

        const delta = sellerBalanceAfter - sellerBalanceBefore;

        expect(delta).toBeGreaterThanOrEqual(expectedReceived - toNano("0.03")); // допустим маленькую погрешность на fee

    }, 60_000);

    it("should allow moderator to refund buyer if deal is not fully funded", async () => {
        const DEAL_AMOUNT = toNano("5");
        const PARTIAL_AMOUNT = toNano("2");

        const memo = "refund-partial-deal-test";

        // 1. Создаём сделку
        await contract.sendCreateDeal(
            moderator.getSender(),
            seller.address,
            buyer.address,
            DEAL_AMOUNT,
            memo
        );

        // 2. Частично финансируем
        await contract.sendFundDeal(
            buyer.getSender(),
            memo,
            PARTIAL_AMOUNT
        );

        // Проверяем funded == 0
        let dealInfo = await contract.getDealInfo(0);
        expect(dealInfo.funded).toBe(0);

        // 3. Проверяем баланс покупателя до возврата
        const buyerBalanceBefore = await buyer.getBalance();

        // 4. Модератор решает отменить сделку (вернуть деньги баеру)
        const txRefund = await contract.sendResolveDealExternal(
            moderator.getSender(),
            memo,
            false // false значит вернуть баеру
        );

        expect(txRefund.transactions).toHaveTransaction({
            success: true,
        });

        // 5. Проверяем баланс покупателя после возврата
        const buyerBalanceAfter = await buyer.getBalance();

        const refundedAmount = buyerBalanceAfter - buyerBalanceBefore;

        // Баер должен получить почти всё назад (за вычетом комиссии и небольшой платы за газ)
        expect(refundedAmount).toBeGreaterThanOrEqual(PARTIAL_AMOUNT - toNano("0.05"));
    }, 60_000);
});
