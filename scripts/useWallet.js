// generate_wallets.js
// ---------------------------------------------------
// npm i tonweb @ton/crypto
// node generate_wallets.js
// ---------------------------------------------------

const TonWeb = require('tonweb');
const { mnemonicNew, mnemonicToSeed } = require('@ton/crypto');
const fs = require('fs');
require('dotenv').config();          // ← не обязательно, но привычно

// HTTP‑провайдер testnet TON Center
const tonweb = new TonWeb(
  new TonWeb.HttpProvider('https://testnet.toncenter.com/api/v2/jsonRPC', {
    apiKey: '04b4abb6f1b0ae20b62538222ff5b525c11805c7922bb595bfd66c4804a9e5d7'
  })
);

const nacl  = TonWeb.utils.nacl;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- генерация + запись в .env.generated ----------
async function createWalletWithMnemonic(label) {
  // 1) 24‑словная сид‑фраза
  const mnemonicArr = await mnemonicNew(24);
  const mnemonic    = mnemonicArr.join(' ');

  // 2) keypair
  const seed    = await mnemonicToSeed(mnemonicArr, '');
  const keyPair = nacl.sign.keyPair.fromSeed(seed.subarray(0, 32));

  // 3) кошелёк v3R2 (wc 0 — masterchain)
  const wallet = tonweb.wallet.create({
    publicKey: keyPair.publicKey,
    wc: 0,
    type: 'v3R2'
  });

  // 4) адреса
  const address   = await wallet.getAddress();
  const fullAddr  = address.toString(true, true, false); // bounceable, url‑safe, mainnet‑style
  const testAddr  = address.toString(true, true, true);  // …но с флагом testOnly

  console.log(`\n${label.toUpperCase()}`);
  console.log('Full address  :', fullAddr);
  console.log('Testnet addr  :', testAddr);

  // 5) (необязательно) деплой — в testnet без тонов упадёт
  // try {
  //   await wallet.deploy({ secretKey: new Uint8Array(keyPair.secretKey) }).send();
  //   console.log('Wallet deployed');
  // } catch (e) { console.warn('Deploy skipped:', e.message); }

  // 6) пишем блок в .env.generated
  const envBlock = [
    `# --- ${label.toUpperCase()} ---`,
    `${label.toUpperCase()}_MNEMONIC="${mnemonic}"`,
    `${label.toUpperCase()}_ADDRESS_FULL="${fullAddr}"`,
    `${label.toUpperCase()}_ADDRESS_TESTNET="${testAddr}"`,
    `${label.toUpperCase()}_PUBLIC_KEY=${TonWeb.utils.bytesToHex(keyPair.publicKey)}`,
    `${label.toUpperCase()}_PRIVATE_KEY=${TonWeb.utils.bytesToHex(keyPair.secretKey)}`,
    ''
  ].join('\n');

  fs.appendFileSync('.env.generated', envBlock);

  return { mnemonic, fullAddr, testAddr };
}

// ------------------------- main -------------------------
(async () => {
  // начинаем с чистого файла
  fs.writeFileSync('.env.generated', '# GENERATED TON WALLETS\n\n');

  console.log('🚀 Генерация кошельков…');

  await createWalletWithMnemonic('buyer');
  await createWalletWithMnemonic('seller');

  console.log('\n✅ Готово! Проверь .env.generated — там сид‑фразы, ключи и оба адреса.');
  console.log('С ними можно идти дальше: деплоить, заливать токены, писать логику сделок.');
})();
