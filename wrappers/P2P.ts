import {
    Address,
    beginCell,
    Cell,
    Contract,
    contractAddress,
    ContractProvider,
    Dictionary,
    Sender,
    SendMode,
    toNano,
} from 'ton-core';

/**
 * Класс-обёртка P2P,
 * в котором методы для вызова смарт-контракта TON (внутренними сообщениями).
 */
export class P2P implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell },
    ) {}

    /**
     * Создаём контракт из готового адреса.
     */
    static createFromAddress(address: Address): P2P {
        return new P2P(address);
    }

    /**
     * Создаём контракт из конфига (moderator + code).
     * Генерируем data, вычисляем адрес, передаём в конструктор.
     */
    static createFromConfig(
        moderator: Address,
        code: Cell,
        workchain: number = 0
    ): P2P {
        // Делаем начальные данные
        const data = beginCell()
            .storeUint(0, 32) // deals_counter
            .storeDict(Dictionary.empty()) // deals_dict
            .storeDict(Dictionary.empty()) // memo_map
            .storeDict(Dictionary.empty()) // unknown_funds
            .storeAddress(moderator)
            .storeUint(0, 32) // commissions_pool
            .endCell();

        const init = { code, data };
        const address = contractAddress(workchain, init);
        return new P2P(address, init);
    }

    /**
     * Метод для деплоя (отправляем пустое сообщение).
     */
    async sendDeploy(
        provider: ContractProvider,
        via: Sender,
        value: bigint = toNano("0.05")
    ) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    /**
     * Создание сделки (op = 1).
     */
    async sendCreateDeal(
        provider: ContractProvider,
        via: Sender,
        seller: Address,
        buyer: Address,
        amount: bigint,
        memo: string
    ) {
        const memoCell = beginCell().storeStringTail(memo).endCell();

        const msgBody = beginCell()
            .storeUint(1, 32) // op_create_deal
            .storeUint(0, 64) // query_id (0 для простоты)
            .storeAddress(seller)
            .storeAddress(buyer)
            .storeCoins(amount)
            .storeRef(memoCell)
            .endCell();

        return provider.internal(via, {
            value: toNano("0.05"),
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: msgBody,
        });
    }

    /**
     * Финансирование сделки (op = 5).
     */
    async sendFundDeal(
        provider: ContractProvider,
        via: Sender,
        memo: string,
        value: bigint
    ) {
        const memoCell = beginCell().storeStringTail(memo).endCell();

        const msgBody = beginCell()
            .storeUint(5, 32) // op_fund_deal
            .storeUint(0, 64) // query_id (0 для простоты)
            .storeRef(memoCell)
            .endCell();

        return provider.internal(via, {
            value,
            body: msgBody,
            bounce: true,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
        });
    }

    /**
     * Разрешение сделки (op = 2).
     */
    async sendResolveDeal(
        provider: ContractProvider,
        via: Sender,
        memo: string,
        approvePayment: boolean
    ) {
        const memoCell = beginCell().storeStringTail(memo).endCell();

        const msgBody = beginCell()
            .storeUint(2, 32) // op_resolve_deal
            .storeUint(0, 64) // query_id (0 для простоты)
            .storeRef(memoCell)
            .storeUint(approvePayment ? 1 : 0, 1)
            .endCell();

        return provider.internal(via, {
            value: toNano("0.05"),
            body: msgBody,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
        });
    }

    /**
     * Возврат неизвестных средств (op = 3).
     */
    async sendRefundUnknown(
        provider: ContractProvider,
        via: Sender,
        key: number
    ) {
        const msgBody = beginCell()
            .storeUint(3, 32) // op_refund_unknown
            .storeUint(0, 64) // query_id (0 для простоты)
            .storeUint(key, 32)
            .endCell();

        return provider.internal(via, {
            value: toNano("0.05"),
            body: msgBody,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
        });
    }

    /**
     * Вывод комиссий (op = 4).
     */
    async sendWithdrawCommissions(
        provider: ContractProvider,
        via: Sender,
        amount: bigint
    ) {
        const msgBody = beginCell()
            .storeUint(4, 32) // op_withdraw_commissions
            .storeUint(0, 64) // query_id (0 для простоты)
            .storeCoins(amount)
            .endCell();

        return provider.internal(via, {
            value: toNano("0.05"),
            body: msgBody,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
        });
    }

    /**
     * Геттер: получить (amount, funded).
     */
    async getDealInfo(provider: ContractProvider, dealId: number) {
        const res = await provider.get('get_deal_info', [
            { type: 'int', value: BigInt(dealId) },
        ]);

        const amount = res.stack.readBigNumber();
        const funded = res.stack.readNumber();

        return { amount, funded };
    }

    /**
     * Геттер: счётчик сделок.
     */
    async getDealCounter(provider: ContractProvider) {
        const res = await provider.get('get_deal_counter', []);
        return res.stack.readNumber();
    }

    /**
     * Отладочный геттер: получить адрес модератора.
     */
    async getModeratorAddress(provider: ContractProvider) {
        const res = await provider.get('get_moderator', []);
        return res.stack.readAddress();
    }

    /**
     * Отладочный геттер: получить все данные контракта.
     */
    async getContractData(provider: ContractProvider) {
        const res = await provider.get('debug_get_contract_data', []);
        const dealCounter = res.stack.readNumber();
        const commissionsPool = res.stack.readNumber();
        const moderatorAddress = res.stack.readAddress();
        return { dealCounter, commissionsPool, moderatorAddress };
    }

    /**
     * Отладочный геттер: получить полную информацию о сделке.
     */
    async getFullDealInfo(provider: ContractProvider, dealId: number) {
        const res = await provider.get('debug_get_deal', [
            { type: 'int', value: BigInt(dealId) },
        ]);
        
        const seller = res.stack.readAddress();
        const buyer = res.stack.readAddress();
        const amount = res.stack.readBigNumber();
        const funded = res.stack.readNumber();
        
        return { seller, buyer, amount, funded };
    }

    /**
     * Отладочный геттер: проверить существование сделки.
     */
    async debugDealExists(provider: ContractProvider, dealId: number) {
        const res = await provider.get('debug_deal_exists', [
            { type: 'int', value: BigInt(dealId) },
        ]);
        return res.stack.readNumber() === -1; // -1 означает true в FunC
    }

    /**
     * Отладочный геттер: получить сырые данные контракта.
     */
    async debugGetRawData(provider: ContractProvider) {
        const res = await provider.get('debug_get_raw_data', []);
        return res.stack.readCell();
    }
}
