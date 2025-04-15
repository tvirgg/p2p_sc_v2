import {
    Address,
    TonClient
} from "ton";
import { getHttpEndpoint } from "@orbs-network/ton-access";
import * as dotenv from "dotenv";

dotenv.config();

// Адрес задеплоенного контракта
const CONTRACT_ADDR = "EQAKxreVyMzGlahLmkfX0iQayBGTQqL5XwuFwgVBJVPO16Jw";

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
 * @param intervalSeconds Интервал между проверками в секундах
 * @param maxChecks Максимальное количество проверок (0 для бесконечного мониторинга)
 */
async function monitorCommissionsPool(
    client: TonClient, 
    contractAddress: Address, 
    intervalSeconds: number = 10,
    maxChecks: number = 0
) {
    console.log("\n📈 Запуск мониторинга пула комиссий...");
    console.log(`   Адрес контракта: ${contractAddress.toString()}`);
    console.log(`   Интервал проверки: ${intervalSeconds} секунд`);
    if (maxChecks > 0) {
        console.log(`   Количество проверок: ${maxChecks}`);
    } else {
        console.log(`   Режим: бесконечный мониторинг (Ctrl+C для остановки)`);
    }
    
    let lastCommissionPool = 0n;
    let checkCount = 0;
    let totalCommissionIncrease = 0n;
    
    // Получаем начальное значение
    try {
        const initialData = await getContractData(client, contractAddress);
        lastCommissionPool = initialData.commissionsPool;
        console.log(`\n📊 Начальное состояние:`);
        console.log(`   Счетчик сделок: ${initialData.dealCounter}`);
        console.log(`   Пул комиссий: ${initialData.commissionsPool.toString()} nanoTON`);
        console.log(`   Модератор: ${initialData.moderatorAddress}`);
    } catch (error: any) {
        console.error(`❌ Ошибка при получении начального состояния: ${error.message}`);
        return;
    }
    
    while (maxChecks === 0 || checkCount < maxChecks) {
        // Ждем указанный интервал
        await new Promise(resolve => setTimeout(resolve, intervalSeconds * 1000));
        
        try {
            checkCount++;
            const data = await getContractData(client, contractAddress);
            const currentPool = data.commissionsPool;
            
            console.log(`\n📊 Проверка #${checkCount}:`);
            console.log(`   Текущий пул комиссий: ${currentPool.toString()} nanoTON`);
            
            const difference = currentPool - lastCommissionPool;
            if (difference > 0n) {
                console.log(`   ⬆️ Увеличение на: ${difference.toString()} nanoTON`);
                totalCommissionIncrease += difference;
            } else if (difference < 0n) {
                console.log(`   ⬇️ Уменьшение на: ${(-difference).toString()} nanoTON (вероятно, вывод комиссий)`);
            } else {
                console.log(`   ↔️ Без изменений`);
            }
            
            console.log(`   Всего накоплено комиссий с начала мониторинга: ${totalCommissionIncrease.toString()} nanoTON`);
            
            lastCommissionPool = currentPool;
        } catch (error: any) {
            console.error(`❌ Ошибка при мониторинге (проверка #${checkCount}): ${error.message}`);
        }
    }
    
    console.log("\n✅ Мониторинг пула комиссий завершен");
    console.log(`   Всего проведено проверок: ${checkCount}`);
    console.log(`   Общее увеличение комиссий: ${totalCommissionIncrease.toString()} nanoTON`);
}

/**
 * Функция для однократной проверки состояния контракта
 */
async function checkContractState() {
    try {
        console.log("🚀 Подключение к сети...");
        const endpoint = await getHttpEndpoint({ network: "testnet" });
        const client = new TonClient({ endpoint });
        
        const contractAddress = Address.parse(CONTRACT_ADDR);
        console.log(`📦 Проверка контракта: ${contractAddress.toString()}`);
        
        const data = await getContractData(client, contractAddress);
        
        console.log("\n📋 Данные контракта:");
        console.log(`   Счетчик сделок: ${data.dealCounter}`);
        console.log(`   Пул комиссий: ${data.commissionsPool.toString()} nanoTON`);
        console.log(`   Модератор: ${data.moderatorAddress}`);
        
        console.log("\n✅ Проверка завершена");
    } catch (error: any) {
        console.error(`❌ Ошибка: ${error.message}`);
    }
}

/**
 * Основная функция
 */
async function main() {
    const args = process.argv.slice(2);
    
    if (args.includes("--help") || args.includes("-h")) {
        console.log("Использование:");
        console.log("  npm run monitor-commissions -- [опции]");
        console.log("\nОпции:");
        console.log("  --check       Однократная проверка состояния контракта");
        console.log("  --monitor     Запуск мониторинга комиссий");
        console.log("  --interval=N  Интервал между проверками в секундах (по умолчанию 10)");
        console.log("  --count=N     Количество проверок (0 для бесконечного мониторинга)");
        console.log("  --help, -h    Показать эту справку");
        return;
    }
    
    if (args.includes("--check")) {
        await checkContractState();
        return;
    }
    
    if (args.includes("--monitor")) {
        // Парсим интервал
        let interval = 10; // По умолчанию 10 секунд
        const intervalArg = args.find(arg => arg.startsWith("--interval="));
        if (intervalArg) {
            const intervalValue = parseInt(intervalArg.split("=")[1]);
            if (!isNaN(intervalValue) && intervalValue > 0) {
                interval = intervalValue;
            }
        }
        
        // Парсим количество проверок
        let count = 0; // По умолчанию бесконечный мониторинг
        const countArg = args.find(arg => arg.startsWith("--count="));
        if (countArg) {
            const countValue = parseInt(countArg.split("=")[1]);
            if (!isNaN(countValue) && countValue >= 0) {
                count = countValue;
            }
        }
        
        // Запускаем мониторинг
        const endpoint = await getHttpEndpoint({ network: "testnet" });
        const client = new TonClient({ endpoint });
        const contractAddress = Address.parse(CONTRACT_ADDR);
        
        await monitorCommissionsPool(client, contractAddress, interval, count);
        return;
    }
    
    // Если не указаны опции, показываем справку
    console.log("Не указаны опции. Используйте --help для получения справки.");
    console.log("Запуск однократной проверки...");
    await checkContractState();
}

// Запускаем основную функцию
main().catch(console.error);
