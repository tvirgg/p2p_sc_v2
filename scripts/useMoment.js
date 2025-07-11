const TonWeb = require('tonweb');

// Провайдер testnet через toncenter
const tonweb = new TonWeb(
    new TonWeb.HttpProvider('https://testnet.toncenter.com/api/v2/jsonRPC', {
        apiKey: '04b4abb6f1b0ae20b62538222ff5b525c11805c7922bb595bfd66c4804a9e5d7'
    })
);

// 👉 Чекаем баланс
async function checkBalance(rawAddress) {
    try {
        const addressObj = new TonWeb.utils.Address(rawAddress);
        const balance = await tonweb.getBalance(addressObj);
        const ton = TonWeb.utils.fromNano(balance).toString();
        console.log(`💰 Баланс [${addressObj.toString(true)}]: ${ton} TON`);
    } catch (err) {
        console.error('❌ Ошибка при получении баланса:', err.message);
    }
}

// 🔥 Поменяй адрес на свой
checkBalance('0:90fbed59edf1e32968f9cda3ba8cb473fc5f0d7a7765a73a5571ec8ffcd871b3');
