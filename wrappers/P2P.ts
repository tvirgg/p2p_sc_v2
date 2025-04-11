import { Address, beginCell, Cell, Contract, contractAddress, ContractProvider, Dictionary, Sender, SendMode, toNano } from 'ton-core';

export class P2P implements Contract {
    constructor(readonly address: Address, readonly init?: { code: Cell; data: Cell }) {}

    static createFromAddress(address: Address) {
        return new P2P(address);
    }

    static createFromConfig(
        moderator: Address,
        code: Cell,
        workchain = 0
    ) {
        // Создаем начальные данные контракта
        const data = beginCell()
            .storeUint(0, 32) // deals_counter
            .storeDict(Dictionary.empty()) // deals_dict
            .storeDict(Dictionary.empty()) // memo_map
            .storeDict(Dictionary.empty()) // unknown_funds
            .storeAddress(moderator)
            .storeUint(0, 32) // commissions_pool
            .endCell();

        const init = { code, data };
        return new P2P(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: any, value: bigint = toNano("0.05")) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    async sendCreateDeal(
        provider: ContractProvider,
        sender: any, // кошелёк модератора
        moderator: Address,
        seller: Address,
        buyer: Address,
        amount: bigint,
        memo: string
    ) {
        const memoCell = beginCell().storeStringTail(memo).endCell();
    
        const body = beginCell()
            .storeUint(1, 32)         // op_create_deal
            .storeAddress(moderator)
            .storeAddress(seller)
            .storeAddress(buyer)
            .storeCoins(amount)
            .storeRef(memoCell)
            .endCell();
    
        // ВНУТРЕННЕЕ сообщение от модератора
        await provider.internal(sender, {
            value: toNano("0.05"), // или сколько нужно
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body,
        });
    }
    
    
    

    async sendFundDeal(
        provider: ContractProvider,
        buyer: any,
        memo: string,
        value: bigint
    ) {
        const memoCell = beginCell().storeStringTail(memo).endCell();
        const fundingBody = beginCell()
        .storeUint(5, 32) // ✅ Новый op_fund_deal
        .storeRef(memoCell)
        .endCell();

        await provider.internal(buyer, {
            value,
            body: fundingBody,
            bounce: true,
            sendMode: SendMode.PAY_GAS_SEPARATELY
        });
    }

    async sendResolveDeal(
        provider: ContractProvider,
        sender: any, // Accept any type for Sandbox compatibility
        moderator: Address,
        memo: string,
        approvePayment: boolean
    ) {
        const memoCell = beginCell().storeStringTail(memo).endCell();
        const payload = beginCell()
            .storeUint(2, 32) // op_resolve_deal
            .storeAddress(moderator)
            .storeRef(memoCell)
            .storeUint(approvePayment ? 1 : 0, 1)
            .endCell();

        // For Sandbox testing, we'll use internal message from the sender
        await provider.internal(sender, {
            value: toNano("0.05"),
            body: payload,
            sendMode: SendMode.PAY_GAS_SEPARATELY
        });
    }

    async sendRefundUnknown(
        provider: ContractProvider,
        sender: any, // Accept any type for Sandbox compatibility
        moderator: Address,
        key: number
    ) {
        const payload = beginCell()
            .storeUint(3, 32) // op_refund_unknown
            .storeAddress(moderator)
            .storeUint(key, 32)
            .endCell();

        // For Sandbox testing, we'll use internal message from the sender
        await provider.internal(sender, {
            value: toNano("0.05"),
            body: payload,
            sendMode: SendMode.PAY_GAS_SEPARATELY
        });
    }

    async sendWithdrawCommissions(
        provider: ContractProvider,
        sender: any, // Accept any type for Sandbox compatibility
        moderator: Address,
        amount: bigint
    ) {
        const payload = beginCell()
            .storeUint(4, 32) // op_withdraw_commissions
            .storeAddress(moderator)
            .storeCoins(amount)
            .endCell();

        // For Sandbox testing, we'll use internal message from the sender
        await provider.internal(sender, {
            value: toNano("0.05"),
            body: payload,
            sendMode: SendMode.PAY_GAS_SEPARATELY
        });
    }

    async getDealInfo(provider: ContractProvider, dealId: number) {
        const result = await provider.get('get_deal_info', [
            { type: 'int', value: BigInt(dealId) }
        ]);
        
        const amount = result.stack.readBigNumber();
        const funded = result.stack.readNumber();
        
        return { amount, funded };
    }

    async getDealCounter(provider: ContractProvider) {
        const result = await provider.get('get_deal_counter', []);
        return result.stack.readNumber();
    }
}
