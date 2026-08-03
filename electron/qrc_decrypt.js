/**
 * QQ音乐 QRC 歌词解密
 *
 * 算法：魔改 TripleDES（ECB，8 字节块）+ zlib 解压
 * 密钥：!@#)(*$%123ZXC!@!@#)(NHL
 *
 * 移植自公开的 tripledes 实现（tripledes.py → JS），
 * pako 替换为 Node 内置 zlib。
 */

'use strict';

const zlib = require('zlib');

// ── S-Boxes ──────────────────────────────────────────────────────────────────
const sbox = [
  // sbox1
  [14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7,
    0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8,
    4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0,
    15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13],
  // sbox2
  [15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10,
    3, 13, 4, 7, 15, 2, 8, 15, 12, 0, 1, 10, 6, 9, 11, 5,
    0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15,
    13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9],
  // sbox3
  [10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8,
    13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1,
    13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7,
    1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12],
  // sbox4
  [7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15,
    13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9,
    10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4,
    3, 15, 0, 6, 10, 10, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14],
  // sbox5
  [2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9,
    14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6,
    4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14,
    11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3],
  // sbox6
  [12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11,
    10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8,
    9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6,
    4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13],
  // sbox7
  [4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1,
    13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6,
    1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2,
    6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12],
  // sbox8
  [13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7,
    1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2,
    7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8,
    2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11],
];

const ENCRYPT = 1;
const DECRYPT = 0;

const QRC_KEY = '!@#)(*$%123ZXC!@!@#)(NHL';

function bitnum(a, b, c) {
  return ((a[Math.floor(b / 32) * 4 + 3 - Math.floor((b % 32) / 8)] >> (7 - (b % 8))) & 1) << c;
}

function bitnumIntr(a, b, c) {
  return ((a >>> (31 - b)) & 1) << c;
}

function bitnumIntl(a, b, c) {
  return ((a << b) & 0x80000000) >>> c;
}

function sboxBit(a) {
  return (a & 32) | ((a & 31) >> 1) | ((a & 1) << 4);
}

function initialPermutation(input) {
  return [
    (
      bitnum(input, 57, 31) | bitnum(input, 49, 30) | bitnum(input, 41, 29) | bitnum(input, 33, 28)
      | bitnum(input, 25, 27) | bitnum(input, 17, 26) | bitnum(input, 9, 25) | bitnum(input, 1, 24)
      | bitnum(input, 59, 23) | bitnum(input, 51, 22) | bitnum(input, 43, 21) | bitnum(input, 35, 20)
      | bitnum(input, 27, 19) | bitnum(input, 19, 18) | bitnum(input, 11, 17) | bitnum(input, 3, 16)
      | bitnum(input, 61, 15) | bitnum(input, 53, 14) | bitnum(input, 45, 13) | bitnum(input, 37, 12)
      | bitnum(input, 29, 11) | bitnum(input, 21, 10) | bitnum(input, 13, 9) | bitnum(input, 5, 8)
      | bitnum(input, 63, 7) | bitnum(input, 55, 6) | bitnum(input, 47, 5) | bitnum(input, 39, 4)
      | bitnum(input, 31, 3) | bitnum(input, 23, 2) | bitnum(input, 15, 1) | bitnum(input, 7, 0)
    ) >>> 0,
    (
      bitnum(input, 56, 31) | bitnum(input, 48, 30) | bitnum(input, 40, 29) | bitnum(input, 32, 28)
      | bitnum(input, 24, 27) | bitnum(input, 16, 26) | bitnum(input, 8, 25) | bitnum(input, 0, 24)
      | bitnum(input, 58, 23) | bitnum(input, 50, 22) | bitnum(input, 42, 21) | bitnum(input, 34, 20)
      | bitnum(input, 26, 19) | bitnum(input, 18, 18) | bitnum(input, 10, 17) | bitnum(input, 2, 16)
      | bitnum(input, 60, 15) | bitnum(input, 52, 14) | bitnum(input, 44, 13) | bitnum(input, 36, 12)
      | bitnum(input, 28, 11) | bitnum(input, 20, 10) | bitnum(input, 12, 9) | bitnum(input, 4, 8)
      | bitnum(input, 62, 7) | bitnum(input, 54, 6) | bitnum(input, 46, 5) | bitnum(input, 38, 4)
      | bitnum(input, 30, 3) | bitnum(input, 22, 2) | bitnum(input, 14, 1) | bitnum(input, 6, 0)
    ) >>> 0,
  ];
}

