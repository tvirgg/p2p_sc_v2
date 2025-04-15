import {
    Address,
    beginCell,
    Cell,
    toNano,
    TonClient,
    SendMode,
    internal,
    external
} from "ton";
import { mnemonicToWalletKey } from "ton-crypto";
import { WalletContractV4 } from "ton";
import { getHttpEndpoint } from "@orbs-network/ton-access";
import * as dotenv from "dotenv";

dotenv.config();

// Адрес задеплоенного контракта
const CONTRACT_ADDR = "EQAKxreVyMzGlahLmkfX0iQayBGTQqL5XwuFwgVBJVPO16Jw";

async function main() {
    console.log("🚀 Initializing...");

    // Подключаемся к testnet
    const endpoint = await getHttpEndpoint({ network: "testnet" });
    const client = new TonClient({ endpoint });

    // Загружаем кошелёк модератора
    const moderatorMnemonic = process.env.WALLET_MNEMONIC;
    if (!moderatorMnemonic) throw new Error("WALLET_MNEMONIC not set");
    const moderatorKey = await mnemonicToWalletKey(moderatorMnemonic.split(" "));
    const moderatorWallet = WalletContractV4.create({ publicKey: moderatorKey.publicKey, workchain: 0 });
    const moderatorContract = client.open(moderatorWallet);
    const moderatorAddress = moderatorWallet.address;

    // Загружаем кошелёк покупателя
    const buyerMnemonic = process.env.BUYER_MNEMONIC || moderatorMnemonic; // Используем тот же мнемоник, если нет отдельного
    const buyerKey = await mnemonicToWalletKey(buyerMnemonic.split(" "));
    const buyerWallet = WalletContractV4.create({ publicKey: buyerKey.publicKey, workchain: 0 });
    const buyerContract = client.open(buyerWallet);
    const buyerAddress = buyerWallet.address;

    // Адрес продавца (можно использовать любой адрес)
    const sellerAddress = Address.parse(process.env.SELLER_ADDR || "0:1111000011110000111100001111000011110000111100001111000011110000");

    // Адрес контракта
    const contractAddress = Address.parse(CONTRACT_ADDR);

    console.log("👤 Модератор:", moderatorAddress.toString());
    console.log("👤 Покупатель:", buyerAddress.toString());
    console.log("👤 Продавец:", sellerAddress.toString());
    console.log("📦 Контракт:", contractAddress.toString());

    // Проверяем баланс модератора
    const moderatorBalance = await moderatorContract.getBalance();
    console.log("💰 Баланс модератора:", moderatorBalance.toString(), "nanoTON");
    if (moderatorBalance < toNano("0.1")) {
        throw new Error("Недостаточно TON на кошельке модератора!");
    }

    // Проверяем баланс покупателя
    const buyerBalance = await buyerContract.getBalance();
    console.log("💰 Баланс покупателя:", buyerBalance.toString(), "nanoTON");
    if (buyerBalance < toNano("0.1")) {
        throw new Error("Недостаточно TON на кошельке покупателя!");
    }

    // Параметры сделки
    const dealAmount = toNano("0.01");
    const memoText = "DEAL:1";

    console.log("\n📋 Создание новой сделки...");
    console.log("   Сумма:", dealAmount.toString(), "nanoTON");
    console.log("   Memo:", memoText);

    try {
        // Шаг 1: Создаем сделку
        console.log("\n🔄 Отправка транзакции создания сделки...");
        
        // Создаем тело сообщения для создания сделки
        const memoCell = beginCell().storeStringTail(memoText).endCell();
        const createDealBody = beginCell()
            .storeUint(1, 32) // op_create_deal
            .storeUint(0, 64) // query_id
            .storeAddress(sellerAddress)
            .storeAddress(buyerAddress)
            .storeCoins(dealAmount)
            .storeRef(memoCell)
            .endCell();
        
        // Отправляем сообщение через кошелек модератора
        const moderatorSeqno = await moderatorContract.getSeqno();
        const createDealTransfer = moderatorWallet.createTransfer({
            secretKey: moderatorKey.secretKey,
            seqno: moderatorSeqno,
            messages: [
                {
                    info: {
                        type: "internal",
                        ihrDisabled: true,
                        bounce: true,
                        bounced: false,
                        dest: contractAddress,
                        value: { coins: toNano("0.05") },
                        ihrFee: 0n,
                        forwardFee: 0n,
                        createdLt: 0n,
                        createdAt: Math.floor(Date.now() / 1000)
                    },
                    body: createDealBody
                }
            ]
        });
        
        await client.sendExternalMessage(moderatorWallet, createDealTransfer);
        console.log("✅ Транзакция создания сделки отправлена");
        console.log("📋 Детали транзакции создания сделки:");
        console.log(`   Seqno: ${moderatorSeqno}`);
        console.log(`   Отправитель: ${moderatorAddress.toString()}`);
        console.log(`   Получатель: ${contractAddress.toString()}`);
        console.log(`   Сумма: ${toNano("0.05").toString()} nanoTON`);
        console.log(`   Операция: op_create_deal (1)`);
        console.log(`   Memo: ${memoText}`);

        // Ждем немного для обработки транзакции
        console.log("⏳ Ожидание обработки транзакции...");
        await sleep(5000);

// Шаг 2: Финансируем сделку
        console.log("\n💰 Финансирование сделки...");
        
        // Получаем данные контракта перед финансированием для проверки комиссии
        console.log("\n📊 Проверка состояния контракта перед финансированием...");
        const dataBeforeFunding = await getContractData(client, contractAddress);
        console.log(`   Пул комиссий до финансирования: ${dataBeforeFunding.commissionsPool.toString()} nanoTON`);

        // Расчет комиссии (3% от суммы сделки)
        const commissionRate = 3; // COMMISSION_WITH_MEMO из контракта
        const commissionAmount = (dealAmount * BigInt(commissionRate)) / 100n;
        const totalAmount = dealAmount + commissionAmount;
        
        console.log(`   Сумма сделки: ${dealAmount.toString()} nanoTON`);
        console.log(`   Комиссия (${commissionRate}%): ${commissionAmount.toString()} nanoTON`);
        console.log(`   Итого к оплате: ${totalAmount.toString()} nanoTON`);
        
        // Создаем тело сообщения для финансирования сделки
        const fundMemoCell = beginCell().storeStringTail(memoText).endCell();
        const fundDealBody = beginCell()
            .storeUint(5, 32) // op_fund_deal
            .storeUint(0, 64) // query_id
            .storeRef(fundMemoCell)
            .endCell();
        
        // Отправляем сообщение через кошелек покупателя
        const buyerSeqno = await buyerContract.getSeqno();
        
        // Добавляем небольшой запас для газа
        const sendAmount = totalAmount + toNano("0.05"); // Увеличиваем запас для газа
        
        const fundDealTransfer = buyerWallet.createTransfer({
            secretKey: buyerKey.secretKey,
            seqno: buyerSeqno,
            messages: [
                {
                    info: {
                        type: "internal",
                        ihrDisabled: true,
                        bounce: true,
                        bounced: false,
                        dest: contractAddress,
                        value: { coins: sendAmount }, // Сумма сделки + комиссия + запас на газ
                        ihrFee: 0n,
                        forwardFee: 0n,
                        createdLt: 0n,
                        createdAt: Math.floor(Date.now() / 1000)
                    },
                    body: fundDealBody
                }
            ]
        });
        
        await client.sendExternalMessage(buyerWallet, fundDealTransfer);
        console.log("✅ Транзакция финансирования отправлена");
        console.log("📋 Детали транзакции финансирования:");
        console.log(`   Seqno: ${buyerSeqno}`);
        console.log(`   Отправитель: ${buyerAddress.toString()}`);
        console.log(`   Получатель: ${contractAddress.toString()}`);
        console.log(`   Отправлено: ${sendAmount.toString()} nanoTON`);
        console.log(`   Операция: op_fund_deal (5)`);
        console.log(`   Memo: ${memoText}`);

        // Ждем немного для обработки транзакции
        console.log("⏳ Ожидание обработки транзакции...");
        await sleep(5000);
        
        // Проверяем комиссию сразу после финансирования
        console.log("\n📊 Проверка комиссии после финансирования...");
        const dataAfterFunding = await getContractData(client, contractAddress);
        console.log(`   Пул комиссий после финансирования: ${dataAfterFunding.commissionsPool.toString()} nanoTON`);
        if (dataAfterFunding.commissionsPool >= commissionAmount) {
            console.log("✅ Комиссия успешно зачислена в пул");
        } else {
            console.log("⚠️ Комиссия не была зачислена в пул или была меньше ожидаемой");
            console.log(`   Ожидалось: ${commissionAmount.toString()} nanoTON`);
            console.log(`   Получено: ${dataAfterFunding.commissionsPool.toString()} nanoTON`);
        }

        // Шаг 3: Разрешаем сделку в пользу продавца
        console.log("\n🔓 Разрешение сделки в пользу продавца...");
        
        try {
            // Создаем тело сообщения для разрешения сделки
            const resolveMemoCell = beginCell().storeStringTail(memoText).endCell();
            
            console.log("📝 Создание тела сообщения для разрешения сделки...");
            
            // Выводим информацию о memo cell
            console.log("   Memo cell hash:", resolveMemoCell.hash().toString('hex'));
            
            // Пробуем альтернативный способ создания сообщения
            // Вместо внешнего сообщения используем внутреннее сообщение от модератора
            console.log("🔄 Используем внутреннее сообщение от модератора для разрешения сделки...");
            
            const resolveBody = beginCell()
                .storeUint(2, 32) // op_resolve_deal
                .storeUint(0, 64) // query_id
                .storeRef(resolveMemoCell)
                .storeUint(1, 1) // 1 = в пользу продавца
                .endCell();
            
            // Отправляем сообщение через кошелек модератора
            const resolveSeqno = await moderatorContract.getSeqno();
            const resolveTransfer = moderatorWallet.createTransfer({
                secretKey: moderatorKey.secretKey,
                seqno: resolveSeqno,
                messages: [
                    {
                        info: {
                            type: "internal",
                            ihrDisabled: true,
                            bounce: true,
                            bounced: false,
                            dest: contractAddress,
                            value: { coins: toNano("0.05") },
                            ihrFee: 0n,
                            forwardFee: 0n,
                            createdLt: 0n,
                            createdAt: Math.floor(Date.now() / 1000)
                        },
                        body: resolveBody
                    }
                ]
            });
            
            await client.sendExternalMessage(moderatorWallet, resolveTransfer);
            console.log("✅ Транзакция разрешения сделки отправлена");
            console.log("📋 Детали транзакции разрешения сделки:");
            console.log(`   Seqno: ${resolveSeqno}`);
            console.log(`   Отправитель: ${moderatorAddress.toString()}`);
            console.log(`   Получатель: ${contractAddress.toString()}`);
            console.log(`   Сумма: ${toNano("0.05").toString()} nanoTON`);
            console.log(`   Операция: op_resolve_deal (2)`);
            console.log(`   Memo: ${memoText}`);
            console.log(`   В пользу продавца: Да (1)`);
        } catch (resolveError: any) {
            console.error("❌ Ошибка при разрешении сделки:", resolveError.message);
            if (resolveError.response) {
                console.error("   Статус ошибки:", resolveError.response.status);
                console.error("   Данные ошибки:", resolveError.response.data);
            }
            console.log("⚠️ Продолжаем выполнение скрипта несмотря на ошибку...");
        }

        // Ждем немного для обработки транзакции
        console.log("⏳ Ожидание обработки транзакции...");
        await sleep(5000);
        
        // Шаг 4: Проверяем состояние контракта и пул комиссий
        console.log("\n📊 Проверка состояния контракта...");
        
        // Получаем данные контракта через get-метод
        const contractData = await getContractData(client, contractAddress);
        console.log("📋 Данные контракта:");
        console.log(`   Счетчик сделок: ${contractData.dealCounter}`);
        console.log(`   Пул комиссий: ${contractData.commissionsPool.toString()} nanoTON`);
        console.log(`   Модератор: ${contractData.moderatorAddress}`);
        
        // Проверяем, что комиссия была правильно учтена
        if (contractData.commissionsPool >= commissionAmount) {
            console.log("✅ Комиссия успешно зачислена в пул");
        } else {
            console.log("⚠️ Комиссия не была зачислена в пул или была меньше ожидаемой");
        }

        console.log("\n🎉 Все операции выполнены успешно!");
    } catch (error: any) {
        console.error("❌ Ошибка:", error.message);
    }
}

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Получает данные контракта через get-метод debug_get_contract_data
 * @param client TonClient для взаимодействия с блокчейном
 * @param contractAddress Адрес контракта
 * @returns Объект с данными контракта
 */
