import { Address, beginCell, toNano } from "ton-core";
import { compile } from "@ton-community/blueprint";
import { Blockchain, SandboxContract, TreasuryContract } from "@ton-community/sandbox";
import { P2P } from "../wrappers/P2P";
import '@ton-community/test-utils';

describe("P2P Contract Sandbox", () => {
    let blockchain: Blockchain;
    let contract: SandboxContract<P2P>;
    let moderatorWallet: SandboxContract<TreasuryContract>;

    // Просто примеры "продавца" и "покупателя"
    const SELLER = Address.parse("0:1111000011110000111100001111000011110000111100001111000011110000");
    const BUYER  = Address.parse("0:2222000022220000222200002222000022220000222200002222000022220000");

    beforeEach(async () => {
        // 1) создаём локальный блокчейн
        blockchain = await Blockchain.create();
        blockchain.verbosity = {
            blockchainLogs: true,
            vmLogs: "vm_logs_full",
            debugLogs: true,
            print: false
        };

        // 2) создаём "модератора" (кошелёк)
        moderatorWallet = await blockchain.treasury("moderator");

        // 3) компилим P2P.fc
        const code = await compile("P2P");

        // 4) создаём экземпляр нашего контракта
        const p2pConfig = P2P.createFromConfig(moderatorWallet.address, code, 0);

        // 5) "Открываем" через sandbox
        contract = blockchain.openContract(p2pConfig);

        // 6) Деплоим
        await contract.sendDeploy(
            moderatorWallet.getSender(),
            toNano("0.05")
        );
        
        console.log("🚀 Контракт задеплоен");
    });

    it("should create a deal", async () => {
        // Тестируем создание сделки
        const dealAmount = toNano("2");
        const memoText = "1236";

        // Считаем хэш от memoCell (для интереса)
        const memoCell = beginCell().storeStringTail(memoText).endCell();
        const memoHash = memoCell.hash().toString("hex");
        console.log("🔖 Memo Hash:", memoHash);

        console.log("🏁 Контракт адрес:", contract.address.toString());
        console.log("🏁 Модератор адрес:", moderatorWallet.address.toString());

        // Получаем данные контракта до создания сделки
        const contractDataBefore = await contract.getContractData();
        console.log("📊 Данные контракта ДО:", contractDataBefore);
        
        // Проверяем, что модератор правильно инициализирован
        const moderatorAddress = await contract.getModeratorAddress();
        console.log("👮 Модератор в контракте:", moderatorAddress.toString());
        
        // Проверяем, что модератор совпадает с ожидаемым
        expect(moderatorAddress.equals(moderatorWallet.address)).toBe(true);

        // Шаг 1: создаём сделку
        const createResult = await contract.sendCreateDeal(
            moderatorWallet.getSender(),
            SELLER,                     // seller
            BUYER,                      // buyer
            dealAmount,                 // amount
            memoText                    // memo
        );
        //console.log(createResult.transactions);

        expect(createResult.transactions).toHaveTransaction({
            from: moderatorWallet.address,
            to: contract.address,
            success: true,
            op: 1,
        });
        console.log("✅ Сделка создана");

        // Получаем данные контракта после создания сделки
        const contractDataAfter = await contract.getContractData();
        console.log("📊 Данные контракта ПОСЛЕ:", contractDataAfter);

        // Получаем счётчик сделок
        const dealCounter = await contract.getDealCounter();
        console.log("📊 dealCounter =", dealCounter);

        // Проверяем существование сделки с ID 0
        try {
            const provider = blockchain.provider(contract.address);
            const dealExists = await contract.debugDealExists(provider, 0);
            console.log("🔍 Сделка с ID 0 существует:", dealExists);

            // Получаем сырые данные контракта
            const rawData = await contract.debugGetRawData(provider);
            console.log("🔄 Сырые данные контракта:", rawData);
        } catch (error) {
            console.error("❌ Ошибка при получении отладочной информации:", error);
        }

        // Проверяем getDealInfo(0)
        const infoBefore = await contract.getDealInfo(0);
        console.log("🧮 Deal Info (index=0) =", infoBefore);

        // Получаем полную информацию о сделке
        try {
            const fullDealInfo = await contract.getFullDealInfo(0);
            console.log("📋 Полная информация о сделке:", fullDealInfo);
        } catch (error) {
            console.error("❌ Ошибка при получении полной информации о сделке:", error);
        }

        // Проверяем, что счетчик сделок увеличился
        expect(dealCounter).toBe(1);

        // Тут вы можете проверить, что amount = dealAmount, funded=0
        expect(infoBefore.amount.toString()).toBe(dealAmount.toString());
        expect(infoBefore.funded).toBe(0);
    });

    it("should create and fund a deal", async () => {
        const dealAmount = toNano("2");
        const memoText = "DEAL:1";

        const buyerWallet = await blockchain.treasury("buyer");

        // Получаем данные контракта до создания сделки
        const contractDataBefore = await contract.getContractData();
        console.log("📊 Данные контракта ДО:", contractDataBefore);
        
        // Проверяем, что модератор правильно инициализирован
        const moderatorAddress = await contract.getModeratorAddress();
        console.log("👮 Модератор в контракте:", moderatorAddress.toString());
        
        // Проверяем, что модератор совпадает с ожидаемым
        expect(moderatorAddress.equals(moderatorWallet.address)).toBe(true);

        // Шаг 1: Создание сделки
        await contract.sendCreateDeal(
            moderatorWallet.getSender(),
            SELLER,
            BUYER,
            dealAmount,
            memoText
        );
        console.log("✅ Сделка создана");

        // Получаем данные контракта после создания сделки
        const contractDataAfterCreate = await contract.getContractData();
        console.log("📊 Данные контракта ПОСЛЕ создания:", contractDataAfterCreate);

        const dealCounterAfterCreate = await contract.getDealCounter();
        console.log("📈 Deal counter после создания:", dealCounterAfterCreate);

        // Получаем информацию о сделке до финансирования
        const dealInfoBeforeFunding = await contract.getDealInfo(0);
        console.log("📦 Данные сделки ДО финансирования:", {
            amount: dealInfoBeforeFunding.amount.toString(),
            funded: dealInfoBeforeFunding.funded
        });

        // Получаем полную информацию о сделке до финансирования
        const fullDealInfoBeforeFunding = await contract.getFullDealInfo(0);
        console.log("📋 Полная информация о сделке ДО финансирования:", fullDealInfoBeforeFunding);

        // Шаг 2: Финансирование сделки
        await contract.sendFundDeal(
            buyerWallet.getSender(),
            memoText,
            toNano("2.1") // чуть больше, чтобы учесть комиссию
        );
        console.log("💰 Сделка профинансирована");

        // Получаем данные контракта после финансирования сделки
        const contractDataAfterFunding = await contract.getContractData();
        console.log("📊 Данные контракта ПОСЛЕ финансирования:", contractDataAfterFunding);

        // Шаг 3: Проверка состояния сделки
        const dealInfo = await contract.getDealInfo(0);
        console.log("📦 Данные сделки ПОСЛЕ финансирования:", {
            amount: dealInfo.amount.toString(),
            funded: dealInfo.funded
        });

        // Получаем полную информацию о сделке после финансирования
        const fullDealInfoAfterFunding = await contract.getFullDealInfo(0);
        console.log("📋 Полная информация о сделке ПОСЛЕ финансирования:", fullDealInfoAfterFunding);

        expect(dealInfo.amount.toString()).toBe(dealAmount.toString());
        expect(dealInfo.funded).toBe(1);
    });
});