function inversePermutation(s0, s1) {
  const data = new Uint8Array(8);
  data[3] = bitnumIntr(s1, 7, 7) | bitnumIntr(s0, 7, 6) | bitnumIntr(s1, 15, 5) | bitnumIntr(s0, 15, 4)
    | bitnumIntr(s1, 23, 3) | bitnumIntr(s0, 23, 2) | bitnumIntr(s1, 31, 1) | bitnumIntr(s0, 31, 0);
  data[2] = bitnumIntr(s1, 6, 7) | bitnumIntr(s0, 6, 6) | bitnumIntr(s1, 14, 5) | bitnumIntr(s0, 14, 4)
    | bitnumIntr(s1, 22, 3) | bitnumIntr(s0, 22, 2) | bitnumIntr(s1, 30, 1) | bitnumIntr(s0, 30, 0);
  data[1] = bitnumIntr(s1, 5, 7) | bitnumIntr(s0, 5, 6) | bitnumIntr(s1, 13, 5) | bitnumIntr(s0, 13, 4)
    | bitnumIntr(s1, 21, 3) | bitnumIntr(s0, 21, 2) | bitnumIntr(s1, 29, 1) | bitnumIntr(s0, 29, 0);
  data[0] = bitnumIntr(s1, 4, 7) | bitnumIntr(s0, 4, 6) | bitnumIntr(s1, 12, 5) | bitnumIntr(s0, 12, 4)
    | bitnumIntr(s1, 20, 3) | bitnumIntr(s0, 20, 2) | bitnumIntr(s1, 28, 1) | bitnumIntr(s0, 28, 0);
  data[7] = bitnumIntr(s1, 3, 7) | bitnumIntr(s0, 3, 6) | bitnumIntr(s1, 11, 5) | bitnumIntr(s0, 11, 4)
    | bitnumIntr(s1, 19, 3) | bitnumIntr(s0, 19, 2) | bitnumIntr(s1, 27, 1) | bitnumIntr(s0, 27, 0);
  data[6] = bitnumIntr(s1, 2, 7) | bitnumIntr(s0, 2, 6) | bitnumIntr(s1, 10, 5) | bitnumIntr(s0, 10, 4)
    | bitnumIntr(s1, 18, 3) | bitnumIntr(s0, 18, 2) | bitnumIntr(s1, 26, 1) | bitnumIntr(s0, 26, 0);
  data[5] = bitnumIntr(s1, 1, 7) | bitnumIntr(s0, 1, 6) | bitnumIntr(s1, 9, 5) | bitnumIntr(s0, 9, 4)
    | bitnumIntr(s1, 17, 3) | bitnumIntr(s0, 17, 2) | bitnumIntr(s1, 25, 1) | bitnumIntr(s0, 25, 0);
  data[4] = bitnumIntr(s1, 0, 7) | bitnumIntr(s0, 0, 6) | bitnumIntr(s1, 8, 5) | bitnumIntr(s0, 8, 4)
    | bitnumIntr(s1, 16, 3) | bitnumIntr(s0, 16, 2) | bitnumIntr(s1, 24, 1) | bitnumIntr(s0, 24, 0);
  return data;
}