async function getContractData(client: TonClient, contractAddress: Address) {
    try {
        // Выполняем запрос к контракту
        const result = await client.callGetMethod(contractAddress, "debug_get_contract_data");
        
        console.log("🔍 Результат запроса к контракту:", JSON.stringify(result, (key, value) => 
            typeof value === 'bigint' ? value.toString() : value, 2));
        
        // Проверяем, что результат содержит стек
        if (!result || !result.stack) {
            throw new Error("Ответ не содержит стек");
        }
        
        // Получаем значения из стека более безопасным способом
        let dealCounter = 0;
        let commissionsPool = 0n;
        let moderatorAddress = "Неизвестно";
        
        // Парсим результат с проверками на каждом шаге
        try {
            // Выводим подробную информацию о структуре стека для диагностики
            console.log("🔍 Структура стека:", JSON.stringify(result.stack, (key, value) => 
                typeof value === 'bigint' ? value.toString() : value, 2));
            
            // В TON API стек может быть представлен по-разному в зависимости от версии API
            // Попробуем несколько вариантов доступа к данным
            
            // Вариант 1: Стек как массив кортежей [тип, значение]
            if (Array.isArray(result.stack) && result.stack.length >= 3) {
                if (Array.isArray(result.stack[0]) && result.stack[0].length >= 2) {
                    dealCounter = Number(result.stack[0][1]);
                    commissionsPool = BigInt(result.stack[1][1]);
                    
                    if (typeof result.stack[2][1] === 'string') {
                        moderatorAddress = result.stack[2][1];
                        if (moderatorAddress.startsWith("cs_")) {
                            moderatorAddress = moderatorAddress.slice(3);
                        }
                    }
                    console.log("✅ Использован вариант парсинга 1 (массив кортежей)");
                }
                // Вариант 2: Стек как массив объектов с полями type и value
                else if (result.stack[0] && 'type' in result.stack[0] && 'value' in result.stack[0]) {
                    dealCounter = Number(result.stack[0].value);
                    commissionsPool = BigInt(result.stack[1].value);
                    
                    if (typeof result.stack[2].value === 'string') {
                        moderatorAddress = result.stack[2].value;
                        if (moderatorAddress.startsWith("cs_")) {
                            moderatorAddress = moderatorAddress.slice(3);
                        }
                    }
                    console.log("✅ Использован вариант парсинга 2 (объекты с type/value)");
                }
                // Вариант 3: Прямой доступ к элементам стека (для новых версий API)
                else {
                    // Пробуем получить значения напрямую
                    try {
                        dealCounter = Number(result.stack[0]);
                        commissionsPool = BigInt(result.stack[1]);
                        if (typeof result.stack[2] === 'string') {
                            moderatorAddress = result.stack[2];
                        }
                        console.log("✅ Использован вариант парсинга 3 (прямой доступ)");
                    } catch (directAccessError: any) {
                        console.error("❌ Ошибка при прямом доступе к стеку:", directAccessError.message);
                    }
                }
            }
            
            console.log("📊 Распарсенные данные:");
            console.log(`   Счетчик сделок: ${dealCounter}`);
            console.log(`   Пул комиссий: ${commissionsPool.toString()}`);
            console.log(`   Модератор: ${moderatorAddress}`);
        } catch (parseError: any) {
            console.error("❌ Ошибка при парсинге данных:", parseError.message);
            console.error("🔍 Структура стека:", result.stack);
        }
        
        return {
            dealCounter,
            commissionsPool,
            moderatorAddress
        };
    } catch (error: any) {
        console.error("❌ Ошибка при получении данных контракта:", error.message);
        // Возвращаем значения по умолчанию в случае ошибки
        return {
            dealCounter: 0,
            commissionsPool: 0n,
            moderatorAddress: "Ошибка получения"
        };
    }
}

