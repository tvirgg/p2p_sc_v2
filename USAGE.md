
# Смарт-контракт P2P Escrow: Руководство по использованию

Этот документ предоставляет практическое руководство по использованию смарт-контракта P2P Escrow в реальных приложениях. Он охватывает интеграцию, типовые сценарии и лучшие практики.

## Руководство по интеграции

### Предварительные требования

- TON-кошелёк с достаточным балансом для развёртывания и транзакций  
- Среда Node.js для запуска скриптов  
- Базовое понимание концепций блокчейна TON  

### Установка

1. Клонируйте репозиторий  
2. Установите зависимости:

```bash
npm install
```

### Развёртывание

#### Локальная разработка

Для локального тестирования:

```bash
npm run build
npm run bp run deployP2P
```

#### Развёртывание в тестовой сети

1. Создайте файл `.env` с вашей мнемонической фразой:

```
MNEMONIC="ваша мнемоническая фраза"
```

2. Развёртывание:

```bash
npm run bp deploy --network testnet
```

3. Сохраните адрес развёрнутого контракта.

#### Развёртывание в основной сети

Для продакшн-развёртывания:

```bash
npm run bp deploy --network mainnet
```

> ⚠️ **Важно**: Всегда тщательно тестируйте контракт в тестовой сети перед развёртыванием в основной.

---

### Интеграция с backend-сервисами

#### Node.js backend

```typescript
import { TonClient, Address, toNano } from '@ton/ton';
import { P2P } from './wrappers/P2P';

// Инициализация клиента TON
const client = new TonClient({
    endpoint: 'https://toncenter.com/api/v2/jsonRPC',
    apiKey: 'ваш_ключ'
});

// Открытие контракта
const p2pContract = P2P.createFromAddress(
    Address.parse('EQD...') // Адрес контракта
);

// Создание сделки
async function createDeal(
    moderatorWallet,
    moderatorAddress,
    sellerAddress,
    buyerAddress,
    amount,
    memo
) {
    const contract = client.open(p2pContract);
    
    await contract.sendCreateDeal(
        moderatorWallet,
        moderatorAddress,
        sellerAddress,
        buyerAddress,
        toNano(amount),
        memo
    );
    
    console.log(`Сделка создана с меткой: ${memo}`);
}
```

#### Веб-бэкенд (пример на Express.js)

```typescript
import express from 'express';
import { TonClient, Address, toNano } from '@ton/ton';
import { P2P } from './wrappers/P2P';
import { mnemonicToWalletKey } from '@ton/crypto';

const app = express();
app.use(express.json());

// Инициализация клиента TON
const client = new TonClient({
    endpoint: 'https://toncenter.com/api/v2/jsonRPC',
    apiKey: process.env.TON_API_KEY
});

// Загрузка кошелька модератора
const moderatorMnemonic = process.env.MODERATOR_MNEMONIC.split(' ');
const moderatorKey = await mnemonicToWalletKey(moderatorMnemonic);
const moderatorWallet = client.openWalletFromKey(moderatorKey);
const moderatorAddress = moderatorWallet.address;

// Открытие контракта
const p2pContract = P2P.createFromAddress(
    Address.parse(process.env.CONTRACT_ADDRESS)
);
const contract = client.open(p2pContract);

// Создание сделки через API
app.post('/api/deals', async (req, res) => {
    try {
        const { sellerAddress, buyerAddress, amount, memo } = req.body;
        
        await contract.sendCreateDeal(
            moderatorWallet,
            moderatorAddress,
            Address.parse(sellerAddress),
            Address.parse(buyerAddress),
            toNano(amount),
            memo
        );
        
        res.status(201).json({ success: true, memo });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(3000, () => {
    console.log('Сервер запущен на порту 3000');
});
```

---

### Интеграция с frontend-приложениями

#### Пример React.js