function f(state, key) {
  const t1 = (
    bitnumIntl(state, 31, 0)
    | ((state & 0xF0000000) >>> 1)
    | bitnumIntl(state, 4, 5)
    | bitnumIntl(state, 3, 6)
    | ((state & 0x0F000000) >>> 3)
    | bitnumIntl(state, 8, 11)
    | bitnumIntl(state, 7, 12)
    | ((state & 0x00F00000) >>> 5)
    | bitnumIntl(state, 12, 17)
    | bitnumIntl(state, 11, 18)
    | ((state & 0x000F0000) >>> 7)
    | bitnumIntl(state, 16, 23)
  ) >>> 0;

  const t2 = (
    bitnumIntl(state, 15, 0)
    | ((state & 0x0000F000) << 15)
    | bitnumIntl(state, 20, 5)
    | bitnumIntl(state, 19, 6)
    | ((state & 0x00000F00) << 13)
    | bitnumIntl(state, 24, 11)
    | bitnumIntl(state, 23, 12)
    | ((state & 0x000000F0) << 11)
    | bitnumIntl(state, 28, 17)
    | bitnumIntl(state, 27, 18)
    | ((state & 0x0000000F) << 9)
    | bitnumIntl(state, 0, 23)
  ) >>> 0;

  const lrgstate = [
    (t1 >>> 24) & 0xFF,
    (t1 >>> 16) & 0xFF,
    (t1 >>> 8) & 0xFF,
    (t2 >>> 24) & 0xFF,
    (t2 >>> 16) & 0xFF,
    (t2 >>> 8) & 0xFF,
  ];

  for (let i = 0; i < 6; i++) {
    lrgstate[i] = lrgstate[i] ^ key[i];
  }

  const stateRes = (
    (sbox[0][sboxBit(lrgstate[0] >> 2)] << 28)
    | (sbox[1][sboxBit(((lrgstate[0] & 0x03) << 4) | (lrgstate[1] >> 4))] << 24)
    | (sbox[2][sboxBit(((lrgstate[1] & 0x0F) << 2) | (lrgstate[2] >> 6))] << 20)
    | (sbox[3][sboxBit(lrgstate[2] & 0x3F)] << 16)
    | (sbox[4][sboxBit(lrgstate[3] >> 2)] << 12)
    | (sbox[5][sboxBit(((lrgstate[3] & 0x03) << 4) | (lrgstate[4] >> 4))] << 8)
    | (sbox[6][sboxBit(((lrgstate[4] & 0x0F) << 2) | (lrgstate[5] >> 6))] << 4)
    | sbox[7][sboxBit(lrgstate[5] & 0x3F)]
  ) >>> 0;

  return (
    bitnumIntl(stateRes, 15, 0) | bitnumIntl(stateRes, 6, 1) | bitnumIntl(stateRes, 19, 2)
    | bitnumIntl(stateRes, 20, 3) | bitnumIntl(stateRes, 28, 4) | bitnumIntl(stateRes, 11, 5)
    | bitnumIntl(stateRes, 27, 6) | bitnumIntl(stateRes, 16, 7) | bitnumIntl(stateRes, 0, 8)
    | bitnumIntl(stateRes, 14, 9) | bitnumIntl(stateRes, 22, 10) | bitnumIntl(stateRes, 25, 11)
    | bitnumIntl(stateRes, 4, 12) | bitnumIntl(stateRes, 17, 13) | bitnumIntl(stateRes, 30, 14)
    | bitnumIntl(stateRes, 9, 15) | bitnumIntl(stateRes, 1, 16) | bitnumIntl(stateRes, 7, 17)
    | bitnumIntl(stateRes, 23, 18) | bitnumIntl(stateRes, 13, 19) | bitnumIntl(stateRes, 31, 20)
    | bitnumIntl(stateRes, 26, 21) | bitnumIntl(stateRes, 2, 22) | bitnumIntl(stateRes, 8, 23)
    | bitnumIntl(stateRes, 18, 24) | bitnumIntl(stateRes, 12, 25) | bitnumIntl(stateRes, 29, 26)
    | bitnumIntl(stateRes, 5, 27) | bitnumIntl(stateRes, 21, 28) | bitnumIntl(stateRes, 10, 29)
    | bitnumIntl(stateRes, 3, 30) | bitnumIntl(stateRes, 24, 31)
  ) >>> 0;
}

function crypt(inputData, key) {
  let [s0, s1] = initialPermutation(inputData);
  for (let idx = 0; idx < 15; idx++) {
    const prevS1 = s1;
    s1 = (f(s1, key[idx]) ^ s0) >>> 0;
    s0 = prevS1;
  }
  s0 = (f(s1, key[15]) ^ s0) >>> 0;
  return inversePermutation(s0, s1);
}

