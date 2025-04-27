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

    // Commented out due to failing test
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
            moderatorWallet.getSender(),  // Use getSender() to get a Sender object
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

        // Проверяем, что продавец получил как минимум сумму сделки минус комиссию
        const fee = (dealAmount * BigInt(COMMISSION_WITH_MEMO)) / 100n; // 3% commission
        const margin = toNano("0.03"); // Allowable margin for transaction fees
        // Convert all values to BigInt to ensure type compatibility
        expect(BigInt(sellerBalanceAfter) - BigInt(sellerBalanceBefore) + BigInt(margin)).toBeGreaterThanOrEqual(BigInt(dealAmount) - fee);
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
            moderatorWallet.getSender(),  // Use getSender() to get a Sender object
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
        // Convert to BigInt to ensure type compatibility
        expect(BigInt(buyerBalanceStart) - BigInt(buyerBalanceAfter)).toBeLessThanOrEqual(commission + BigInt(margin));
    });

    // Commented out due to failing test
// -------------------- tests/P2P.test.ts --------------------
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

/**
 * Проверяем обработку «залётного» платежа, возврат unknown funds
 * и вывод комиссий модератором.
 */

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
    /* --------------------------------------------------------------------------
 * Второй сценарий: случайная строка‑memo и маленький комиссионный пул
 * -------------------------------------------------------------------------*/

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

/* Глобальные константы для новых кейсов */
const DEAL_AMOUNTS   = ["0.5", "0.8", "1", "1.2", "0.7"]; // TON
const MIN_CREATE_FEE = 3_000_000n;                        // 0.003 TON
const CP_RESERVE_GAS = toNano("0.5");

/*────────────────────────── 1. Массовое создание сделок ─────────────────────────*/
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

/*────────────────────────── 2. Сделка на 1 nanoTON ─────────────────────────*/
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

/*────────────────────────── 3. Ошибки Fund / Resolve ─────────────────────────*/
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

    test("FundDeal < amount ⇒ exit 132", async () => {
        const memo = "need-2-ton";
        await contract.sendCreateDeal(
            moderator.getSender(),
            seller.address,
            buyer.address,
            toNano("2"),
            memo
        );

        const tx = await contract.sendFundDeal(
            buyer.getSender(),
            memo,
            toNano("1.99")
        );

        expect(tx.transactions).toHaveTransaction({ success: false, exitCode: 132 });
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

/*────────────────────────── 4. Повторный Fund и ранний Resolve ─────────────────────────*/
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

/*────────────────────────── 5. WithdrawCommissions при pool = 0 ─────────────────────────*/
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

/*────────────────────────── 6. Вывод комиссий (reserve 0.5 TON) ─────────────────────────*/
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
/*──────────────────── 7. Unknown Funds > UF_MAX_RECORDS  ────────────────────*/
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


describe('P2P – Micro-gas контроль', () => {
    let bc: Blockchain,
        moderator: SandboxContract<TreasuryContract>,
        sender:     SandboxContract<TreasuryContract>,
        contract:   SandboxContract<P2P>;

    /* ── bootstrap ── */
    beforeEach(async () => {
        bc = await Blockchain.create();
        bc.verbosity = {
            blockchainLogs: true,
            vmLogs:  'vm_logs_full',
            debugLogs: true,
            print:  false,
        };

        moderator = await bc.treasury('moderator');
        sender    = await bc.treasury('gas-tester', { balance: toNano('10') });

        const code = await compile('P2P');
        contract   = bc.openContract(P2P.createFromConfig(moderator.address, code));
        await contract.sendDeploy(moderator.getSender(), toNano('0.05'));
    });

    it('stray-payment gas usage ≤ 3500', async () => {
        /* 1. «Залётный» внутренний перевод без body */
        const value = toNano('0.2');            // > 0.1 TON min
        const trace = await sender.send({
            to:       contract.address,
            value,
            bounce:   true,
            sendMode: 1,                       // pay fees separately
        });

        /* 2. Ищем успешную транзакцию контракта */
        const contractAddr = contract.address.toString();    // канонический вид
        const contractTx = trace.transactions.find((tx: any) => {
            const addrString: string | undefined =
                // старый формат: строка в поле address
                (typeof tx.address === 'string' ? tx.address : undefined) ||
                // если address = Address
                (tx.address?.toString?.())                     ||
                // generic-tx  ─ dest в inbound-message
                (tx.inMessage?.info?.dest?.toString?.())       ||
                // generic-tx  ─ поле description.on
                (tx.description?.type === 'generic'
                    ? tx.description.on?.toString?.()
                    : undefined);

            return addrString === contractAddr && tx.success === true;
        });

        if (!contractTx) {
            throw new Error('Tx of contract not found in trace');
        }

        /* 3. Извлекаем gas (SDK ≥0.25 → totalGasUsed,  <0.25 → gasUsed) */
        const gasUsed: number =
              (contractTx as any).totalGasUsed   // новые версии SDK
           ?? (contractTx as any).gasUsed        // старые версии
           ?? 0;

        process.stdout.write(`💨 gasUsed = ${gasUsed}\n`);
        expect(gasUsed).toBeLessThanOrEqual(3500);
    });
});
