# P2P Contract Testing Documentation

This document describes the working tests for the P2P contract. These tests verify the core functionality of the contract and ensure that it behaves as expected in various scenarios.

## Working Tests

### 1. Basic Deal Creation
**Test:** `should create a deal`

This test verifies that a deal can be successfully created by the moderator. It checks:
- The deal is properly stored in the contract
- The deal counter is incremented
- The deal information can be retrieved
- The deal is initially unfunded (funded = 0)

### 2. Deal Creation and Funding
**Test:** `should create and fund a deal`

This test verifies the complete flow of creating and funding a deal:
- A deal is created by the moderator
- The buyer successfully funds the deal
- The deal's funded status is updated (funded = 1)
- The contract's commission pool is updated
- The buyer's balance is reduced by the appropriate amount

### 3. Deal Resolution in Favor of Buyer
**Test:** `should resolve deal in favor of buyer`

This test verifies that a deal can be resolved in favor of the buyer:
- A deal is created and funded
- The moderator resolves the deal in favor of the buyer (approvePayment = false)
- The buyer receives their funds back (minus commission)
- The seller's balance remains unchanged

### 4. Repeated Funding Prevention
**Test:** `Повторный FundDeal ⇒ 1-й успех, 2-й exit 131`

This test verifies that a deal cannot be funded twice:
- A deal is created and successfully funded once
- A second attempt to fund the same deal fails with exit code 131
- The funded status remains 1
- The commission pool remains unchanged

### 5. Premature Resolution Prevention
**Test:** `ResolveDeal ДО FundDeal ⇒ exit 111, funded=0`

This test verifies that a deal cannot be resolved before it is funded:
- A deal is created but not funded
- An attempt to resolve the deal fails with exit code 111
- The funded status remains 0

## Failing Tests

The following tests are currently failing and have been commented out:

1. `should resolve deal in favor of seller`
2. `should allow moderator to withdraw commissions`
3. `stores stray payment and throws on second refund`
4. `handles unknown memo correctly`
5. `commissionsPool equals Σ(amount)×3 %`
6. `creates & funds a deal on 1 nanoTON with zero commission`
7. `CreateDeal от не-модератора ⇒ exit 999, стейт не меняется`
8. `FundDeal < amount+commission ⇒ exit 132, счётчики без изменений`
9. `ResolveDeal с несуществующим memo ⇒ throw, state intact`
10. `WithdrawCommissions при pool=0 → баланс модератора не меняется`

These tests need further investigation and fixes to pass successfully.
