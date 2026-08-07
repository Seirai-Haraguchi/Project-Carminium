/**
 * Carminium — 排序键生成器
 * 将包含中文、日文假名的字符串转换为可用于 A-Z 排序的拉丁字母键。
 *
 * - 汉字 → 拼音（通过 pinyin-pro）
 * - 平假名 / 片假名 → 罗马音（Hepburn 式，内置表）
 * - 拉丁字母 / 数字 → 保持原样
 */
'use strict';

const { pinyin } = require('pinyin-pro');

// ── 平假名 → 罗马音（Hepburn）────────────────────────────────────────────────

// 按「长键优先」排列，保证 きゃ 先于 き 被匹配
const HIRAGANA_TABLE = [
  // yōon
  ['きゃ', 'kya'], ['きゅ', 'kyu'], ['きょ', 'kyo'],
  ['しゃ', 'sha'], ['しゅ', 'shu'], ['しょ', 'sho'],
  ['ちゃ', 'cha'], ['ちゅ', 'chu'], ['ちょ', 'cho'],
  ['にゃ', 'nya'], ['にゅ', 'nyu'], ['にょ', 'nyo'],
  ['ひゃ', 'hya'], ['ひゅ', 'hyu'], ['ひょ', 'hyo'],
  ['みゃ', 'mya'], ['みゅ', 'myu'], ['みょ', 'myo'],
  ['りゃ', 'rya'], ['りゅ', 'ryu'], ['りょ', 'ryo'],
  ['ぎゃ', 'gya'], ['ぎゅ', 'gyu'], ['ぎょ', 'gyo'],
  ['じゃ', 'ja'],  ['じゅ', 'ju'],  ['じょ', 'jo'],
  ['びゃ', 'bya'], ['びゅ', 'byu'], ['びょ', 'byo'],
  ['ぴゃ', 'pya'], ['ぴゅ', 'pyu'], ['ぴょ', 'pyo'],
  // 拗音的小 ゃゅょ 单独出现
  ['ゃ', 'ya'], ['ゅ', 'yu'], ['ょ', 'yo'],
  // 基本音
  ['あ', 'a'], ['い', 'i'], ['う', 'u'], ['え', 'e'], ['お', 'o'],
  ['か', 'ka'], ['き', 'ki'], ['く', 'ku'], ['け', 'ke'], ['こ', 'ko'],
  ['さ', 'sa'], ['し', 'shi'], ['す', 'su'], ['せ', 'se'], ['そ', 'so'],
  ['た', 'ta'], ['ち', 'chi'], ['つ', 'tsu'], ['て', 'te'], ['と', 'to'],
  ['な', 'na'], ['に', 'ni'], ['ぬ', 'nu'], ['ね', 'ne'], ['の', 'no'],
  ['は', 'ha'], ['ひ', 'hi'], ['ふ', 'fu'], ['へ', 'he'], ['ほ', 'ho'],
  ['ま', 'ma'], ['み', 'mi'], ['む', 'mu'], ['め', 'me'], ['も', 'mo'],
  ['や', 'ya'], ['ゆ', 'yu'], ['よ', 'yo'],
  ['ら', 'ra'], ['り', 'ri'], ['る', 'ru'], ['れ', 're'], ['ろ', 'ro'],
  ['わ', 'wa'], ['を', 'wo'], ['ん', 'n'],
  // 濁音
  ['が', 'ga'], ['ぎ', 'gi'], ['ぐ', 'gu'], ['げ', 'ge'], ['ご', 'go'],
  ['ざ', 'za'], ['じ', 'ji'], ['ず', 'zu'], ['ぜ', 'ze'], ['ぞ', 'zo'],
  ['だ', 'da'], ['ぢ', 'ji'], ['づ', 'zu'], ['で', 'de'], ['ど', 'do'],
  ['ば', 'ba'], ['び', 'bi'], ['ぶ', 'bu'], ['べ', 'be'], ['ぼ', 'bo'],
  // 半濁音
  ['ぱ', 'pa'], ['ぴ', 'pi'], ['ぷ', 'pu'], ['ぺ', 'pe'], ['ぽ', 'po'],
  // 小文字
  ['ぁ', 'a'], ['ぃ', 'i'], ['ぅ', 'u'], ['ぇ', 'e'], ['ぉ', 'o'],
  ['ゎ', 'wa'],
  // 促音（映射为标记符，后续处理双写）
  ['っ', '\x01'],
  // ー（长音符号）
  ['ー', '-'],
];

