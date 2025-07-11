/* -------------------------------------------------------------------- */
/* server.ts – HTTP‑API вокруг p2p_sc_v2                                 */
/* -------------------------------------------------------------------- */
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

import { initTon, sendAndWait } from '../lib/provider';
import { Address, beginCell, toNano } from 'ton-core';

(async () => {
  /* инициализация ------------------------------------------------------- */
  const { walletContract, sender, contract, client, key } = await initTon();
  
  // Display contract information
  console.log("Contract:", {
    address: contract.address.toString(),
    workchain: contract.address.workChain,
    hash: Buffer.from(contract.address.hash).toString('hex')
  });

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(morgan('tiny'));

  /* ------------------ GETTERS ------------------ */
  app.get('/deal/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      // Use client.callGetMethod directly
      const result = await client.callGetMethod(contract.address, 'get_deal_info', [
        { type: 'int', value: BigInt(id) },
      ]);
      
      const amount = result.stack.readBigNumber();
      const isFunded = Boolean(result.stack.readNumber());
      
      res.json({ amount: amount.toString(), isFunded });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  app.get('/deal-counter', async (_req, res) => {
    try {
      // Use client.callGetMethod directly
      const result = await client.callGetMethod(contract.address, 'get_deal_counter', []);
      const counter = result.stack.readBigNumber();
      res.json({ counter: counter.toString() });``
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  app.get('/moderator', async (_req, res) => {
    try {
      // Use client.callGetMethod directly
      const result = await client.callGetMethod(contract.address, 'get_moderator_address', []);
      const moderator = result.stack.readAddress();
      res.json({ moderator: moderator.toString() });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  /* ------------------ MUTATORS ------------------ */
  app.post('/deal', async (req, res) => {
    const { seller, buyer, amount, memo } = req.body;
    try {
      await sendAndWait(walletContract, async () => {
        // Create message body
        const memoCell = beginCell().storeStringTail(memo).endCell();
        const msgBody = beginCell()
          .storeUint(0x01, 32)                      // createDeal
          .storeAddress(Address.parse(seller))
          .storeAddress(Address.parse(buyer))
          .storeCoins(BigInt(amount))
          .storeRef(memoCell)
          .endCell();
        
        // Get the current seqno
        const seqno = await walletContract.getSeqno();
        
        // Create the transfer
        const transfer = walletContract.createTransfer({
          seqno,
          secretKey: key.secretKey,
          messages: [
            {
              info: {
                type: "internal",
                ihrDisabled: true,
                bounce: true,
                bounced: false,
                dest: contract.address,
                value: { coins: toNano('0.05') },
                ihrFee: 0n,
                forwardFee: 0n,
                createdLt: 0n,
                createdAt: Math.floor(Date.now() / 1000)
              },
              body: msgBody
            }
          ]
        });
        
        // Send the external message
        await client.sendExternalMessage(walletContract, transfer);
      });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  app.post('/fund', async (req, res) => {
    const { memo, value } = req.body;
    try {
      await sendAndWait(walletContract, async () => {
        // Create message body
        const memoCell = beginCell().storeStringTail(memo).endCell();
        const msgBody = beginCell()
          .storeUint(0x02, 32)                      // fundDeal
          .storeRef(memoCell)
          .endCell();
        
        // Get the current seqno
        const seqno = await walletContract.getSeqno();
        
        // Create the transfer
        const transfer = walletContract.createTransfer({
          seqno,
          secretKey: key.secretKey,
          messages: [
            {
              info: {
                type: "internal",
                ihrDisabled: true,
                bounce: true,
                bounced: false,
                dest: contract.address,
                value: { coins: BigInt(value) },
                ihrFee: 0n,
                forwardFee: 0n,
                createdLt: 0n,
                createdAt: Math.floor(Date.now() / 1000)
              },
              body: msgBody
            }
          ]
        });
        
        // Send the external message
        await client.sendExternalMessage(walletContract, transfer);
      });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  app.post('/resolve', async (req, res) => {
    const { memo, verdict } = req.body;              // verdict true → seller
    try {
      await sendAndWait(walletContract, async () => {
        // Create message body
        const memoCell = beginCell().storeStringTail(memo).endCell();
        const msgBody = beginCell()
          .storeUint(0x03, 32)                      // resolveDeal
          .storeRef(memoCell)
          .storeUint(verdict ? 1 : 0, 1)
          .endCell();
        
        // Get the current seqno
        const seqno = await walletContract.getSeqno();
        
        // Create the transfer
        const transfer = walletContract.createTransfer({
          seqno,
          secretKey: key.secretKey,
          messages: [
            {
              info: {
                type: "internal",
                ihrDisabled: true,
                bounce: true,
                bounced: false,
                dest: contract.address,
                value: { coins: toNano('0.05') },
                ihrFee: 0n,
                forwardFee: 0n,
                createdLt: 0n,
                createdAt: Math.floor(Date.now() / 1000)
              },
              body: msgBody
            }
          ]
        });
        
        // Send the external message
        await client.sendExternalMessage(walletContract, transfer);
      });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  app.post('/refund-unknown', async (req, res) => {
    const { key: keyParam } = req.body;
    try {
      await sendAndWait(walletContract, async () => {
        // Create message body
        const msgBody = beginCell()
          .storeUint(0x04, 32)                      // refundUnknown
          .storeUint(BigInt(keyParam), 64)
          .endCell();
        
        // Get the current seqno
        const seqno = await walletContract.getSeqno();
        
        // Create the transfer
        const transfer = walletContract.createTransfer({
          seqno,
          secretKey: key.secretKey,
          messages: [
            {
              info: {
                type: "internal",
                ihrDisabled: true,
                bounce: true,
                bounced: false,
                dest: contract.address,
                value: { coins: toNano('0.05') },
                ihrFee: 0n,
                forwardFee: 0n,
                createdLt: 0n,
                createdAt: Math.floor(Date.now() / 1000)
              },
              body: msgBody
            }
          ]
        });
        
        // Send the external message
        await client.sendExternalMessage(walletContract, transfer);
      });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  app.post('/withdraw', async (_req, res) => {
    try {
      await sendAndWait(walletContract, async () => {
        // Create message body
        const msgBody = beginCell()
          .storeUint(0x05, 32)                      // withdrawCommissions
          .endCell();
        
        // Get the current seqno
        const seqno = await walletContract.getSeqno();
        
        // Create the transfer
        const transfer = walletContract.createTransfer({
          seqno,
          secretKey: key.secretKey,
          messages: [
            {
              info: {
                type: "internal",
                ihrDisabled: true,
                bounce: true,
                bounced: false,
                dest: contract.address,
                value: { coins: toNano('0.05') },
                ihrFee: 0n,
                forwardFee: 0n,
                createdLt: 0n,
                createdAt: Math.floor(Date.now() / 1000)
              },
              body: msgBody
            }
          ]
        });
        
        // Send the external message
        await client.sendExternalMessage(walletContract, transfer);
      });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  /* ------------------ START ------------------ */
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () =>
    console.log(`🚀  API listening on http://localhost:${port}`)
  );
})();
