/* -------------------------------------------------------------------- */
/* provider.ts – инициализация TonClient, кошелька‑модератора и P2P      */
/* -------------------------------------------------------------------- */
import { TonClient, WalletContractV4, OpenedContract, Address } from 'ton';
import { mnemonicToWalletKey } from 'ton-crypto';
import { P2P } from '../wrappers/P2P';
import { getHttpEndpoint } from '@orbs-network/ton-access';
import * as dotenv from 'dotenv';

dotenv.config();

export async function initTon() {
  /* 1. RPC‑клиент -------------------------------------------------------- */
  const endpoint = await getHttpEndpoint({ network: 'testnet' });
  const client = new TonClient({ endpoint });

  /* 2. Кошелёк‑модератор -------------------------------------------------- */
  const mnemonic = process.env.MNEMONIC!.trim().split(' ');
  const key = await mnemonicToWalletKey(mnemonic);

  const wallet = WalletContractV4.create({
    workchain: Number(process.env.WORKCHAIN ?? 0),
    publicKey: key.publicKey,
  });

  const walletContract = client.open(wallet);       // <─ OpenedContract<WalletContractV4>
  const sender = walletContract.sender(key.secretKey);

  /* 3. P2P‑контракт ------------------------------------------------------ */
  // Use the contract address from environment variables
  const contractAddr = process.env.CONTRACT_ADDR!;
  console.log("Using contract address from environment:", contractAddr);
  
  // Parse the address consistently using parseFriendly
  const { address: parsedAddr, isBounceable, isTestOnly } = Address.parseFriendly(contractAddr);
  console.log("Parsed address details:", {
    address: parsedAddr.toString(),
    workchain: parsedAddr.workChain,
    hash: Buffer.from(parsedAddr.hash).toString('hex'),
    isBounceable,
    isTestOnly
  });
  
  const contract = client.open(
    P2P.createFromAddress(parsedAddr)
  );
  
  return { walletContract, sender, contract, client, key };

}

/* -------------------------------------------------------------------- */
/* sendAndWait – ждём, пока кошелёк получит новый seqno                 */
/* -------------------------------------------------------------------- */
export async function sendAndWait(
  walletContract: OpenedContract<WalletContractV4>,
  action: () => Promise<void>
) {
  const seqno = await walletContract.getSeqno();     // <─ видно getSeqno()
  await action();                                    // отправляем сообщение

  // ждём появления нового seqno
  while (await walletContract.getSeqno() === seqno) {
    await new Promise(r => setTimeout(r, 1500));
  }
}