// ── 片假名 → 罗马音 ─────────────────────────────────────────────────────────

const KATAKANA_TABLE = [
  // yōon
  ['キャ', 'kya'], ['キュ', 'kyu'], ['キョ', 'kyo'],
  ['シャ', 'sha'], ['シュ', 'shu'], ['ショ', 'sho'],
  ['チャ', 'cha'], ['チュ', 'chu'], ['チョ', 'cho'],
  ['ニャ', 'nya'], ['ニュ', 'nyu'], ['ニョ', 'nyo'],
  ['ヒャ', 'hya'], ['ヒュ', 'hyu'], ['ヒョ', 'hyo'],
  ['ミャ', 'mya'], ['ミュ', 'myu'], ['ミョ', 'myo'],
  ['リャ', 'rya'], ['リュ', 'ryu'], ['リョ', 'ryo'],
  ['ギャ', 'gya'], ['ギュ', 'gyu'], ['ギョ', 'gyo'],
  ['ジャ', 'ja'],  ['ジュ', 'ju'],  ['ジョ', 'jo'],
  ['ビャ', 'bya'], ['ビュ', 'byu'], ['ビョ', 'byo'],
  ['ピャ', 'pya'], ['ピュ', 'pyu'], ['ピョ', 'pyo'],
  // 外来语拗音
  ['ファ', 'fa'],  ['フィ', 'fi'],  ['フェ', 'fe'],  ['フォ', 'fo'],
  ['ティ', 'ti'],  ['ディ', 'di'],  ['トゥ', 'tu'],  ['ドゥ', 'du'],
  ['ウィ', 'wi'],  ['ウェ', 'we'],  ['ウォ', 'wo'],
  ['ツァ', 'tsa'], ['ツィ', 'tsi'], ['ツェ', 'tse'], ['ツォ', 'tso'],
  ['ジェ', 'je'],  ['チェ', 'che'],
  // 基本音
  ['ア', 'a'], ['イ', 'i'], ['ウ', 'u'], ['エ', 'e'], ['オ', 'o'],
  ['カ', 'ka'], ['キ', 'ki'], ['ク', 'ku'], ['ケ', 'ke'], ['コ', 'ko'],
  ['サ', 'sa'], ['シ', 'shi'], ['ス', 'su'], ['セ', 'se'], ['ソ', 'so'],
  ['タ', 'ta'], ['チ', 'chi'], ['ツ', 'tsu'], ['テ', 'te'], ['ト', 'to'],
  ['ナ', 'na'], ['ニ', 'ni'], ['ヌ', 'nu'], ['ネ', 'ne'], ['ノ', 'no'],
  ['ハ', 'ha'], ['ヒ', 'hi'], ['フ', 'fu'], ['ヘ', 'he'], ['ホ', 'ho'],
  ['マ', 'ma'], ['ミ', 'mi'], ['ム', 'mu'], ['メ', 'me'], ['モ', 'mo'],
  ['ヤ', 'ya'], ['ユ', 'yu'], ['ヨ', 'yo'],
  ['ラ', 'ra'], ['リ', 'ri'], ['ル', 'ru'], ['レ', 're'], ['ロ', 'ro'],
  ['ワ', 'wa'], ['ヲ', 'wo'], ['ン', 'n'],
  // 濁音
  ['ガ', 'ga'], ['ギ', 'gi'], ['グ', 'gu'], ['ゲ', 'ge'], ['ゴ', 'go'],
  ['ザ', 'za'], ['ジ', 'ji'], ['ズ', 'zu'], ['ゼ', 'ze'], ['ゾ', 'zo'],
  ['ダ', 'da'], ['ヂ', 'ji'], ['ヅ', 'zu'], ['デ', 'de'], ['ド', 'do'],
  ['バ', 'ba'], ['ビ', 'bi'], ['ブ', 'bu'], ['ベ', 'be'], ['ボ', 'bo'],
  // 半濁音
  ['パ', 'pa'], ['ピ', 'pi'], ['プ', 'pu'], ['ペ', 'pe'], ['ポ', 'po'],
  // 小文字
  ['ァ', 'a'], ['ィ', 'i'], ['ゥ', 'u'], ['ェ', 'e'], ['ォ', 'o'],
  ['ャ', 'ya'], ['ュ', 'yu'], ['ョ', 'yo'],
  ['ッ', '\x01'],
  ['ヴ', 'vu'],
  ['ヶ', 'ga'], ['ヵ', 'ka'],
  // ー
  ['ー', '-'],
];