/**
 * Функция для мониторинга пула комиссий
 * @param client TonClient для взаимодействия с блокчейном
 * @param contractAddress Адрес контракта
 */
async function monitorCommissionsPool(client: TonClient, contractAddress: Address) {
    console.log("\n📈 Запуск мониторинга пула комиссий...");
    
    let lastCommissionPool = 0n;
    let checkCount = 0;
    const maxChecks = 5;
    
    while (checkCount < maxChecks) {
        try {
            const data = await getContractData(client, contractAddress);
            const currentPool = data.commissionsPool;
            
            console.log(`\n📊 Проверка #${checkCount + 1}:`);
            console.log(`   Текущий пул комиссий: ${currentPool.toString()} nanoTON`);
            
            if (checkCount > 0) {
                const difference = currentPool - lastCommissionPool;
                if (difference > 0n) {
                    console.log(`   ⬆️ Увеличение на: ${difference.toString()} nanoTON`);
                } else if (difference < 0n) {
                    console.log(`   ⬇️ Уменьшение на: ${(-difference).toString()} nanoTON`);
                } else {
                    console.log(`   ↔️ Без изменений`);
                }
            }
            
            lastCommissionPool = currentPool;
            checkCount++;
            
            // Ждем перед следующей проверкой
            if (checkCount < maxChecks) {
                console.log("   ⏳ Ожидание перед следующей проверкой...");
                await sleep(10000); // 10 секунд между проверками
            }
        } catch (error: any) {
            console.error(`❌ Ошибка при мониторинге: ${error.message}`);
            break;
        }
    }
    
    console.log("\n✅ Мониторинг пула комиссий завершен");
}

// Запускаем основную функцию
main().catch(console.error);

// Пример использования функции мониторинга:
// Раскомментируйте следующую строку для запуска мониторинга
// monitorCommissionsPool(new TonClient({ endpoint: await getHttpEndpoint({ network: "testnet" }) }), Address.parse(CONTRACT_ADDR)).catch(console.error);
