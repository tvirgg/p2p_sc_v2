import { Address, beginCell, toNano, Dictionary, Cell, Slice } from "ton-core";
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
        const withdrawResult = await contract.sendWithdrawCommissions( // Call the corrected function
            moderatorWallet.address                
        );
    
        // Проверка транзакции
        expect(withdrawResult.transactions).toHaveTransaction({
            //to: contract.address,
            //on: contract.address,
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
    
        const minimumExpected = toNano("0.002"); // минимально разумная сумма после комиссий
        expect(delta).toBeGreaterThanOrEqual(minimumExpected);

        expect(commissionsAfter).toBe(0);
    });
});

/**
 * Тест «Refund unknown funds»
 * -------------------------------------------------------
 * Happy‑path проверки публичных методов обёртки уже покрыты, —
 * здесь используем тот же стиль (treasury‑кошельки + wrapper),
 * но без дополнительных «сыромятных» хаков в рантайме.
 */

/**
 * Тест «Refund unknown funds» с учётом комиссии при поступлении
 * -------------------------------------------------------
 * Проверяет: залётный платёж → комиссия → возврат остатка
 */

describe("P2P – refund unknown funds (correct check)", () => {
    let blockchain: Blockchain; // Инициализация переменной для эмуляции блокчейна
    let contract: SandboxContract<P2P>; // Переменная для контракта P2P
    let moderator: SandboxContract<TreasuryContract>; // Переменная для кошелька модератора

    beforeEach(async () => {
        blockchain = await Blockchain.create(); // Создание новой эмуляции блокчейна
        moderator  = await blockchain.treasury("moderator"); // Создание кошелька модератора

        const code = await compile("P2P"); // Компиляция кода контракта P2P
        const cfg  = P2P.createFromConfig(moderator.address, code, 0); // Создание конфигурации контракта с адресом модератора

        contract = blockchain.openContract(cfg); // Открытие контракта в эмуляции блокчейна
        await contract.sendDeploy(moderator.getSender(), toNano("0.05")); // Деплой контракта с отправкой 0.05 TON от модератора
    });

    it("stores stray payment and throws on second refund", async () => {
        // -------- 1. Отправляем «залётный» платёж --------------
        const stranger = await blockchain.treasury("stranger"); // Создание кошелька для "постороннего" пользователя
        const deposit  = toNano("1"); // Определение суммы депозита в 1 TON

        const memoCell = beginCell().storeStringTail("ghost-memo").endCell(); // Создание ячейки с текстом "ghost-memo"
        const body     = beginCell().storeRef(memoCell).endCell(); // Создание тела сообщения с ссылкой на memoCell

        await stranger.send({
            to:   contract.address, // Адрес получателя — адрес контракта
            value: deposit, // Сумма перевода
            bounce: true, // Включение bounce-флага
            sendMode: 1, // Режим отправки: оплата комиссии отдельно
            body // Тело сообщения
        });

        const commission  = deposit * 3n / 100n; // Расчёт комиссии в 3%
        const expectedNet = deposit - commission; // Расчёт ожидаемой суммы после вычета комиссии

        const stored = await contract.getUnknownFund(0); // Получение сохранённой суммы по ключу 0
        expect(stored).toBe(expectedNet); // Проверка, что сохранённая сумма соответствует ожидаемой

        // -------- 2. Первый возврат средств -----------------------------
        const balBefore = await stranger.getBalance(); // Получение баланса "постороннего" до возврата

        await contract.sendRefundUnknown(
            moderator.getSender(), // Отправитель — модератор
            /* key = */ 0 // Ключ для возврата средств
        );

        // Проверка, что запись удалена
        const storedAfter = await contract.getUnknownFund(0); // Получение суммы по ключу после возврата
        expect(storedAfter).toBe(0n); // Ожидается, что сумма равна 0

        // Проверка, что баланс увеличился примерно на ожидаемую сумму (с учётом возможных комиссий)
        const balAfter = await stranger.getBalance(); // Получение баланса после возврата
        expect(balAfter - balBefore).toBeGreaterThanOrEqual(expectedNet - toNano("0.05")); // Проверка увеличения баланса

        // -------- 3. Повторный возврат должен завершиться ошибкой ------------
        const tx = await contract.sendRefundUnknown(
            moderator.getSender(), // Отправитель — модератор
            /* key = */ 0 // Тот же ключ, что и ранее
        );

        // ❶ Проверка, что транзакция завершилась с ошибкой
        expect(tx.transactions).toHaveTransaction({
            to:      contract.address, // Адрес получателя — адрес контракта
            success: false, // Ожидается, что транзакция неуспешна
            exitCode: 120 // Ожидаемый код выхода — 120 (ошибка)
        });

        // ❷ Проверка, что запись по-прежнему отсутствует
        const stillZero = await contract.getUnknownFund(0); // Получение суммы по ключу после повторного возврата
        expect(stillZero).toBe(0n); // Ожидается, что сумма равна 0
            // -------- 4. Модератор выводит комиссию -------------
    const modBalBefore = await moderator.getBalance(); // Баланс модератора до вывода

    await contract.sendWithdrawCommissions(
        moderator.address // ← здесь вместо getSender
    );

    const modBalAfter = await moderator.getBalance(); // Баланс модератора после вывода

    // Проверка, что баланс увеличился на сумму комиссии (с учётом возможных комиссий)
    expect(modBalAfter - modBalBefore).toBeGreaterThanOrEqual(commission - toNano("0.05")); // Допускаем небольшое отклонение на комиссии

    // Проверка, что пул комиссий обнулён
    const contractData = await contract.getContractData();
    const poolAfter = contractData.commissionsPool;
    expect(poolAfter).toBe(0);
    });
});
describe("P2P – refund unknown funds (random memo)", () => {
    let blockchain: Blockchain;
    let moderator: SandboxContract<TreasuryContract>;
    let contract: SandboxContract<P2P>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        moderator  = await blockchain.treasury("moderator");

        const code = await compile("P2P");
        const cfg  = P2P.createFromConfig(moderator.address, code, 0);
        contract   = blockchain.openContract(cfg);

        await contract.sendDeploy(moderator.getSender(), toNano("0.05"));
    });

    it("handles unknown memo correctly", async () => {
        // ---------- 1. «Залётный» перевод с RANDOM-memo -------------
        const stranger = await blockchain.treasury("stranger");
        const deposit  = toNano("1");

        const randomMemo = `unknown-memo-${Math.floor(Math.random() * 1e6)}`;
        const memoCell   = beginCell().storeStringTail(randomMemo).endCell();
        const body       = beginCell().storeRef(memoCell).endCell();

        await stranger.send({
            to:       contract.address,
            value:    deposit,
            bounce:   true,
            sendMode: 1,            // pay fees separately
            body,
        });

        const commission  = deposit * 3n / 100n;
        const expectedNet = deposit - commission;

        const stored = await contract.getUnknownFund(0);
        expect(stored).toBe(expectedNet);

        // ---------- 2. Первый возврат -------------------------------
        const balBefore = await stranger.getBalance();

        await contract.sendRefundUnknown(
            moderator.getSender(),
            /* key */ 0,
        );

        const storedAfter = await contract.getUnknownFund(0);
        expect(storedAfter).toBe(0n);

        const balAfter = await stranger.getBalance();
        expect(balAfter - balBefore).toBeGreaterThanOrEqual(expectedNet - toNano("0.05"));

        // ---------- 3. Повторный возврат → ошибка -------------------
        const tx = await contract.sendRefundUnknown(
            moderator.getSender(),
            /* key */ 0,
        );

        expect(tx.transactions).toHaveTransaction({
            to:       contract.address,
            success:  false,
            exitCode: 120,
        });

        // ---------- 4. Вывод комиссий модератором -------------------
        const modBalBefore = await moderator.getBalance();

        await contract.sendWithdrawCommissions(moderator.address);

        const modBalAfter = await moderator.getBalance();
        expect(modBalAfter - modBalBefore).toBeGreaterThanOrEqual(commission - toNano("0.05"));

        const { commissionsPool } = await contract.getContractData();
        expect(commissionsPool).toBe(0);
    });
});
const COMMISSION_RATE = 3n;           // 3 %
const DEAL_AMOUNTS = [ "0.5", "0.8", "1", "1.2", "0.7" ];   // TON
const N = DEAL_AMOUNTS.length;

