import { Address, beginCell, toNano } from "ton-core";
import { compile } from "@ton-community/blueprint";
import { Blockchain, SandboxContract, TreasuryContract } from "@ton-community/sandbox";
import { P2P } from "../wrappers/P2P";
import '@ton-community/test-utils';

describe("P2P Contract Sandbox", () => {
    let blockchain: Blockchain;
    let contract: SandboxContract<P2P>;
    let moderatorWallet: SandboxContract<TreasuryContract>;

    // Для тестовых целей используем фиксированный hex для покупателя,
    // а для продавца и для проверки перевода средств создаём кошельки через sandbox.
    const BUYER_HEX  = "0:2222000022220000222200002222000022220000222200002222000022220000";

    beforeEach(async () => {
        // 1) Создаём локальный блокчейн
        blockchain = await Blockchain.create();
        blockchain.verbosity = {
            blockchainLogs: true,
            vmLogs: "vm_logs_full",
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

    it("should create a deal", async () => {
        const SELLER = Address.parse("0:1111000011110000111100001111000011110000111100001111000011110000");
        const BUYER = Address.parse(BUYER_HEX);
        const dealAmount = toNano("2");
        const memoText = "1236";

        // Вычисляем хэш memoCell (для логирования)
        const memoCell = beginCell().storeStringTail(memoText).endCell();
        const memoHash = memoCell.hash().toString("hex");
        process.stdout.write(`🔖 Memo Hash: ${memoHash}\n`);

        process.stdout.write(`🏁 Контракт адрес: ${contract.address.toString()}\n`);
        process.stdout.write(`🏁 Модератор адрес: ${moderatorWallet.address.toString()}\n`);

        // Получаем данные контракта до создания сделки
        const contractDataBefore = await contract.getContractData();
        process.stdout.write(`📊 Данные контракта ДО: ${JSON.stringify(contractDataBefore)}\n`);
        
        // Проверяем адрес модератора, записанный в контракте
        const moderatorAddress = await contract.getModeratorAddress();
        process.stdout.write(`👮 Модератор в контракте: ${moderatorAddress.toString()}\n`);
        expect(moderatorAddress.equals(moderatorWallet.address)).toBe(true);

        // Создаём сделку
        const createResult = await contract.sendCreateDeal(
            moderatorWallet.getSender(),
            SELLER,
            BUYER,
            dealAmount,
            memoText
        );
        expect(createResult.transactions).toHaveTransaction({
            from: moderatorWallet.address,
            to: contract.address,
            success: true,
            op: 1,
        });
        process.stdout.write(`✅ Сделка создана\n`);

        // Получаем данные контракта после создания сделки
        const contractDataAfter = await contract.getContractData();
        process.stdout.write(`📊 Данные контракта ПОСЛЕ: ${JSON.stringify(contractDataAfter)}\n`);

        // Получаем счётчик сделок
        const dealCounter = await contract.getDealCounter();
        process.stdout.write(`📊 dealCounter = ${dealCounter}\n`);
        expect(dealCounter).toBe(1);

        // Проверяем getDealInfo(0)
        const infoBefore = await contract.getDealInfo(0);
        process.stdout.write(`🧮 Deal Info (index=0) = ${JSON.stringify(infoBefore)}\n`);
        expect(infoBefore.amount.toString()).toBe(dealAmount.toString());
        expect(infoBefore.funded).toBe(0);

        // Получаем полную информацию о сделке (для отладки)
        try {
            const fullDealInfo = await contract.getFullDealInfo(0);
            process.stdout.write(`📋 Полная информация о сделке: ${JSON.stringify(fullDealInfo)}\n`);
        } catch (error) {
            process.stdout.write(`❌ Ошибка при получении полной информации о сделке: ${error}\n`);
        }
    });

    it("should create and fund a deal", async () => {
        const SELLER = Address.parse("0:1111000011110000111100001111000011110000111100001111000011110000");
        const BUYER = Address.parse(BUYER_HEX);
        const dealAmount = toNano("2");
        const memoText = "DEAL:1";

        // Создаём кошелёк покупателя для финансирования сделки
        const buyerWallet = await blockchain.treasury("buyer");

        // Получаем баланс покупателя ДО финансирования
        const buyerBalanceBefore = await buyerWallet.getBalance();
        process.stdout.write(`💳 Баланс покупателя ДО финансирования: ${buyerBalanceBefore.toString()}\n`);

        // Получаем данные контракта до создания сделки
        const contractDataBefore = await contract.getContractData();
        process.stdout.write(`📊 Данные контракта ДО: ${JSON.stringify(contractDataBefore)}\n`);
        
        // Проверяем, что модератор записан корректно
        const moderatorAddress = await contract.getModeratorAddress();
        process.stdout.write(`👮 Модератор в контракте: ${moderatorAddress.toString()}\n`);
        expect(moderatorAddress.equals(moderatorWallet.address)).toBe(true);

        // Шаг 1: создаём сделку
        await contract.sendCreateDeal(
            moderatorWallet.getSender(),
            SELLER,
            BUYER,
            dealAmount,
            memoText
        );
        process.stdout.write(`✅ Сделка создана\n`);

        // Получаем данные контракта после создания сделки
        const contractDataAfterCreate = await contract.getContractData();
        process.stdout.write(`📊 Данные контракта ПОСЛЕ создания: ${JSON.stringify(contractDataAfterCreate)}\n`);

        const dealCounterAfterCreate = await contract.getDealCounter();
        process.stdout.write(`📈 Deal counter после создания: ${dealCounterAfterCreate}\n`);

        // Получаем информацию о сделке ДО финансирования
        const dealInfoBeforeFunding = await contract.getDealInfo(0);
        process.stdout.write(`📦 Данные сделки ДО финансирования: ${JSON.stringify({
            amount: dealInfoBeforeFunding.amount.toString(),
            funded: dealInfoBeforeFunding.funded
        })}\n`);

        // Получаем полную информацию о сделке ДО финансирования
        const fullDealInfoBeforeFunding = await contract.getFullDealInfo(0);
        process.stdout.write(`📋 Полная информация о сделке ДО финансирования: ${JSON.stringify(fullDealInfoBeforeFunding)}\n`);

        // Шаг 2: финансирование сделки
        await contract.sendFundDeal(
            buyerWallet.getSender(),
            memoText,
            toNano("2.1") // чуть больше для учёта комиссии
        );
        process.stdout.write(`💰 Сделка профинансирована\n`);

        // Получаем баланс покупателя ПОСЛЕ финансирования
        const buyerBalanceAfter = await buyerWallet.getBalance();
        process.stdout.write(`💳 Баланс покупателя ПОСЛЕ финансирования: ${buyerBalanceAfter.toString()}\n`);

        // Получаем данные контракта ПОСЛЕ финансирования
        const contractDataAfterFunding = await contract.getContractData();
        process.stdout.write(`📊 Данные контракта ПОСЛЕ финансирования: ${JSON.stringify(contractDataAfterFunding)}\n`);

        // Проверяем состояние сделки после финансирования
        const dealInfoAfterFunding = await contract.getDealInfo(0);
        process.stdout.write(`📦 Данные сделки ПОСЛЕ финансирования: ${JSON.stringify({
            amount: dealInfoAfterFunding.amount.toString(),
            funded: dealInfoAfterFunding.funded
        })}\n`);
        expect(dealInfoAfterFunding.amount.toString()).toBe(dealAmount.toString());
        expect(dealInfoAfterFunding.funded).toBe(1);

        // Получаем полную информацию о сделке ПОСЛЕ финансирования (для отладки)
        const fullDealInfoAfterFunding = await contract.getFullDealInfo(0);
        process.stdout.write(`📋 Полная информация о сделке ПОСЛЕ финансирования: ${JSON.stringify(fullDealInfoAfterFunding)}\n`);
    });

    it("should resolve deal in favor of seller", async () => {
        // Для данного теста создаём кошельки для продавца и покупателя,
        // чтобы можно было проверить перевод средств продавцу.
        const sellerWallet = await blockchain.treasury("seller");
        const buyerWallet = await blockchain.treasury("buyer");
        const dealAmount = toNano("2");
        const memoText = "deal-to-seller";

        // Шаг 1: создаём сделку (в данном случае адрес продавца берём из кошелька)
        await contract.sendCreateDeal(
            moderatorWallet.getSender(),
            sellerWallet.address,
            Address.parse(BUYER_HEX),
            dealAmount,
            memoText
        );
        process.stdout.write(`✅ Сделка создана для теста разрешения\n`);

        // Шаг 2: финансирование сделки
        await contract.sendFundDeal(
            buyerWallet.getSender(),
            memoText,
            toNano("2.1")
        );
        process.stdout.write(`💰 Сделка профинансирована для теста разрешения\n`);

        // Получаем баланс продавца до разрешения сделки
        const sellerBalanceBefore = await sellerWallet.getBalance();
        process.stdout.write(`Seller balance BEFORE resolution: ${sellerBalanceBefore.toString()}\n`);

        // Шаг 3: разрешение сделки в пользу продавца (approvePayment = true)
        const resolveResult = await contract.sendResolveDeal(
            moderatorWallet.getSender(),
            memoText,
            true  // разрешаем платеж в пользу продавца
        );
        expect(resolveResult.transactions).toHaveTransaction({
            from: moderatorWallet.address,
            to: contract.address,
            success: true,
            op: 2,
        });
        process.stdout.write(`✅ Сделка разрешена в пользу продавца\n`);

        // Получаем баланс продавца после разрешения сделки
        const sellerBalanceAfter = await sellerWallet.getBalance();
        process.stdout.write(`Seller balance AFTER resolution: ${sellerBalanceAfter.toString()}\n`);

        // Проверяем, что продавец получил как минимум сумму сделки
        expect(sellerBalanceAfter - sellerBalanceBefore).toBeGreaterThanOrEqual(dealAmount);
    });
});
