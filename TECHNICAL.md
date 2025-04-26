# Смарт‑контракт P2P Escrow (v2.1) — Техническая документация

> **Версия исходного кода:** commit/branch от 26 апреля 2025   ·  **Язык:** FunC   ·  **Сеть:** TON mainnet/testnet
>
> Документ описывает актуальную реализацию, отражающую логику «100 % → 97 % продавцу / 3 % пул, переплата → unknown_funds, резерв 0.5 TON».

---

## 1. Архитектура и данные контракта

| Поле | Тип | Описание |
|------|-----|----------|
| `deals_counter` | `int32` | Счётчик ID сделок |
| `deals_dict` | `dict 32→cell` | Данные сделок |
| `memo_map` | `dict 256→slice` | Хэш memo → ID сделки |
| `unknown_funds` | `dict 32→cell` | Переплаты / stray‑платежи |
| `moderator_address` | `slice` | Адрес модератора |
| `commissions_pool` | `int` (nanoTON) | Накопленные комиссии + резерв 0.5 TON |

### Формат записи сделки
```
begin_cell()
  .store_slice(seller)
  .store_slice(buyer)
  .store_coins(amount)   ;; изначальный amt (до комиссии)
  .store_uint(is_funded, 1)
.end_cell()
```

### Формат unknown funds
```
begin_cell()
  .store_slice(origin)
  .store_uint(value, 128)  ;; нетто‑сумма без комиссии
.end_cell()
```

---

## 2. Константы
```func
const int COMMISSION_PERCENT  = 3;          ;; 3 %
const int MIN_CREATE_FEE      = 3_000_000;  ;; 0.03 TON депозит за создание
const int MIN_CP_FOR_ADMIN    = 3_000_000;  ;; минимум для мод‑действий
const int CP_RESERVE_GAS      = 500_000_000;; 0.5 TON резерв в пуле
```

---

## 3. Op‑коды и права вызова
| Код | Имя | Кто вызывает | Кратко |
|-----|-----|--------------|--------|
| 1 | `op_create_deal` | любой | Создать сделку (вносит `MIN_CREATE_FEE`) |
| 5 | `op_fund_deal` | покупатель | Перевести ≥ `amt` (излишек → unknown) |
| 2 | `op_resolve_deal` | модератор | Решить исход сделки |
| 3 | `op_refund_unknown` | модератор | Вернуть запись из unknown_funds |
| 4 | `op_withdraw_commissions` | модератор | Вывести cp – 0.5 TON |

Внешние сообщения (`recv_external`) заблокированы — вся логика во `recv_internal`.

---

## 4. Алгоритмы операций

### 4.1 Создание сделки
1. Проверка `msg_value ≥ MIN_CREATE_FEE` → иначе `throw 301`.
2. `commissions_pool += MIN_CREATE_FEE`.
3. Создаётся запись сделки (`funded = 0`).
4. Хэш memo → ID в `memo_map`.

### 4.2 Финансирование сделки
```func
throw_if(132, msg_value < amt);       ;; ≥ amt
fee  = (amt * 3) / 100;
cp  += fee;                           ;; только с amt
if (msg_value > amt) {
    uf = add_to_unknown_funds(uf, sender, msg_value - amt);
}
mark funded & save;
```

### 4.3 Решение сделки
*Проверка* `cp ≥ MIN_CP_FOR_ADMIN` (код 401).

| verdict | Получатель | Сумма |
|---------|------------|-------|
| 1 | продавец | `amt – 3 %` |
| 0 | покупатель | `amt` |

Комиссия остаётся в пуле (`cp`).

### 4.4 Страй‑платёж / переплата без op
1. Удерживается 3 % комиссии.  
2. Нетто заносится в `unknown_funds`.

### 4.5 Вывод комиссий
```
if (cp > 0.5 TON) {
    send_transfer(moderator, cp - 0.5 TON);
    cp = 0.5 TON;
}
```

---

## 5. Коды ошибок
| Код | Событие |
|-----|---------|
| 100 | Дубликат memo |
| 110 | Memo не найден |
| 111 | Сделка не профинансирована |
| 120 | Unknown fund по ключу не найден |
| 130 | Сделка по memo не найдена |
| 131 | Сделка уже профинансирована |
| 132 | Недостаточно средств (fund) |
| 150 | Сумма < 0.1 TON (stray) |
| 160 | cp недостаточен для вывода |
| 401 | cp < MIN_CP_FOR_ADMIN |
| 999 | Нет прав модератора |

---

## 6. Вызовы для фронтенда
| Операция | `value` | `body` |
|----------|---------|--------|
| create deal | `0.03 TON` | `[op=1][seller][buyer][amt][memo]` |
| fund deal | `amt (+ overpay)` | `[op=5][memo]` |
| resolve deal | `0` | `[op=2][memo][verdict]` |
| refund unknown | `0` | `[op=3][key]` |
| withdraw commissions | `0` | `[op=4]` |

Важно: UI должен подсвечивать, что переплата не возвращается сразу, а хранится в unknown_funds.

---

## 7. Экономика и инварианты
* `cp ≥ 0.5 TON` всегда после `withdraw`.
* Сумма TON внутри контракта = `∑ funded amt – выплата` + `cp` + `unknown_funds`.
* Модератор никогда не расходует свой баланс на газ.
* Спамер платит минимум 0.03 TON за попытку.

---

## 8. Безопасность
* Все state‑changing функции кроме `fund` требуют `cp ≥ MIN_CP_FOR_ADMIN` (DOS‑защита).
* Memo‑hash гарантирует уникальность сделки.
* Отправка средств — `send_raw_message(msg, 3)` (pay fees separately + ignore errors).

---

## 9. Планы развития
1. Тайм‑ауты и авто‑refund при бездействии.  
2. Переменные комиссии.  
3. Мультисиг‑модерация.

---

## 10. TL;DR
*Покупатель* отправляет 100 % → *контракт* удерживает 3 % → *продавец* получает 97 %.  Переплаты и stray‑платежи безопасно складируются, модератор управляет ими при необходимости.

