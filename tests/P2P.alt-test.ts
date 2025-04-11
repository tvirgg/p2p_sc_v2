import { Address, beginCell, toNano } from "ton-core";
import { compile } from "@ton-community/blueprint";
import { Blockchain, SandboxContract } from "@ton-community/sandbox";
import { P2P } from "../wrappers/P2P";

describe("P2P Contract Sandbox", () => {
    let blockchain: Blockchain;
    let contract: SandboxContract<P2P>;

    let MODERATOR: Address;
    const SELLER = Address.parse("0:1111000011110000111100001111000011110000111100001111000011110000");
    const BUYER  = Address.parse("0:2222000022220000222200002222000022220000222200002222000022220000");

    beforeEach(async () => {
        // Создаём песочницу
        blockchain = await Blockchain.create();
        blockchain.verbosity = {
            ...blockchain.verbosity,
            blockchainLogs: true,
            vmLogs: "vm_logs_full",
            debugLogs: true,
            print: false,
          };
        // Кошелёк модератора
        const moderatorWallet = await blockchain.treasury("moderator");
        MODERATOR = moderatorWallet.address;

        // Компилим смарт-контракт
        const code = await compile("P2P");

        // Создаём P2P-экземпляр из конфигурации
        const p2pContract = P2P.createFromConfig(MODERATOR, code);
        contract = blockchain.openContract(p2pContract);

        // Деплоим
        await contract.sendDeploy(moderatorWallet, toNano("0.05"));
        console.log("🚀 Контракт задеплоен");
    });

    it("should create and fund a deal", async () => {
        
        const dealAmount = toNano("2");
        const memoText = "DEAL:1";

        // Считаем хэш от memoCell (для интереса)
        const memoCell = beginCell().storeStringTail(memoText).endCell();
        const memoHash = memoCell.hash().toString("hex");
        console.log("🔖 Memo Hash:", memoHash);

        // Получаем кошельки в Sandbox
        const moderatorWallet = await blockchain.treasury("moderator");
        const buyerWallet     = await blockchain.treasury("buyer");

        console.log("🏁 Контракт адрес:", contract.address.toString());
        console.log("🏁 Модератор адрес:", moderatorWallet.address.toString());
        console.log("🏁 Баланс модератора:", (await blockchain.getContract(moderatorWallet.address)).balance.toString());

        const contractState = await blockchain.getContract(contract.address);
        const isActive =
            contractState.account !== null &&
            contractState.account.account?.storage.state.type === 'active';

        console.log("📦 Контракт активен?", isActive);

        // === Шаг 1: Создание сделки ===
        try {
            const res = await contract.sendCreateDeal(
                moderatorWallet,
                MODERATOR,
                SELLER,
                BUYER,
                dealAmount,
                memoText
            );
            //await blockchain.
            console.log("📜 TRANSACTION RESULT:", res);
        } catch (e) {
            console.error("🔥 Ошибка при создании сделки:", e);
            throw e;
        }
        console.log("✅ Сделка создана");

        const dealCounterAfterCreate = await contract.getDealCounter();
        console.log("📈 Deal counter после создания:", dealCounterAfterCreate);

        // === Шаг 2: Финансирование сделки ===
        await contract.sendFundDeal(
            buyerWallet,
            memoText,
            toNano("2.1") // чуть больше, чтобы учесть комиссию
        );
        console.log("💰 Сделка профинансирована");

        // === Шаг 3: Проверка состояния сделки ===
        const dealInfo = await contract.getDealInfo(0);
        console.log("📦 Данные сделки:", {
            amount: dealInfo.amount.toString(),
            funded: dealInfo.funded
        });

        expect(dealInfo.amount.toString()).toBe(dealAmount.toString());
        expect(dealInfo.funded).toBe(1);
    });
});
