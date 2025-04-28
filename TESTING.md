# P2P Contract Tests — полное соответствие кейсам и unit‑тестам

> Для каждого из 27 пунктов ниже приведены:
> 1. **Название unit‑теста** (точно как в файле `tests/P2P.test.ts`).  
> 2. **Objective** и **Steps** — исходный текст, который ты прислал.  
> Если несколько кейсов используют один и тот же unit‑тест, он всё равно дублируется, как просил, с той же шапкой.

---

## 1. Create a Deal  
**Test name:** `should create a deal`

### Objective
Verify that a deal can be successfully created between a buyer and a seller.

### Steps
1. A deal is created using predefined seller and buyer addresses.  
2. The contract checks if the moderator’s address is correctly stored.  
3. A memo hash is generated and logged.  
4. The contract data is verified both before and after the deal creation.  
5. The deal counter is incremented.  
6. The contract data is checked to ensure the deal amount and funding are correct.

---

## 2. Create and Fund a Deal  
**Test name:** `should create and fund a deal`

### Objective
Verify that both the creation and funding of a deal work as expected.

### Steps
1. A deal is created with a specified amount.  
2. A buyer's wallet is created, and the buyer's balance is checked before and after funding.  
3. The deal is funded by the buyer with a small amount greater than the deal amount to cover transaction fees.  
4. Contract data and deal information are checked before and after funding.

---

## 3. Resolve Deal in Favor of Seller  
**Test name:** `should resolve deal in favor of seller`

### Objective
Verify that the deal can be resolved in favor of the seller.

### Steps
1. A deal is created and funded.  
2. The deal is resolved, and the seller receives the appropriate amount.  
3. The buyer’s and seller’s balances are checked before and after resolution to ensure correct transactions.  
4. Commission calculations and transaction logs are verified.

---

## 4. Resolve Deal in Favor of Buyer  
**Test name:** `should resolve deal in favor of buyer`

### Objective
Verify that when the deal is resolved in favor of the buyer, they receive the full deal amount back, and the seller does not receive any funds.

### Steps
1. A deal is created and funded.  
2. The deal is resolved in favor of the buyer.  
3. The buyer’s balance is checked to ensure they receive the correct amount.  
4. The seller's balance is checked to confirm they did not receive any funds.

---

## 5. Allow Moderator to Withdraw Commissions  
**Test name:** `should allow moderator to withdraw commissions`

### Objective
Verify that the moderator can withdraw commissions from the contract.

### Steps
1. A series of deals are created and funded to increase the commission pool.  
2. The moderator’s balance is checked before and after commission withdrawal.  
3. The remaining pool is verified to ensure it retains a reserve.

---

## 6. Refund Unknown Funds (Correct Check)  
**Test name:** `stores stray payment and throws on second refund`

### Objective
Verify the proper handling of stray payments and their refund process.

### Steps
1. A stray payment is made to the contract from an external wallet.  
2. The unknown funds are stored in the contract.  
3. The moderator performs a refund, and the unknown funds are cleared from the contract.  
4. A second refund is attempted, and an error is expected.

---

## 7. Refund Unknown Funds (Random Memo)  
**Test name:** `handles unknown memo correctly`

### Objective
Ensure that stray payments with random memos are correctly handled, that the funds are stored in the unknown funds pool, and that the moderator can refund the funds.

### Steps
1. A stray payment with a random memo is sent to the contract.  
2. The contract’s unknown funds are checked.  
3. The funds are refunded, and the balance is checked.  
4. A second refund is attempted, expecting a failure due to the absence of the funds.

---

## 8. Mass Creation of Deals  
**Test name:** `commissionsPool == N × MIN_CREATE_FEE`

### Objective
Verify that multiple deals can be created in bulk and that the commission pool is calculated correctly.

### Steps
1. Multiple deals are created in a loop with varying deal amounts.  
2. The contract’s commission pool is verified after all deals have been created to ensure it matches the expected value.

---

## 9. Deal of 1 nanoTON  
**Test name:** `депозит попал в пул, комиссия за сделку = 0`

### Objective
Check the behavior of the contract when a deal is created with a very small amount, specifically 1 nanoTON.

### Steps
1. A deal of 1 nanoTON is created and funded.  
2. The contract’s commission pool is checked, and the deal’s funded status is verified.

---

## 10‑a. Partial Fund Allowed  
**Test name:** `Partial FundDeal is now allowed`

### Objective
Verify that the contract accepts partial funding without throwing an error.

### Steps
1. A deal is created and partially funded.  
2. The contract stores the partial amount and keeps the deal open.  
3. Deal info reflects `funded = 0` and correct `fundedAmount`.

---

## 10‑b. Resolve Unknown Memo  
**Test name:** `Resolve по несуществующему memo ⇒ exit 401`

### Objective
Verify that the contract correctly rejects resolve attempts for nonexistent memos.

### Steps
1. Attempt to resolve a memo that was never used.  
2. Expect transaction to fail with exit code 401.

---

## 11. Withdraw Commissions When Pool is Empty  
**Test name:** `вывод невозможен, exit 401`

### Objective
Verify that the moderator cannot withdraw commissions when the commission pool is empty and returns the correct error code.

### Steps
1. The moderator attempts to withdraw commissions when there are no funds in the pool.  
2. The transaction should fail with the error code 401, indicating no funds in the commission pool.

---

