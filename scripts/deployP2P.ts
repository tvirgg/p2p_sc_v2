import {
    Address,
    beginCell,
    Cell,
    contractAddress,
    Dictionary,
    StateInit,
    TonClient,
    toNano
} from "ton";
import { mnemonicToWalletKey } from "ton-crypto";
import { WalletContractV4 } from "ton";
import { getHttpEndpoint } from "@orbs-network/ton-access";
import * as dotenv from "dotenv";
import * as fs from "fs";

dotenv.config();

async function deployContract() {
    console.log("🚀 Initializing deploy...");

    // Подключение к сети
    const endpoint = await getHttpEndpoint({ network: "testnet" });
    const client = new TonClient({ endpoint });
    console.log("🌐 Connected to:", endpoint);

    // Кошелёк
    const mnemonic = process.env.WALLET_MNEMONIC;
    if (!mnemonic) throw new Error("WALLET_MNEMONIC not set");
    const key = await mnemonicToWalletKey(mnemonic.split(" "));
    const wallet = WalletContractV4.create({ publicKey: key.publicKey, workchain: 0 });
    const walletContract = client.open(wallet);
    const walletAddress = walletContract.address;

    console.log("👛 Wallet:", walletAddress.toString());

    // Баланс
    const balance = await walletContract.getBalance();
    console.log("💰 Balance:", balance.toString(), "nanoTON");

    if (balance < toNano("0.05")) {
        throw new Error("❌ Not enough TON! You need at least 0.05 TON to deploy.");
    }

    // Компиляция контракта
    console.log("📦 Loading compiled contract...");
    const compiled = JSON.parse(fs.readFileSync("build/P2P.compiled.json", "utf8"));
    const codeCell = Cell.fromBoc(Buffer.from(compiled.hex, "hex"))[0];

    // Сборка data
    const dealsDict = Dictionary.empty(Dictionary.Keys.Uint(32), Dictionary.Values.Cell());
    const memoMap = Dictionary.empty(Dictionary.Keys.Uint(256), Dictionary.Values.Cell());
    const unknownFunds = Dictionary.empty(Dictionary.Keys.Uint(32), Dictionary.Values.Cell());

    const dataCell = beginCell()
        .storeUint(0, 32)
        .storeDict(dealsDict)
        .storeDict(memoMap)
        .storeDict(unknownFunds)
        .storeAddress(walletAddress)
        .storeUint(0, 32)
        .endCell();

    const stateInit: StateInit = { code: codeCell, data: dataCell };
    const contractAddr = contractAddress(0, stateInit);

    console.log("📍 Contract address:", contractAddr.toString());
    console.log("🔗 TON Viewer:", `https://testnet.tonviewer.com/${contractAddr.toString()}`);
    console.log("🔗 TON Scan:", `https://testnet.tonscan.org/address/${contractAddr.toString()}`);

    // Отправка деплоя
    const seqno = await walletContract.getSeqno();
    console.log("📨 Sending deploy transaction...");

    const deployTransfer = walletContract.createTransfer({
        secretKey: key.secretKey,
        seqno,
        messages: [
            {
                info: {
                    type: "internal",
                    bounce: false,
                    ihrDisabled: true,
                    bounced: false,
                    dest: contractAddr,
                    value: { coins: toNano("0.05") },
                    ihrFee: 0n,
                    forwardFee: 0n,
                    createdAt: Math.floor(Date.now() / 1000),
                    createdLt: 0n
                },
                init: stateInit,
                body: new Cell()
            }
        ]
    });

    try {
        await client.sendExternalMessage(wallet, deployTransfer);
        console.log("✅ Deploy message sent.");
    } catch (err) {
        console.error("❌ Error sending deploy transaction:", err);
        return;
    }

    // Проверка, активен ли контракт
    console.log("⏳ Waiting for contract to be activated on-chain...");

    let attempts = 0;
    const maxAttempts = 10;
    while (attempts < maxAttempts) {
        const state = await client.getContractState(contractAddr);
        if (state.state === 'active') {
            console.log("🎉 Contract is active!");
            return;
        } else {
            console.log(`⌛ Not active yet (attempt ${++attempts}/${maxAttempts})...`);
            await new Promise((r) => setTimeout(r, 3000));
        }
    }

    console.error("❌ Timeout: Contract not activated after multiple attempts.");
}

deployContract().catch(err => {
    console.error("🚨 Deployment script error:", err);
});
