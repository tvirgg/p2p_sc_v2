import { Address, beginCell, toNano } from "ton-core";
import { compile } from "@ton-community/blueprint";
import { Blockchain, SandboxContract, TreasuryContract } from "@ton-community/sandbox";
import { P2P } from "../wrappers/P2P";
import '@ton-community/test-utils';

// Define constants from the contract
const COMMISSION_WITH_MEMO = 3; // 3% commission for deals with memo

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
        process.stdout.write(`🧮 Deal Info (index=0) = ${JSON.stringify({
            ...infoBefore,
            amount: infoBefore.amount
        }, (key, value) => typeof value === 'bigint' ? value.toString() : value)}\n`);
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
        const createResult = await contract.sendCreateDeal(
            moderatorWallet.getSender(),
            SELLER,
            BUYER,
            dealAmount,
            memoText
        );
        process.stdout.write(`✅ Сделка создана\n`);
        
        // Вспомогательная функция для рекурсивного вывода debug logs из всех транзакций
        function printAllDebugLogs(transaction: any): void {
            if (!transaction) return;
            
            // Вывод debug logs из текущей транзакции
            if (transaction.debugLogs) {
                process.stdout.write(`📋 DEBUG LOGS (${transaction.address || 'unknown'}):\n`);
                transaction.debugLogs.split('\n').forEach((line: string) => {
                    if (line.trim()) {
                        process.stdout.write(`    ${line}\n`);
                    }
                });
            }
            
            // Рекурсивно обрабатываем дочерние транзакции
            if (transaction.children && Array.isArray(transaction.children)) {
                transaction.children.forEach((child: any) => printAllDebugLogs(child));
            }
        }
        
        // Выводим все debug logs из иерархии транзакций
        process.stdout.write(`🔍 ВСЕ DEBUG LOGS ДЛЯ createResult:\n`);
        printAllDebugLogs(createResult);
        // Получаем данные контракта после создания сделки
        const contractDataAfterCreate = await contract.getContractData();
        process.stdout.write(`📊 Данные контракта ПОСЛЕ создания: ${JSON.stringify(contractDataAfterCreate)}\n`);

        const dealCounterAfterCreate = await contract.getDealCounter();
        process.stdout.write(`📈 Deal counter после создания: ${dealCounterAfterCreate}\n`);

        // Получаем информацию о сделке ДО финансирования
        const dealInfoBeforeFunding = await contract.getDealInfo(0);
        process.stdout.write(`📦 Данные сделки ДО финансирования: ${JSON.stringify({
            amount: dealInfoBeforeFunding.amount,
            funded: dealInfoBeforeFunding.funded
        }, (key, value) => typeof value === 'bigint' ? value.toString() : value)}\n`);

        // Получаем полную информацию о сделке ДО финансирования
        const fullDealInfoBeforeFunding = await contract.getFullDealInfo(0);
        process.stdout.write(`📋 Полная информация о сделке ДО финансирования: ${JSON.stringify(fullDealInfoBeforeFunding, (key, value) => typeof value === 'bigint' ? value.toString() : value)}\n`);

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
        process.stdout.write(`📋 Полная информация о сделке ПОСЛЕ финансирования: ${JSON.stringify(fullDealInfoAfterFunding, (key, value) => typeof value === 'bigint' ? value.toString() : value)}\n`);
    });

    it("should resolve deal in favor of seller", async () => {
        // Для данного теста создаём кошельки для продавца и покупателя,
        // чтобы можно было проверить перевод средств продавцу.
        const sellerWallet = await blockchain.treasury("seller");
        const buyerWallet = await blockchain.treasury("buyer");

        process.stdout.write(`🏁 Продавец адрес: ${sellerWallet.address.toString()}\n`);
        process.stdout.write(`🏁 Покупатель адрес: ${buyerWallet.address.toString()}\n`);
        const dealAmount = toNano("2");
        const memoText = "deal-to-seller";
        const buyerBalanceStart = await buyerWallet.getBalance();
        process.stdout.write(`Buyer balance START resolution: ${buyerBalanceStart.toString()}\n`);
        // Шаг 1: создаём сделку (в данном случае адрес продавца берём из кошелька)
        const createResult = await contract.sendCreateDeal(
            moderatorWallet.getSender(),
            sellerWallet.address,
            buyerWallet.address,
            dealAmount,
            memoText
        );
        // Вспомогательная функция для рекурсивного вывода debug logs из всех транзакций
        function extractAndPrintAllDebugLogs(obj: any, visited = new Set()): void {
            if (!obj || typeof obj !== 'object' || visited.has(obj)) return;
            visited.add(obj);
        
            if (typeof obj.debugLogs === 'string') {
                process.stdout.write(`📋 DEBUG LOGS:\n`);
                obj.debugLogs.split('\n').forEach((line: string) => {
                    if (line.trim()) {
                        process.stdout.write(`    ${line}\n`);
                    }
                });
            }
        
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    const val = obj[key];
        
                    if (Array.isArray(val)) {
                        val.forEach((child) => extractAndPrintAllDebugLogs(child, visited));
                    } else if (typeof val === 'object' && val !== null) {
                        extractAndPrintAllDebugLogs(val, visited);
                    }
                }
            }
        }
        
        // Выводим все debug logs из иерархии транзакций
        process.stdout.write(`🔍 ВСЕ DEBUG LOGS ДЛЯ createResult:\n`);
        extractAndPrintAllDebugLogs(createResult);
        
        process.stdout.write(`✅ Сделка создана для теста разрешения\n`);

        // Шаг 2: финансирование сделки
        await contract.sendFundDeal(
            buyerWallet.getSender(),
            memoText,
            toNano("2.1")
        );
        process.stdout.write(`💰 Сделка профинансирована для теста разрешения\n`);
        const buyerBalanceSend = await buyerWallet.getBalance();
        process.stdout.write(`Buyer balance AFTER SEND: ${buyerBalanceSend.toString()}\n`);
        // Получаем баланс продавца до разрешения сделки
        const sellerBalanceBefore = await sellerWallet.getBalance();
        process.stdout.write(`Seller balance BEFORE resolution: ${sellerBalanceBefore.toString()}\n`);

        // Шаг 3: разрешение сделки в пользу продавца (approvePayment = true)
        const resolveResult = await contract.sendResolveDealExternal( // Call the corrected function
            moderatorWallet.address,  // Moderator's address to be put in the message body
            memoText,                 // The crucial memo
            true                     
        );

        // Log the full resolveResult object for debugging
        if (resolveResult && Array.isArray(resolveResult.transactions) && resolveResult.transactions.length > 0) {
            // 2. Берем первую транзакцию
            const firstTransaction = resolveResult.transactions[0];
        
            // 3. Проверяем наличие debugLogs внутри этой транзакции и что значение не пустое/null/undefined
            if ('debugLogs' in firstTransaction && firstTransaction.debugLogs) {
            // 4. Выводим debugLogs из первой транзакции, каждую строку на отдельной строке
            const debugLogs = firstTransaction.debugLogs.split('\n');
            debugLogs.forEach((logLine) => {
                process.stdout.write(`📋 Debug Log Line: ${logLine}\n`);
            });
            } else {
            // Сообщение, если debugLogs отсутствует или пуст в первой транзакции
            process.stdout.write(`📋 Debug Logs: null or empty in the first transaction\n`);
            }
        } else {
            // Сообщение, если массив transactions отсутствует или пуст
            process.stdout.write(`📋 Debug Logs: No transactions found or transactions array is empty\n`);
        }
        expect(resolveResult.transactions).toHaveTransaction({
            to: contract.address,
            on: contract.address,
            success: true,
            op: 2,
        });
        process.stdout.write(`✅ Сделка разрешена в пользу продавца\n`);

        // Получаем баланс продавца после разрешения сделки
        const sellerBalanceAfter = await sellerWallet.getBalance();
        process.stdout.write(`Seller balance AFTER resolution: ${sellerBalanceAfter.toString()}\n`);
        const buyerBalanceAfter = await buyerWallet.getBalance();
        process.stdout.write(`Buyer balance AFTER resolution: ${buyerBalanceAfter.toString()}\n`);

        // Проверяем, что продавец получил как минимум сумму сделки
        const margin = toNano("0.03"); // Allowable margin for transaction fees
        expect(sellerBalanceAfter - sellerBalanceBefore + margin).toBeGreaterThanOrEqual(dealAmount);
    });
    it("should resolve deal in favor of buyer", async () => {
        // Для данного теста создаём кошельки для продавца и покупателя,
        // чтобы можно было проверить перевод средств продавцу.
        const sellerWallet = await blockchain.treasury("seller");
        const buyerWallet = await blockchain.treasury("buyer");

        process.stdout.write(`🏁 Продавец адрес: ${sellerWallet.address.toString()}\n`);
        process.stdout.write(`🏁 Покупатель адрес: ${buyerWallet.address.toString()}\n`);
        const dealAmount = toNano("2");
        const memoText = "deal-to-seller";
        const buyerBalanceStart = await buyerWallet.getBalance();
        process.stdout.write(`Buyer balance START resolution: ${buyerBalanceStart.toString()}\n`);
        // Шаг 1: создаём сделку (в данном случае адрес продавца берём из кошелька)
        const createResult = await contract.sendCreateDeal(
            moderatorWallet.getSender(),
            sellerWallet.address,
            buyerWallet.address,
            dealAmount,
            memoText
        );
        // Вспомогательная функция для рекурсивного вывода debug logs из всех транзакций
        function extractAndPrintAllDebugLogs(obj: any, visited = new Set()): void {
            if (!obj || typeof obj !== 'object' || visited.has(obj)) return;
            visited.add(obj);
        
            if (typeof obj.debugLogs === 'string') {
                process.stdout.write(`📋 DEBUG LOGS:\n`);
                obj.debugLogs.split('\n').forEach((line: string) => {
                    if (line.trim()) {
                        process.stdout.write(`    ${line}\n`);
                    }
                });
            }
        
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    const val = obj[key];
        
                    if (Array.isArray(val)) {
                        val.forEach((child) => extractAndPrintAllDebugLogs(child, visited));
                    } else if (typeof val === 'object' && val !== null) {
                        extractAndPrintAllDebugLogs(val, visited);
                    }
                }
            }
        }
        
        // Выводим все debug logs из иерархии транзакций
        process.stdout.write(`🔍 ВСЕ DEBUG LOGS ДЛЯ createResult:\n`);
        extractAndPrintAllDebugLogs(createResult);
        
        process.stdout.write(`✅ Сделка создана для теста разрешения\n`);

        // Шаг 2: финансирование сделки
        await contract.sendFundDeal(
            buyerWallet.getSender(),
            memoText,
            toNano("2.1")
        );
        process.stdout.write(`💰 Сделка профинансирована для теста разрешения\n`);
        const buyerBalanceSend = await buyerWallet.getBalance();
        process.stdout.write(`Buyer balance AFTER SEND: ${buyerBalanceSend.toString()}\n`);
        // Получаем баланс продавца до разрешения сделки
        const sellerBalanceBefore = await sellerWallet.getBalance();
        process.stdout.write(`Seller balance BEFORE resolution: ${sellerBalanceBefore.toString()}\n`);

        // Шаг 3: разрешение сделки в пользу продавца (approvePayment = true)
        const resolveResult = await contract.sendResolveDealExternal( // Call the corrected function
            moderatorWallet.address,  // Moderator's address to be put in the message body
            memoText,                 // The crucial memo
            false                     
        );

        // Log the full resolveResult object for debugging
        if (resolveResult && Array.isArray(resolveResult.transactions) && resolveResult.transactions.length > 0) {
            // 2. Берем первую транзакцию
            const firstTransaction = resolveResult.transactions[0];
        
            // 3. Проверяем наличие debugLogs внутри этой транзакции и что значение не пустое/null/undefined
            if ('debugLogs' in firstTransaction && firstTransaction.debugLogs) {
            // 4. Выводим debugLogs из первой транзакции, каждую строку на отдельной строке
            const debugLogs = firstTransaction.debugLogs.split('\n');
            debugLogs.forEach((logLine) => {
                process.stdout.write(`📋 Debug Log Line: ${logLine}\n`);
            });
            } else {
            // Сообщение, если debugLogs отсутствует или пуст в первой транзакции
            process.stdout.write(`📋 Debug Logs: null or empty in the first transaction\n`);
            }
        } else {
            // Сообщение, если массив transactions отсутствует или пуст
            process.stdout.write(`📋 Debug Logs: No transactions found or transactions array is empty\n`);
        }
        expect(resolveResult.transactions).toHaveTransaction({
            to: contract.address,
            on: contract.address,
            success: true,
            op: 2,
        });
        process.stdout.write(`✅ Сделка разрешена в пользу покупателя\n`);

        // Получаем баланс продавца после разрешения сделки
        const sellerBalanceAfter = await sellerWallet.getBalance();
        process.stdout.write(`Seller balance AFTER resolution: ${sellerBalanceAfter.toString()}\n`);
        const buyerBalanceAfter = await buyerWallet.getBalance();
        process.stdout.write(`Buyer balance AFTER resolution: ${buyerBalanceAfter.toString()}\n`);

        // Проверяем, что покупатель не потерял больше, чем комиссию + транзакционные издержки
        const commission = (dealAmount * BigInt(COMMISSION_WITH_MEMO)) / 100n; // 3% commission
        const margin = toNano("0.05"); // Allowable margin for transaction fees
        expect(buyerBalanceStart - buyerBalanceAfter).toBeLessThanOrEqual(commission + margin);
    });
    it("should allow moderator to withdraw commissions", async () => {
        const moderatorBalanceBefore = await moderatorWallet.getBalance();
        process.stdout.write(`💼 Баланс модератора ДО снятия комиссий: ${moderatorBalanceBefore.toString()}\n`);
    
        // Шаг 1: создаем сделку и финансируем ее, чтобы накопились комиссии
        const SELLER = await blockchain.treasury("seller");
        const BUYER = await blockchain.treasury("buyer");
        const memoText = "withdraw-test";
        const dealAmount = toNano("2");
    
        await contract.sendCreateDeal(
            moderatorWallet.getSender(),
            SELLER.address,
            BUYER.address,
            dealAmount,
            memoText
        );
    
        await contract.sendFundDeal(
            BUYER.getSender(),
            memoText,
            toNano("2.1") // с учетом комиссии
        );
    
        // Получаем данные контракта после финансирования
        const contractDataBeforeWithdraw = await contract.getContractData();
        const commissionsBefore = contractDataBeforeWithdraw.commissionsPool;
        process.stdout.write(`🏦 Размер пула комиссий ДО снятия: ${commissionsBefore.toString()}\n`);
        expect(commissionsBefore).toBeGreaterThan(0n);
    
        // Шаг 2: модератор снимает комиссию
        const withdrawAmount = toNano("0.03");
        const withdrawResult = await contract.sendWithdrawCommissions(
            moderatorWallet.getSender(),
            withdrawAmount
        );
    
        // Проверка транзакции
        expect(withdrawResult.transactions).toHaveTransaction({
            from: moderatorWallet.address,
            to: contract.address,
            success: true,
            op: 4,
        });
        process.stdout.write(`✅ Комиссия успешно снята модератором\n`);
    
        // Получаем данные контракта после снятия
        const contractDataAfterWithdraw = await contract.getContractData();
        const commissionsAfter = contractDataAfterWithdraw.commissionsPool;
        process.stdout.write(`🏦 Размер пула комиссий ПОСЛЕ снятия: ${commissionsAfter.toString()}\n`);
    
        // Проверка, что комиссия действительно уменьшилась
        expect(commissionsAfter).toBeLessThan(commissionsBefore);
    
        // Проверяем, что баланс модератора увеличился (с учетом возможных издержек)
        const moderatorBalanceAfter = await moderatorWallet.getBalance();
        const delta = moderatorBalanceAfter - moderatorBalanceBefore;
        process.stdout.write(`💼 Баланс модератора ПОСЛЕ: ${moderatorBalanceAfter.toString()}\n`);
        process.stdout.write(`📈 Δ Баланс: ${delta.toString()}\n`);
    
        const minimumExpected = toNano("0.01"); // допустимая разница, чтобы покрыть комиссии
        expect(delta).toBeGreaterThanOrEqual(minimumExpected);
    });    
});