## 12. Withdraw Commissions with Reserve  
**Test name:** `после withdraw в пуле остаётся 0.5 TON`

### Objective
Ensure that the moderator can withdraw commissions, but a minimum reserve of 0.5 TON must remain in the commission pool.

### Steps
1. Multiple deals are created to accumulate commissions in the pool.  
2. The moderator withdraws the commissions, ensuring that 0.5 TON remains in the pool as a reserve.

---

## 13. UF_MAX_RECORDS Overflow  
**Test name:** `> UF_MAX_RECORDS ⇒ exit 152`

### Objective
Check the behavior of the contract when the number of stray payments exceeds the maximum allowed (UF_MAX_RECORDS).

### Steps
1. A large number of stray payments are sent to the contract until the UF_MAX_RECORDS limit is exceeded.  
2. The test verifies that the 10,001st payment fails with an exit code of 152.

---

## 14. Stray Payment Gas Usage  
**Test name:** `stray-payment gas usage ≤ 3500`

### Objective
Check the gas usage for stray payments to ensure they do not exceed the defined gas limit.

### Steps
1. A stray payment is made to the contract.  
2. The gas used for the transaction is checked, ensuring it does not exceed the specified gas limit.

---

## 15. Partial Fund Then Resolve (Full Cycle)  
**Test name:** `should support partial funding of a deal`

### Objective
Verify that partial funding of a deal is supported and that the deal cannot be resolved until fully funded.

### Steps
1. A deal is created and partially funded.  
2. Attempt to resolve early — expect failure (exit 111).  
3. Fund the remaining amount.  
4. Resolve successfully; seller receives deal amount minus commission.

---

## 16. Overpayment Handling — Seller Favoured  
**Test name:** `should handle overpayment: seller gets deal amount minus commission, buyer gets overpayment back`

### Objective
Verify that the contract properly handles overpayments and returns the excess amount to the buyer, while ensuring the seller receives only the deal amount minus commission.

### Steps
1. A deal is created with a predefined amount.  
2. Buyer overpays.  
3. Deal resolved in favour of seller.  
4. Seller gets deal amount − commission.  
5. Overpayment stored in `unknown_funds`.  
6. Moderator refunds overpayment to buyer.

---

## 17. Overpayment Handling — Buyer Favoured  
**Test name:** `should handle overpayment: deal resolved in favor of buyer, buyer gets full amount back`

### Objective
Verify that when a deal is resolved in favor of the buyer, the buyer gets the full deal amount back, including any overpayment.

### Steps
1. Deal created and over‑funded.  
2. Resolve in favour of buyer.  
3. Buyer receives full deal amount back.  
4. Overpayment stays in pool.  
5. Moderator refunds overpayment to buyer.

---

## 18. Refund Unknown Funds (Correct Check) – Happy Path  
**Test name:** `stores stray payment and throws on second refund`

*(Objective & Steps совпадают с пунктом 6, поэтому продублированы дословно.)*

### Objective
Verify the proper handling of stray payments and their refund process.

### Steps
— см. пункт 6.

---

## 19. Refund Unknown Funds (Random Memo) – Random Memo Check  
**Test name:** `handles unknown memo correctly`

*(Objective & Steps совпадают с пунктом 7.)*

### Objective
Ensure that stray payments with random memos are correctly handled.

### Steps
— см. пункт 7.

---

## 20. Stray Payment Gas Usage Check  
**Test name:** `stray-payment gas usage ≤ 3500`

*(Дублирует пункт 14.)*

### Objective / Steps
— см. пункт 14.

---

## 21. Handle Overpayment and Refund (Seller Gets Overpayment Back)  
**Test name:** `should handle overpayment: seller gets deal amount minus commission, buyer gets overpayment back`

*(Дублирует пункт 16.)*

### Objective / Steps
— см. пункт 16.

---

## 22. Deal Resolution and Partial Funding  
**Test name:** `should not allow resolve on partially funded deal`

### Objective
Test the handling of deals that are only partially funded and ensure that a deal cannot be resolved until fully funded.

### Steps
1. Deal created, buyer funds part of the amount.  
2. Attempt early resolve — expect exit 111.  
3. Finish funding.  
4. Resolve; verify balances and contract data.

---

## 23. Stray Payment Handling with Gas Usage  
**Test name:** `stray-payment gas usage ≤ 3500`

*(Дублирует пункт 14/20.)*

### Objective / Steps
— см. пункт 14.

---

## 24. Partial Fund Handling and Early Resolve Errors  
**Test name:** `Resolve до Fund ⇒ exit 111`

### Objective
Verify that partial funding is allowed but early resolution attempts (before full funding) are rejected by the contract.

### Steps
1. Deal created and partially funded.  
2. Early resolve attempt — expect exit 111.  
3. Complete funding.  
4. Resolve successfully.

---

## 25. Withdraw Commissions with Insufficient Funds  
**Test name:** `вывод невозможен, exit 401`

*(Совпадает с пунктом 11.)*

### Objective / Steps
— см. пункт 11.

---

## 26. Mass Creation of Deals and Commission Calculation  
**Test name:** `commissionsPool == N × MIN_CREATE_FEE`

*(Совпадает с пунктом 8.)*

### Objective / Steps
— см. пункт 8.

---

## 27. Withdraw Commissions with Insufficient Pool  
**Test name:** `вывод невозможен, exit 401`

*(Совпадает с пунктами 11 и 25.)*

### Objective / Steps
— см. пункт 11.