```jsx
import React, { useState } from 'react';
import { TonConnectButton, useTonConnect, useTonWallet } from '@tonconnect/ui-react';
import { Address, toNano } from '@ton/ton';

function FundDealForm({ contractAddress, memo }) {
    const [amount, setAmount] = useState('');
    const [loading, setLoading] = useState(false);
    const { sender } = useTonConnect();
    const wallet = useTonWallet();
    
    const handleFundDeal = async () => {
        if (!wallet) {
            alert('Сначала подключите кошелёк');
            return;
        }
        
        setLoading(true);
        try {
            const dealAmount = parseFloat(amount);
            const commission = dealAmount * 0.03;
            const totalAmount = dealAmount + commission;
            
            await sender.send({
                to: contractAddress,
                value: toNano(totalAmount.toString()),
                body: {
                    op: 5,
                    memo: memo
                }
            });
            
            alert('Сделка успешно профинансирована!');
        } catch (error) {
            console.error('Ошибка при финансировании сделки:', error);
            alert('Ошибка: ' + error.message);
        } finally {
            setLoading(false);
        }
    };
    
    return (
        <div>
            <h2>Финансирование сделки</h2>
            <p>Метка: {memo}</p>
            <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                min="0.1"
                step="0.1"
            />
            <p>Комиссия (3%): {(parseFloat(amount || 0) * 0.03).toFixed(2)} TON</p>
            <p>Итого: {(parseFloat(amount || 0) * 1.03).toFixed(2)} TON</p>
            
            <TonConnectButton />
            
            <button
                onClick={handleFundDeal}
                disabled={!wallet || loading || !amount}
            >
                {loading ? 'Обработка...' : 'Профинансировать'}
            </button>
        </div>
    );
}

export default FundDealForm;
```

---

## Типовые сценарии использования

### Сценарий 1: Онлайн-маркетплейс

**Ход действий:**

1. Продавец размещает товар, создаётся сделка с уникальной меткой  
2. Покупатель отправляет оплату с меткой  
3. Продавец отправляет товар  
4. Покупатель подтверждает получение — модератор завершает сделку в пользу продавца  
5. В случае спора — модератор разрешает его  

### Сценарий 2: Фриланс-услуги

1. Клиент создаёт проект  
2. Клиент отправляет оплату через контракт  
3. Фрилансер выполняет работу  
4. Клиент подтверждает — модератор завершает сделку  

### Сценарий 3: Недвижимость

1. Агент размещает объект  
2. Покупатель вносит залог  
3. При завершении сделки — залог переводится продавцу  
4. При отмене — возвращается покупателю  

---

## Лучшие практики

### Безопасность

- Храните ключи модератора безопасно (аппаратный кошелёк)  
- Генерируйте уникальные метки  
- Проверяйте TON-адреса  
- Обрабатывайте ошибки  
- Отслеживайте транзакции  

### UX

- Поясняйте шаги пользователю  
- Показывайте статус сделок  
- Отображайте комиссии  
- Предусмотрите механизм споров  

### Операции

- Назначьте резервного модератора  
- Аудит состояния контракта  
- Регулярно выводите комиссии  
- Внедрите мониторинг  

---

## Устранение неполадок

### Частые ошибки

- Недостаточно газа  
- Дубликат метки  
- Сделка не найдена  
- Повторное финансирование  
- Недостаточно средств у покупателя  

### Отладка

- Используйте TON Explorer  
- Проверьте состояние контракта:

```typescript
const dealCounter = await contract.getDealCounter();
console.log('Сделок всего:', dealCounter);

const dealInfo = await contract.getDealInfo(dealId);
console.log('Сумма сделки:', dealInfo.amount);
console.log('Финансирована:', dealInfo.funded);
```

---

## Заключение

Смарт-контракт P2P Escrow предоставляет безопасный и гибкий способ проведения сделок между сторонами. Соблюдая это руководство и лучшие практики, вы сможете эффективно внедрить его в свои приложения.

> ⚠️ **Важно**: Тщательно тестируйте перед продакшеном. Блокчейн-транзакции необратимы — обеспечьте надёжную защиту средств пользователей.

