import { toNano } from '@ton/core';
import { P2P } from '../wrappers/P2P';
import { compile, NetworkProvider } from '@ton/blueprint';

export async function run(provider: NetworkProvider) {
    const p2P = provider.open(
        P2P.createFromConfig(
            {
                id: Math.floor(Math.random() * 10000),
                counter: 0,
            },
            await compile('P2P')
        )
    );

    await p2P.sendDeploy(provider.sender(), toNano('0.05'));

    await provider.waitForDeploy(p2P.address);

    console.log('ID', await p2P.getID());
}
