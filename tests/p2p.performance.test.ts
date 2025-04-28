import { Address, beginCell, toNano, Dictionary, Cell, Slice, SendMode } from "ton-core";
import { compile } from "@ton-community/blueprint";
import { Blockchain, SandboxContract, TreasuryContract } from "@ton-community/sandbox";
import { P2P } from "../wrappers/P2P";
import '@ton-community/test-utils';

// Утилита безопасного stringify
function safeStringify(obj: any, space = 2) {
    const seen = new WeakSet();
    return JSON.stringify(obj, (key, value) => {
        if (typeof value === 'bigint') {
            return value.toString();
        }
        if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) {
                return '[Circular]';
            }
            seen.add(value);
        }
        return value;
    }, space);
}

// Утилита для flatten всех транзакций из trace
function flattenTransactions(trace: any): any[] {
    const result: any[] = [];
    const stack = [trace];

    while (stack.length > 0) {
        const node = stack.pop();
        if (node?.transactions) {
            result.push(...node.transactions);
        }
        if (node?.children) {
            stack.push(...node.children);
        }
    }

    return result;
}

describe("P2P - stray payment gas usage", () => {
    let blockchain: Blockchain;
    let contract: SandboxContract<P2P>;
    let moderator: SandboxContract<TreasuryContract>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        moderator = await blockchain.treasury("moderator");

        const code = await compile("P2P");
        const cfg = P2P.createFromConfig(moderator.address, code, 0);
        contract = blockchain.openContract(cfg);

        await contract.sendDeploy(moderator.getSender(), toNano("0.05"));
    });

    it('stray-payment gas usage ≤ 3500', async () => {
        const sender = await blockchain.treasury("stray_sender");
        const value = toNano('0.2'); // должно быть >= 0.1 TON
        const trace = await sender.send({
            to: contract.address,
            value,
            bounce: false,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
        });

        // Flatten all transactions
        const allTxs = flattenTransactions(trace);

        const contractTx = allTxs.find((tx: any) => {
            return tx.description?.type === 'generic' && tx.description?.computePhase?.type === 'vm';
        });
        
        if (!contractTx) {
            console.error("Транзакция с исполнением кода не найдена в trace:");
            console.error(safeStringify(allTxs));
            throw new Error('Contract transaction not found in trace');
        }
        
        const gasUsed: number = Number(contractTx.description.computePhase.gasUsed ?? 0);
        
        process.stdout.write(`💨 gasUsed = ${gasUsed}\n`);
        expect(gasUsed).toBeLessThanOrEqual(3500);
    });
});