// 编译正则：一次性匹配所有假名
const ALL_KANA = [...HIRAGANA_TABLE, ...KATAKANA_TABLE];
const KANA_MAP = new Map(ALL_KANA);
const KANA_PATTERN = new RegExp(
  ALL_KANA.map(([k]) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'g'
);

// ── CJK 汉字 Unicode 范围检测 ──────────────────────────────────────────────────

const CJK_PATTERN = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]+/g;

// ── 缓存 ──────────────────────────────────────────────────────────────────────

const _cache = new Map();
const CACHE_MAX = 4096;           // 收紧至 4096（原 8192），降低内存

function convertKana(text) {
  const result = text.replace(KANA_PATTERN, (m) => KANA_MAP.get(m) || m);
  // 处理促音双写：っ/ッ 被标记为 \x01
  return result.replace(/\x01([kgsztcpbhjmrwdn])/g, '$1$1').replace(/\x01/g, '');
}

function convertCJK(text) {
  return text.replace(CJK_PATTERN, (segment) => {
    try {
      return pinyin(segment, { toneType: 'none', type: 'array' }).join('');
    } catch {
      return segment;
    }
  });
}

/**
 * 生成排序键：将中文→拼音、假名→罗马音，全部转小写。
 * @param {string|null} text
 * @returns {string}
 */
function makeSortKey(text) {
  if (!text) return 'zzz';

  const s = String(text).trim();
  if (!s) return 'zzz';

  // 检查缓存
  if (_cache.has(s)) return _cache.get(s);

  // 1. 假名 → 罗马音
  let result = convertKana(s);
  // 2. 汉字 → 拼音
  result = convertCJK(result);
  // 3. 转小写
  result = result.toLowerCase();
  // 4. 去除非字母数字字符
  result = result.replace(/[^a-z0-9]/g, '');
  if (!result) result = 'zzz';

  // 写入缓存（LRU）
  if (_cache.size >= CACHE_MAX) {
    const oldest = _cache.keys().next().value;
    _cache.delete(oldest);
  }
  _cache.set(s, result);

  return result;
}

/**
 * 获取排序首字母（用于 A-Z 分组）。
 * 返回大写字母 A-Z，或 '#' 表示数字/符号开头。
 * @param {string|null} text
 * @returns {string}
 */
function makeFirstLetter(text) {
  const key = makeSortKey(text);
  if (!key || key === 'zzz') return '#';
  const first = key[0];
  if (first >= '0' && first <= '9') return '#';
  if (first >= 'a' && first <= 'z') return first.toUpperCase();
  return '#';
}

module.exports = { makeSortKey, makeFirstLetter };
