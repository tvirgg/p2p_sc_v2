### Что нужно сделать, чтобы поднять контракт до рабочей **v 1.3**

| Шаг | Действие | Где править |
|----|-----------|-------------|
| **1** | **Удаляйте ключ из стека правильно** | В `add_to_unknown_funds` замените<br>`uf_free_stack~udict_delete?(32, free_key);`<br>на<br>`(uf_free_stack, _) = uf_free_stack.udict_delete?(32, free_key);` |
| **2** | **Обновляйте unknown_funds при возврате** | В блоке `op_refund_unknown` поменяйте<br>`uf~udict_delete?(32, k);`<br>на<br>`(uf, _) = uf.udict_delete?(32, k);` |
| **3** | **Перебирайте словари без удаления** | В `debug_get_contract_data()` вместо циклов-стиралок используйте<br>`int uf_live_count  = uf.udict_len();`<br>`int uf_free_count  = uf_free_stack.udict_len();` |
| **4** | **Сохраните state после правок** | Обновите вызовы `save_data(…, uf_free_stack)` там, где поменялся `uf` или `uf_free_stack` (все уже стоят — просто убедитесь, что 