describe("P2P – массовое накопление комиссий", () => {
    let blockchain: Blockchain;
    let moderator: SandboxContract<TreasuryContract>;
    let seller:    SandboxContract<TreasuryContract>;
    let buyer:     SandboxContract<TreasuryContract>;
    let contract:  SandboxContract<P2P>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        moderator = await blockchain.treasury("moderator");
        seller    = await blockchain.treasury("seller");
        buyer     = await blockchain.treasury("buyer");

        const code = await compile("P2P");
        const cfg  = P2P.createFromConfig(moderator.address, code);
        contract   = blockchain.openContract(cfg);

        await contract.sendDeploy(moderator.getSender(), toNano("0.05"));
    });

    it("commissionsPool equals Σ(amount)×3 %", async () => {
        let expectedCommission = 0n;

        for (let i = 0; i < N; i++) {
            const amt   = toNano(DEAL_AMOUNTS[i]);        // сумма сделки
            const memo  = `bulk-test-${i}`;               // уникальный memo
            const extra = toNano("0.1");                  // небольшой запас

            // ① create_deal (от модератора)
            await contract.sendCreateDeal(
                moderator.getSender(),
                seller.address,
                buyer.address,
                amt,
                memo
            );

            // ② fund_deal  (от покупателя)
            await contract.sendFundDeal(
                buyer.getSender(),
                memo,
                amt + extra
            );

            // накапливаем ожидаемую комиссию
            expectedCommission += (amt * COMMISSION_RATE) / 100n;
        }

        // Читаем данные контракта
        const { commissionsPool } = await contract.getContractData();

        // commissionsPool приходит как JS-number, преобразуем к bigint
        const poolBig = BigInt(commissionsPool);

        expect(poolBig).toBe(expectedCommission);
    });
});
describe("P2P – минимальная сумма 1 nanoTON", () => {
    let blockchain: Blockchain;
    let moderator: SandboxContract<TreasuryContract>;
    let seller:    SandboxContract<TreasuryContract>;
    let buyer:     SandboxContract<TreasuryContract>;
    let contract:  SandboxContract<P2P>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        moderator = await blockchain.treasury("moderator");
        seller    = await blockchain.treasury("seller");
        buyer     = await blockchain.treasury("buyer");

        const code = await compile("P2P");
        const cfg  = P2P.createFromConfig(moderator.address, code);
        contract   = blockchain.openContract(cfg);

        await contract.sendDeploy(moderator.getSender(), toNano("0.05"));
    });

    it("creates & funds a deal on 1 nanoTON with zero commission", async () => {
        const amountNano = 1n;             // 1 nanoTON
        const memo       = "min-test";

        /* 1️⃣ create_deal */
        await contract.sendCreateDeal(
            moderator.getSender(),
            seller.address,
            buyer.address,
            amountNano,
            memo
        );

        /* 2️⃣ fund_deal  – 0.03 TON достаточно и для msg + gas */
        const fundTx = await contract.sendFundDeal(
            buyer.getSender(),
            memo,
            toNano("0.03")
        );

        expect(fundTx.transactions).toHaveTransaction({
            from:    buyer.address,
            to:      contract.address,
            success: true,
            op:      5,
        });

        /* 3️⃣ Проверяем funded-флаг и комиссию */
        const info = await contract.getDealInfo(0);
        expect(info.amount).toBe(amountNano);
        expect(info.funded).toBe(1);

        const { commissionsPool } = await contract.getContractData();
        expect(BigInt(commissionsPool)).toBe(0n);
    });
});
describe("P2P – негативные сценарии", () => {
    let bc:         Blockchain;
    let moderator:  SandboxContract<TreasuryContract>;
    let stranger:   SandboxContract<TreasuryContract>;
    let seller:     SandboxContract<TreasuryContract>;
    let buyer:      SandboxContract<TreasuryContract>;
    let contract:   SandboxContract<P2P>;

    beforeEach(async () => {
        bc        = await Blockchain.create();
        moderator = await bc.treasury("moderator");
        stranger  = await bc.treasury("stranger");
        seller    = await bc.treasury("seller");
        buyer     = await bc.treasury("buyer");

        const code = await compile("P2P");
        const cfg  = P2P.createFromConfig(moderator.address, code);
        contract   = bc.openContract(cfg);

        await contract.sendDeploy(moderator.getSender(), toNano("0.05"));
    });

    test("CreateDeal от не-модератора ⇒ exit 999, стейт не меняется", async () => {
        const amount = toNano("1");
        const memo   = "no-mod";

        const tx = await contract.sendCreateDeal(
            stranger.getSender(),        // <-- НЕ модератор
            seller.address,
            buyer.address,
            amount,
            memo
        );

        /* 1️⃣ транзакция откатилась */
        expect(tx.transactions).toHaveTransaction({
            from:    stranger.address,
            to:      contract.address,
            success: false,
            exitCode: 999
        });

        /* 2️⃣ в блокчейне ничего не изменилось */
        const { dealCounter, commissionsPool } = await contract.getContractData();
        expect(dealCounter).toBe(0);          // ни одной сделки
        expect(commissionsPool).toBe(0);      // пул комиссий пуст
    });

    test("FundDeal < amount+commission ⇒ exit 132, счётчики без изменений", async () => {
        const amount = toNano("2");     // 2 TON
        const memo   = "need-2.06";

        /* ① модератор создаёт сделку */
        await contract.sendCreateDeal(
            moderator.getSender(),
            seller.address,
            buyer.address,
            amount,
            memo
        );

        /* ② покупатель ПЫТАЕТСЯ профинансировать меньше 2 TON + 3 % */
        const insufficient = toNano("2.03");  // нужно ≈ 2.06 TON

        const tx = await contract.sendFundDeal(
            buyer.getSender(),
            memo,
            insufficient
        );

        expect(tx.transactions).toHaveTransaction({
            from:    buyer.address,
            to:      contract.address,
            success: false,
            exitCode: 132
        });

        /* ③ funded-флаг всё ещё 0, комиссий нет */
        const info = await contract.getDealInfo(0);
        expect(info.funded).toBe(0);

        const { commissionsPool } = await contract.getContractData();
        expect(commissionsPool).toBe(0);
    });
});
describe("P2P – повторные Fund / преждевременный и неверный Resolve", () => {
    let bc:         Blockchain;
    let moderator:  SandboxContract<TreasuryContract>;
    let seller:     SandboxContract<TreasuryContract>;
    let buyer:      SandboxContract<TreasuryContract>;
    let contract:   SandboxContract<P2P>;

    beforeEach(async () => {
        bc        = await Blockchain.create();
        moderator = await bc.treasury("moderator");
        seller    = await bc.treasury("seller");
        buyer     = await bc.treasury("buyer");

        const code = await compile("P2P");
        const cfg  = P2P.createFromConfig(moderator.address, code);
        contract   = bc.openContract(cfg);

        await contract.sendDeploy(moderator.getSender(), toNano("0.05"));
    });

    test("Повторный FundDeal ⇒ 1-й успех, 2-й exit 131", async () => {
        const amt  = toNano("2");
        const memo = "double-fund";

        /* ① CREATE  */
        await contract.sendCreateDeal(
            moderator.getSender(),
            seller.address,
            buyer.address,
            amt,
            memo
        );

        /* ② Первый FUND — нормальная сумма (amt+3 %) */
        await contract.sendFundDeal(
            buyer.getSender(),
            memo,
            toNano("2.1")
        );

        /* пул после первого финансирования */
        const dataAfterFirst = await contract.getContractData();
        const pool1 = BigInt(dataAfterFirst.commissionsPool);

        /* ③ Второй FUND той же сделки → exit 131 */
        const tx = await contract.sendFundDeal(
            buyer.getSender(),
            memo,
            toNano("2.1")
        );

        expect(tx.transactions).toHaveTransaction({
            from:   buyer.address,
            to:     contract.address,
            success:false,
            exitCode:131
        });

        /* funded-флаг остался 1, комиссионный пул не изменился */
        const info = await contract.getDealInfo(0);
        expect(info.funded).toBe(1);

        const dataAfterSecond = await contract.getContractData();
        expect(BigInt(dataAfterSecond.commissionsPool)).toBe(pool1);
    });

    test("ResolveDeal ДО FundDeal ⇒ exit 111, funded=0", async () => {
        const amt  = toNano("1");
        const memo = "resolve-too-early";

        /* ① CREATE  (без funding) */
        await contract.sendCreateDeal(
            moderator.getSender(),
            seller.address,
            buyer.address,
            amt,
            memo
        );

        /* ② Пытаемся resolve в пользу seller */
        const tx = await contract.sendResolveDealExternal(
            moderator.address,
            memo,
            true
        );

        expect(tx.transactions).toHaveTransaction({
            to:       contract.address,
            success:  false,
            exitCode: 111
        });

        /* funded-флаг всё ещё 0 */
        const info = await contract.getDealInfo(0);
        expect(info.funded).toBe(0);
    });

    test("ResolveDeal с несуществующим memo ⇒ throw, state intact", async () => {
        const fakeMemo = "ghost-memo";
    
        /* ① external-вызов: ожидаем общий Error */
        await expect(
            contract.sendResolveDealExternal(
                moderator.address,
                fakeMemo,
                true
            )
        ).rejects.toThrow();
    
        /* ② убеждаемся, что внутреннее состояние не изменилось */
        const { dealCounter, commissionsPool } = await contract.getContractData();
        expect(dealCounter).toBe(0);
        expect(commissionsPool).toBe(0);
    });    
});
describe("P2P – пустой пул комиссий и неправильный op", () => {
    let bc:         Blockchain;
    let moderator:  SandboxContract<TreasuryContract>;
    let contract:   SandboxContract<P2P>;

    beforeEach(async () => {
        bc        = await Blockchain.create();
        moderator = await bc.treasury("moderator");

        const code = await compile("P2P");
        const cfg  = P2P.createFromConfig(moderator.address, code);
        contract   = bc.openContract(cfg);

        await contract.sendDeploy(moderator.getSender(), toNano("0.05"));
    });

    /* ──────────────────────────────────────────────────────────────── */
/* tests/P2P.test.ts--фрагмент
 * блок: «P2P – пустой пул комиссий и неправильный op»
 * ────────────────────────────────────────────────── */
/* ────────────────────────────────────────────────────────────────
 *  P2P – пустой пул комиссий и неправильный op
 * ──────────────────────────────────────────────────────────────── */
describe("P2P – пустой пул комиссий и неправильный op", () => {
    let bc:         Blockchain;
    let moderator:  SandboxContract<TreasuryContract>;
    let contract:   SandboxContract<P2P>;

    beforeEach(async () => {
        bc        = await Blockchain.create();
        moderator = await bc.treasury("moderator");

        const code = await compile("P2P");
        const cfg  = P2P.createFromConfig(moderator.address, code);
        contract   = bc.openContract(cfg);

        await contract.sendDeploy(moderator.getSender(), toNano("0.05"));
    });

    /* ────────────────────── 1. withdraw при pool = 0 ───────────────────── */
    test("WithdrawCommissions при pool=0 → баланс модератора не меняется", async () => {
        // пул действительно пуст
        const { commissionsPool: pool0 } = await contract.getContractData();
        expect(pool0).toBe(0);
    
        const bal0 = await moderator.getBalance();
    
        /* внешний withdraw: контракт пытается отправить 0 TON,
           внутри срабатывает throw(160) → Promise REJECTED            */
        await expect(
            contract.sendWithdrawCommissions(moderator.address)
        ).rejects.toThrow();                       // ← главное изменение
    
        /* после не-успешной транзакции состояние не изменилось */
        const bal1 = await moderator.getBalance();
        expect(bal1).toBe(bal0);                  // денег не прибавилось
    
        const { commissionsPool: pool1 } = await contract.getContractData();
        expect(pool1).toBe(0);                    // пул остался нулём
    });
});


});