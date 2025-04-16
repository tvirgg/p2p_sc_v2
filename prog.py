import base64


def ton_address_from_raw_msgaddr(data: bytes) -> str:
    """
    Преобразует сериализованный msg_address (267 бит) в user-friendly TON адрес (EQ...)
    """
    if len(data) < 34:
        raise ValueError("Ожидался msg_address длиной 34 байта (267 бит)")

    # 1. Первый байт: tag (0b01000011 = 0x43 = std addr)
    tag = data[0]
    if tag != 0x43:
        raise ValueError(f"Невалидный tag msg_address: {tag}")

    # 2. Второй байт — workchain_id (например, 0 или -1)
    wc = int.from_bytes(data[1:2], "big", signed=True)

    # 3. Следующие 32 байта — это hash part (address)
    hash_part = data[2:34]
    if len(hash_part) != 32:
        raise ValueError("Неверная длина address hash part")

    # 4. Собираем std addr
    addr = bytes([0x51]) + wc.to_bytes(1, "big", signed=True) + hash_part

    # 5. Добавляем CRC16-XMODEM
    crc = crc16_xmodem(addr)
    full = addr + crc.to_bytes(2, "big")

    # 6. Кодируем в base64
    return base64.urlsafe_b64encode(full).decode().rstrip("=")


def crc16_xmodem(data: bytes) -> int:
    crc = 0
    for b in data:
        crc ^= b << 8
        for _ in range(8):
            if (crc & 0x8000):
                crc = (crc << 1) ^ 0x1021
            else:
                crc <<= 1
            crc &= 0xFFFF
    return crc


def convert_hex_to_base64_ton_address(hex_str: str) -> str:
    if "Cell{" in hex_str:
        hex_str = hex_str.split("Cell{")[1].split("}")[0]
    hex_str = hex_str.strip()

    raw_bytes = bytes.fromhex(hex_str)

    # Автоматически скипаем первый байт, если он 0
    if raw_bytes[0] == 0x00 and len(raw_bytes) > 34:
        raw_bytes = raw_bytes[1:]

    return ton_address_from_raw_msgaddr(raw_bytes)


# 🔍 Пример
if __name__ == "__main__":
    hex_input = "00438002a3a4fdecfc7d88b9e00213ec4b253dda4b481fb7617c690e4ab4500d5d918d30"
    result = convert_hex_to_base64_ton_address(hex_input)
    print("✅ TON адрес (Base64):", result)
