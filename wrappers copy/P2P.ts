import {
    Address,
    beginCell,
    Cell,
    Contract,
    contractAddress,
    ContractProvider,
    Sender,
    SendMode,
    Slice,
  } from 'ton-core';
  import { toNano } from 'ton-core';
  export type P2PConfig = {
    // Здесь можно определить начальные параметры конфигурации контракта
  };
  
  export function p2pConfigToCell(config: P2PConfig): Cell {
    const cell = beginCell();
    // Здесь можно сериализовать параметры конфигурации в ячейку
    return cell.endCell();
  }
  
  export class P2P implements Contract {
    constructor(
      readonly address: Address,
      readonly init?: { code: Cell; data: Cell }
    ) {}
  
    static createFromAddress(address: Address) {
      return new P2P(address);
    }
  
    static createFromConfig(config: P2PConfig, code: Cell, workchain = 0) {
      const data = p2pConfigToCell(config);
      const init = { code, data };
      return new P2P(contractAddress(workchain, init), init);
    }
  
    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
      await provider.internal(via, {
        value,
        sendMode: SendMode.PAY_GAS_SEPARATELY,
        body: beginCell().endCell(),
      });
    }
  
    async sendCreateDeal(
      provider: ContractProvider,
      via: Sender,
      seller: Address,
      buyer: Address,
      amount: bigint,
      memo: string
    ) {
      const body = beginCell()
        .storeUint(0x01, 32) // opcode для createDeal
        .storeAddress(seller)
        .storeAddress(buyer)
        .storeCoins(amount)
        .storeStringTail(memo)
        .endCell();
  
      await provider.internal(via, {
        value: amount,
        sendMode: SendMode.PAY_GAS_SEPARATELY,
        body,
      });
    }
  
    async sendFundDeal(
      provider: ContractProvider,
      via: Sender,
      memo: string,
      value: bigint
    ) {
      const body = beginCell()
        .storeUint(0x02, 32) // opcode для fundDeal
        .storeStringTail(memo)
        .endCell();
  
      await provider.internal(via, {
        value,
        sendMode: SendMode.PAY_GAS_SEPARATELY,
        body,
      });
    }
  
    async sendResolveDealExternal(
      provider: ContractProvider,
      via: Sender,
      memo: string,
      verdict: boolean
    ) {
      const body = beginCell()
        .storeUint(0x03, 32) // opcode для resolveDeal
        .storeStringTail(memo)
        .storeUint(verdict ? 1 : 0, 1)
        .endCell();
  
      await provider.internal(via, {
        value: toNano('0.05'), // минимальное значение для покрытия газа
        sendMode: SendMode.PAY_GAS_SEPARATELY,
        body,
      });
    }
  
    async sendRefundUnknown(
      provider: ContractProvider,
      via: Sender,
      key: number
    ) {
      const body = beginCell()
        .storeUint(0x04, 32) // opcode для refundUnknown
        .storeUint(key, 64)
        .endCell();
  
      await provider.internal(via, {
        value: toNano('0.05'),
        sendMode: SendMode.PAY_GAS_SEPARATELY,
        body,
      });
    }
  
    async sendWithdrawCommissions(provider: ContractProvider, via: Sender) {
      const body = beginCell()
        .storeUint(0x05, 32) // opcode для withdrawCommissions
        .endCell();
  
      await provider.internal(via, {
        value: toNano('0.05'),
        sendMode: SendMode.PAY_GAS_SEPARATELY,
        body,
      });
    }
  
    async getDealInfo(provider: ContractProvider, id: number) {
      const result = await provider.get('get_deal_info', [
        { type: 'int', value: BigInt(id) },
      ]);
      return result.stack;
    }
  
    async getDealCounter(provider: ContractProvider) {
      const result = await provider.get('get_deal_counter', []);
      return result.stack.readBigNumber();
    }
  
    async getModeratorAddress(provider: ContractProvider) {
      const result = await provider.get('get_moderator_address', []);
      return result.stack.readAddress();
    }
  }
  