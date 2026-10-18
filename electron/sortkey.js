'use strict';

const { pinyin } = require('pinyin-pro');


const HIRAGANA_TABLE = [
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
  ['ゃ', 'ya'], ['ゅ', 'yu'], ['ょ', 'yo'],
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
  ['が', 'ga'], ['ぎ', 'gi'], ['ぐ', 'gu'], ['げ', 'ge'], ['ご', 'go'],
  ['ざ', 'za'], ['じ', 'ji'], ['ず', 'zu'], ['ぜ', 'ze'], ['ぞ', 'zo'],
  ['だ', 'da'], ['ぢ', 'ji'], ['づ', 'zu'], ['で', 'de'], ['ど', 'do'],
  ['ば', 'ba'], ['び', 'bi'], ['ぶ', 'bu'], ['べ', 'be'], ['ぼ', 'bo'],
  ['ぱ', 'pa'], ['ぴ', 'pi'], ['ぷ', 'pu'], ['ぺ', 'pe'], ['ぽ', 'po'],
  ['ぁ', 'a'], ['ぃ', 'i'], ['ぅ', 'u'], ['ぇ', 'e'], ['ぉ', 'o'],
  ['ゎ', 'wa'],
  ['っ', '\x01'],
  ['ー', '-'],
];


const KATAKANA_TABLE = [
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
  ['ファ', 'fa'],  ['フィ', 'fi'],  ['フェ', 'fe'],  ['フォ', 'fo'],
  ['ティ', 'ti'],  ['ディ', 'di'],  ['トゥ', 'tu'],  ['ドゥ', 'du'],
  ['ウィ', 'wi'],  ['ウェ', 'we'],  ['ウォ', 'wo'],
  ['ツァ', 'tsa'], ['ツィ', 'tsi'], ['ツェ', 'tse'], ['ツォ', 'tso'],
  ['ジェ', 'je'],  ['チェ', 'che'],
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
  ['ガ', 'ga'], ['ギ', 'gi'], ['グ', 'gu'], ['ゲ', 'ge'], ['ゴ', 'go'],
  ['ザ', 'za'], ['ジ', 'ji'], ['ズ', 'zu'], ['ゼ', 'ze'], ['ゾ', 'zo'],
  ['ダ', 'da'], ['ヂ', 'ji'], ['ヅ', 'zu'], ['デ', 'de'], ['ド', 'do'],
  ['バ', 'ba'], ['ビ', 'bi'], ['ブ', 'bu'], ['ベ', 'be'], ['ボ', 'bo'],
  ['パ', 'pa'], ['ピ', 'pi'], ['プ', 'pu'], ['ペ', 'pe'], ['ポ', 'po'],
  ['ァ', 'a'], ['ィ', 'i'], ['ゥ', 'u'], ['ェ', 'e'], ['ォ', 'o'],
  ['ャ', 'ya'], ['ュ', 'yu'], ['ョ', 'yo'],
  ['ッ', '\x01'],
  ['ヴ', 'vu'],
  ['ヶ', 'ga'], ['ヵ', 'ka'],
  ['ー', '-'],
];

const ALL_KANA = [...HIRAGANA_TABLE, ...KATAKANA_TABLE];
const KANA_MAP = new Map(ALL_KANA);
const KANA_PATTERN = new RegExp(
  ALL_KANA.map(([k]) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'g'
);


const CJK_PATTERN = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]+/g;


const _cache = new Map();
const CACHE_MAX = 65536;

function convertKana(text) {
  const result = text.replace(KANA_PATTERN, (m) => KANA_MAP.get(m) || m);
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

function makeSortKey(text) {
  if (!text) return 'zzz';

  const s = String(text).trim();
  if (!s) return 'zzz';

  const hit = _cache.get(s);
  if (hit !== undefined) {
    if (_cache.get(_lruTail()) !== hit || _cache.size === 1) {
      _cache.delete(s);
      _cache.set(s, hit);
    }
    return hit;
  }

  let result = convertKana(s);
  result = convertCJK(result);
  result = result.toLowerCase();
  result = result.replace(/[^a-z0-9]/g, '');
  if (!result) result = 'zzz';

  if (_cache.size >= CACHE_MAX) {
    const oldest = _cache.keys().next().value;
    _cache.delete(oldest);
  }
  _cache.set(s, result);

  return result;
}

function _lruTail() {
  let last;
  for (const k of _cache.keys()) last = k;
  return last;
}

function makeFirstLetter(text) {
  const key = makeSortKey(text);
  if (!key || key === 'zzz') return '#';
  const first = key[0];
  if (first >= '0' && first <= '9') return '#';
  if (first >= 'a' && first <= 'z') return first.toUpperCase();
  return '#';
}

module.exports = { makeSortKey, makeFirstLetter };