function keySchedule(key, mode) {
  const schedule = Array(16).fill(0).map(() => Array(6).fill(0));
  const keyRndShift = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];
  const keyPermC = [
    56, 48, 40, 32, 24, 16, 8, 0, 57, 49, 41, 33, 25, 17, 9, 1,
    58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35,
  ];
  const keyPermD = [
    62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21, 13, 5,
    60, 52, 44, 36, 28, 20, 12, 4, 27, 19, 11, 3,
  ];
  const keyCompression = [
    13, 16, 10, 23, 0, 4, 2, 27, 14, 5, 20, 9, 22, 18, 11, 3,
    25, 7, 15, 6, 26, 19, 12, 1, 40, 51, 30, 36, 46, 54, 29, 39,
    50, 44, 32, 47, 43, 48, 38, 55, 33, 52, 45, 41, 49, 35, 28, 31,
  ];

  let c = 0;
  for (let i = 0; i < 28; i++) c = (c + bitnum(key, keyPermC[i], 31 - i)) >>> 0;
  let d = 0;
  for (let i = 0; i < 28; i++) d = (d + bitnum(key, keyPermD[i], 31 - i)) >>> 0;

  for (let i = 0; i < 16; i++) {
    c = (((c << keyRndShift[i]) | (c >>> (28 - keyRndShift[i]))) & 0xFFFFFFF0) >>> 0;
    d = (((d << keyRndShift[i]) | (d >>> (28 - keyRndShift[i]))) & 0xFFFFFFF0) >>> 0;

    const togen = mode === DECRYPT ? 15 - i : i;
    for (let j = 0; j < 6; j++) schedule[togen][j] = 0;
    for (let j = 0; j < 24; j++) {
      schedule[togen][Math.floor(j / 8)] |= bitnumIntr(c, keyCompression[j], 7 - (j % 8));
    }
    for (let j = 24; j < 48; j++) {
      schedule[togen][Math.floor(j / 8)] |= bitnumIntr(d, keyCompression[j] - 27, 7 - (j % 8));
    }
  }
  return schedule;
}

function tripledesKeySetup(key, mode) {
  if (mode === ENCRYPT) {
    return [
      keySchedule(key.slice(0, 8), ENCRYPT),
      keySchedule(key.slice(8, 16), DECRYPT),
      keySchedule(key.slice(16, 24), ENCRYPT),
    ];
  }
  return [
    keySchedule(key.slice(16, 24), DECRYPT),
    keySchedule(key.slice(8, 16), ENCRYPT),
    keySchedule(key.slice(0, 8), DECRYPT),
  ];
}

function tripledesCrypt(data, key) {
  let res = data;
  for (let i = 0; i < 3; i++) {
    res = crypt(res, key[i]);
  }
  return res;
}

// 密钥调度只算一次（密钥固定）
let _schedule = null;
function _getSchedule() {
  if (!_schedule) {
    _schedule = tripledesKeySetup(Buffer.from(QRC_KEY, 'utf-8'), DECRYPT);
  }
  return _schedule;
}

/**
 * 解密 QQ 加密歌词字段
 * @param {Buffer|Uint8Array} encrypted base64 解码后的密文（8 字节倍数）
 * @returns {string} 解密并 zlib 解压后的文本；失败返回空串
 */
function decryptQqLyric(encrypted) {
  if (!encrypted || encrypted.length === 0) return '';
  try {
    const schedule = _getSchedule();
    const blocks = [];
    let total = 0;
    for (let i = 0; i + 8 <= encrypted.length; i += 8) {
      const chunk = encrypted.slice(i, i + 8);
      const dec = tripledesCrypt(chunk, schedule);
      blocks.push(dec);
      total += dec.length;
    }
    if (total === 0) return '';
    const combined = Buffer.concat(blocks.map((b) => Buffer.from(b)), total);

    // zlib 解压（先标准头，失败则 raw deflate）
    try {
      return zlib.inflateSync(combined).toString('utf-8');
    } catch (e) {
      return zlib.inflateRawSync(combined).toString('utf-8');
    }
  } catch (e) {
    return '';
  }
}

module.exports = { decryptQqLyric };
