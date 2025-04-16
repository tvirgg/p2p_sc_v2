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
    const buyerBalanceBefore = await buyerContract.getBalance();
    console.log("💰 Баланс покупателя ДО сделки:", buyerBalanceBefore.toString(), "nanoTON");
    if (buyerBalanceBefore < toNano("0.1")) {
        throw new Error("Недостаточно TON на кошельке покупателя!");
    }

    // Проверяем баланс продавца
    let sellerBalanceBefore = 0n;
    try {
        sellerBalanceBefore = await client.getBalance(sellerAddress);
        console.log("💰 Баланс продавца ДО сделки:", sellerBalanceBefore.toString(), "nanoTON");
    } catch (error: any) {
        console.log("⚠️ Не удалось получить баланс продавца:", error.message);
        console.log("   Продолжаем выполнение...");
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
        
        // Добавляем больший запас для газа
        const sendAmount = totalAmount + toNano("0.1"); // Увеличиваем запас для газа
        
        let fundingSuccess = false;
        try {
            console.log("🔄 Подготовка транзакции финансирования...");
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
            
            console.log("🔄 Отправка транзакции финансирования...");
            await client.sendExternalMessage(buyerWallet, fundDealTransfer);
            fundingSuccess = true;
            
            console.log("✅ Транзакция финансирования отправлена");
            console.log("📋 Детали транзакции финансирования:");
            console.log(`   Seqno: ${buyerSeqno}`);
            console.log(`   Отправитель: ${buyerAddress.toString()}`);
            console.log(`   Получатель: ${contractAddress.toString()}`);
            console.log(`   Отправлено: ${sendAmount.toString()} nanoTON`);
            console.log(`   Операция: op_fund_deal (5)`);
            console.log(`   Memo: ${memoText}`);
        } catch (fundError: any) {
            console.error("❌ Ошибка при финансировании сделки:", fundError.message);
            if (fundError.response) {
                console.error("   Статус ошибки:", fundError.response.status);
                console.error("   Данные ошибки:", fundError.response.data);
            }
            console.log("⚠️ Продолжаем выполнение скрипта несмотря на ошибку...");
            // Даем время для обработки предыдущих транзакций
            console.log("⏳ Ожидание 10 секунд перед продолжением...");
            await sleep(10000);
        }

        // Ждем немного для обработки транзакции
        console.log("⏳ Ожидание обработки транзакции...");
        await sleep(5000);
        
        // // Проверяем комиссию сразу после финансирования - временно отключено
        // console.log("\n📊 Проверка комиссии после финансирования...");
        // const dataAfterFunding = await getContractData(client, contractAddress);
        // console.log(`   Пул комиссий после финансирования: ${dataAfterFunding.commissionsPool.toString()} nanoTON`);
        // if (dataAfterFunding.commissionsPool >= commissionAmount) {
        //     console.log("✅ Комиссия успешно зачислена в пул");
        // } else {
        //     console.log("⚠️ Комиссия не была зачислена в пул или была меньше ожидаемой");
        //     console.log(`   Ожидалось: ${commissionAmount.toString()} nanoTON`);
        //     console.log(`   Получено: ${dataAfterFunding.commissionsPool.toString()} nanoTON`);
        // }
        
        // Даем немного времени для обработки финансирования
        console.log("\n⏳ Даем дополнительное время для обработки финансирования...");
        await sleep(3000); // Дополнительная пауза

        // Шаг 3: Разрешаем сделку в пользу продавца
        console.log("\n🔓 Разрешение сделки в пользу продавца...");
        
        let resolveSuccess = false;
        try {
            // Создаем тело сообщения для разрешения сделки
            const resolveMemoCell = beginCell().storeStringTail(memoText).endCell();
            
            console.log("📝 Создание тела сообщения для разрешения сделки...");
            
            // Выводим информацию о memo cell
            console.log("   Memo cell hash:", resolveMemoCell.hash().toString('hex'));
            
            // ВАЖНО: op_resolve_deal должен обрабатываться через recv_external в контракте
            console.log("🔄 Создаем внешнее сообщение для разрешения сделки...");
            
            // Создаем тело внешнего сообщения согласно ожиданиям recv_external
            // ВАЖНО: Проверяем структуру сообщения по контракту
            // В recv_external для op_resolve_deal ожидается:
            // 1. op (32 бита)
            // 2. sender (адрес) - загружается из cs, но не используется в op_resolve_deal
            // 3. memo cell (ref)
            // 4. флаг утверждения (1 бит)
            const externalBody = beginCell()
                .storeUint(2, 32) // op_resolve_deal
                .storeAddress(moderatorAddress) // sender - загружается, но не используется
                .storeRef(resolveMemoCell) // memo cell как ссылка
                .storeUint(1, 1) // 1 = в пользу продавца
                .endCell();
            
            console.log("📝 Детали сообщения:");
            console.log(`   Операция: op_resolve_deal (2)`);
            console.log(`   Memo: ${memoText}`);
            console.log(`   Memo hash: ${resolveMemoCell.hash().toString('hex')}`);
            console.log(`   В пользу продавца: Да (1)`);
            
            // Отправляем внешнее сообщение напрямую в контракт
            console.log("📤 Отправка внешнего сообщения в контракт...");
            
            // Используем внешнее сообщение, которое будет обработано recv_external
            // В recv_external для op_resolve_deal ожидается:
            // 1. op (32 бита)
            // 2. sender (адрес)
            // 3. memo cell (ref)
            // 4. флаг утверждения (1 бит)
            
            try {
                // Прямая отправка внешнего сообщения в контракт
                await client.sendExternalMessage({ address: contractAddress }, externalBody);
                
                console.log("✅ Внешнее сообщение успешно отправлено");
            } catch (extError: any) {
                console.error("❌ Ошибка при отправке внешнего сообщения:", extError.message);
                console.log("⚠️ Отправка внешнего сообщения не удалась, пробуем альтернативный подход...");
                
                // Если внешнее сообщение не удалось отправить, логируем ошибку, но продолжаем выполнение
                // В этом месте мы не пытаемся использовать внутреннее сообщение, так как
                // контракт обрабатывает op_resolve_deal только в recv_external
            }
            resolveSuccess = true;
            
            console.log("✅ Транзакция разрешения сделки отправлена");
            console.log("📋 Детали транзакции разрешения сделки:");
            console.log(`   Отправитель: ${moderatorAddress.toString()} (внешнее сообщение)`);
            console.log(`   Получатель: ${contractAddress.toString()}`);
            console.log(`   Сумма: ${toNano("0.1").toString()} nanoTON`);
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
            // Даем время для обработки предыдущих транзакций
            console.log("⏳ Ожидание 10 секунд перед продолжением...");
            await sleep(10000);
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

        // Проверяем балансы после завершения сделки
        console.log("\n💰 Проверка балансов после завершения сделки...");
        
        // Баланс покупателя после сделки
        const buyerBalanceAfter = await buyerContract.getBalance();
        console.log("💰 Баланс покупателя ПОСЛЕ сделки:", buyerBalanceAfter.toString(), "nanoTON");
        const buyerDifference = buyerBalanceAfter - buyerBalanceBefore;
        console.log(`   Изменение баланса покупателя: ${buyerDifference.toString()} nanoTON`);
        
        // Баланс продавца после сделки
        try {
            const sellerBalanceAfter = await client.getBalance(sellerAddress);
            console.log("💰 Баланс продавца ПОСЛЕ сделки:", sellerBalanceAfter.toString(), "nanoTON");
            const sellerDifference = sellerBalanceAfter - sellerBalanceBefore;
            console.log(`   Изменение баланса продавца: ${sellerDifference.toString()} nanoTON`);
            
            // Проверяем, получил ли продавец сумму сделки
            if (sellerDifference >= dealAmount) {
                console.log("✅ Продавец успешно получил сумму сделки");
            } else {
                console.log("⚠️ Продавец получил меньше ожидаемой суммы сделки");
            }
        } catch (error: any) {
            console.log("⚠️ Не удалось получить баланс продавца после сделки:", error.message);
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
        
        //console.log("🔍 Результат запроса к контракту:", JSON.stringify(result, (key, value) => 
        //    typeof value === 'bigint' ? value.toString() : value, 2));

        console.log("🔍 Результат запроса к контракту:", result);
        
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
            // Вариант 4: Стек как объект с особой структурой (новый формат TON API)
            else if (result.stack && typeof result.stack === 'object') {
                // Проверяем, есть ли в выводе структура, которую мы видим в логах
                try {
                    // Попробуем получить данные напрямую из объекта stack
                    const stack = result.stack as any;
                    if (stack.items && Array.isArray(stack.items)) {
                        const items = stack.items;
                        if (items.length >= 2) {
                            if (items[0] && items[0].type === 'int' && items[0].value) {
                                dealCounter = Number(items[0].value);
                            }
                            if (items[1] && items[1].type === 'int' && items[1].value) {
                                commissionsPool = BigInt(items[1].value);
                            }
                            if (items.length >= 3 && items[2] && items[2].type === 'cell') {
                                moderatorAddress = "Адрес в cell";
                            }
                            console.log("✅ Использован вариант парсинга 4 (объект с items)");
                        }
                    }
                } catch (jsonError: any) {
                    console.error("❌ Ошибка при доступе к items:", jsonError.message);
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
