# -*- coding: utf-8 -*-
"""
Carminium — 字体子集化构建脚本

用法（受管 Python 环境，需 fonttools + brotli）：
    python scripts/subset_fonts.py

做的事：
1. 从 web/ 源码中提取全部 Material Symbols 图标名（静态模板 + 动态 textContent
   + icon: 配置 + squeezeIcon 调用），合并手工 extras（动态拼接的保底），
   用 pyftsubset 把 material-symbols-rounded.woff2 子集化到实际用量
   （保留 liga/rlig 连字特性与全部可变轴，视觉完全一致）。
2. Roboto / Roboto Condensed 16 个 TTF 原样转为 woff2 并做拉丁+西里尔子集化
   （Roboto 本就不含 CJK，应用内 CJK 走系统字体回退，行为不变）。
   保留 hinting，渲染逐像素一致。
3. 输出前后体积对比报告。

图标遗漏安全网：子集化只保留提取到的图标名连字。若未来新增图标，
重跑本脚本即可；运行时发现某图标显示为文字即说明需重跑。
"""
import os
import re
import sys
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, 'web')
FONTS = os.path.join(WEB, 'fonts')

SYMBOLS_IN = os.path.join(FONTS, 'material-symbols-rounded.woff2')
SYMBOLS_OUT = os.path.join(FONTS, 'material-symbols-rounded.subset.woff2')

# ── 1. 图标名提取 ──────────────────────────────────────────────────────────

PATTERNS = [
    # 静态模板：<span class="material-symbols-rounded ...">icon_name</span>
    re.compile(r'material-symbols-rounded[^>]*>\s*([a-z][a-z0-9_]*)\s*<'),
    # 动态赋值：el.textContent = 'icon_name'
    re.compile(r"""textContent\s*=\s*'([a-z][a-z0-9_]*)'"""),
    # 配置项：icon: 'icon_name'
    re.compile(r"""icon:\s*'([a-z][a-z0-9_]*)'"""),
    # squeezeIcon(el, 'icon_name')
    re.compile(r"""squeezeIcon\([^,]+,\s*'([a-z][a-z0-9_]*)'"""),
]

# 动态拼接/条件分支里出现的图标（提取器抓不到的保底）
EXTRAS = {
    'pause', 'play_arrow', 'hourglass_top',
    'volume_up', 'volume_down', 'volume_mute', 'volume_off',
    'repeat', 'repeat_one', 'shuffle',
    'sync', 'sync_disabled', 'check', 'close', 'add', 'remove',
    'cloud', 'cloud_download', 'folder', 'folder_open',
    'music_note', 'queue_music', 'playlist_play', 'playlist_add',
    'playlist_remove', 'queue_play_next', 'error', 'info',
    'favorite', 'favorite_border', 'history', 'settings', 'search',
    'search_off', 'music_off', 'filter_alt', 'tune', 'translate',
    'language', 'palette', 'headphones', 'memory', 'science',
    'priority_high', 'rocket_launch', 'insights', 'graphic_eq',
    'calendar_today', 'alternate_email', 'sort_by_alpha',
    'content_copy', 'edit', 'edit_note', 'delete', 'delete_sweep',
    'bug_report', 'open_in_new', 'create_new_folder',
    'chevron_right', 'arrow_back', 'arrow_forward', 'arrow_drop_down',
    'expand_more', 'expand_less', 'fullscreen', 'crop_free',
    'picture_in_picture', 'dock_to_right', 'horizontal_rule',
    'audio_file', 'library_music', 'abc', 'blur_on', 'format_size',
    'format_align_center', 'schedule', 'auto_awesome', 'album',
    'person', 'lyrics', 'skip_previous', 'skip_next', 'check_circle',
    'progress_activity', 'api', 'play_circle',
}

# 排除误匹配（非图标的 textContent 赋值等）
EXCLUDE = {'excl', 'shrd', 'playing', 'paused', 'none', 'stop', 'true', 'false'}


def extract_icon_names():
    names = set(EXTRAS)
    for dirpath, _dirs, files in os.walk(WEB):
        for fn in files:
            if not fn.endswith(('.js', '.html')):
                continue
            path = os.path.join(dirpath, fn)
            try:
                text = open(path, encoding='utf-8').read()
            except OSError:
                continue
            for pat in PATTERNS:
                for m in pat.finditer(text):
                    name = m.group(1)
                    if name and name not in EXCLUDE and len(name) > 1:
                        names.add(name)
    return sorted(names)


def run_pyftsubset(args):
    cmd = [sys.executable, '-m', 'fontTools.subset'] + args
    print('+', ' '.join(os.path.basename(a) if a.endswith(('.ttf', '.woff2')) else a
                       for a in args[:6]), '...')
    subprocess.run(cmd, check=True)


def subset_symbols(icon_names):
    """两阶段子集化 Material Symbols：

    该字体的图标连字规则挂在 rlig（而非 liga）下，且闭包按字母可达性计算 ——
    任意一组图标名合在一起就凑齐了整个字母表，导致全部 3000+ 图标字形
    都被认为"可达"而保留。因此先直接在 GSUB 层面把目标 87 个名字以外的
    连字规则全部剪掉，再交给 pyftsubset 做常规子集化。
    """
    from fontTools.ttLib import TTFont

    wanted = set(icon_names)
    pruned_path = os.path.join(FONTS, '_msr_pruned_tmp.woff2')

    f = TTFont(SYMBOLS_IN)
    lig_map = {}
    kept_rules = 0

    def _ligature_subtables(lookup):
        """解包 ExtensionSubst（type 7）拿到真正的 LigatureSubst。"""
        for sub in lookup.SubTable:
            inner = getattr(sub, 'ExtSubTable', sub)
            if hasattr(inner, 'ligatures'):
                yield inner

    # 字形名 → 字符 显式映射：该字体 cmap 存在一对多（如 U+0041→glyph 'a'），
    # 反向查表不可靠；连字输入只会出现 小写字母/underscore/digit_X，直接枚举
    _DIGITS = {'digit_zero': '0', 'digit_one': '1', 'digit_two': '2', 'digit_three': '3',
               'digit_four': '4', 'digit_five': '5', 'digit_six': '6', 'digit_seven': '7',
               'digit_eight': '8', 'digit_nine': '9'}

    def _gname_to_char(g):
        if len(g) == 1:
            return g
        if g == 'underscore':
            return '_'
        return _DIGITS.get(g, g)

    def _lig_input(first, components):
        return ''.join(_gname_to_char(g) for g in [first] + list(components))

    if 'GSUB' in f:
        gsub = f['GSUB'].table
        for rec in gsub.FeatureList.FeatureRecord:
            if rec.FeatureTag not in ('rlig', 'liga'):
                continue
            for idx in rec.Feature.LookupListIndex:
                lookup = gsub.LookupList.Lookup[idx]
                for sub in _ligature_subtables(lookup):
                    for first in list(sub.ligatures.keys()):
                        ligset = sub.ligatures[first]
                        kept = []
                        for lig in ligset:
                            name = _lig_input(first, lig.Component)
                            if name in wanted:
                                kept.append(lig)
                                lig_map[name] = lig.LigGlyph
                        if kept:
                            sub.ligatures[first] = kept
                            kept_rules += len(kept)
                        else:
                            del sub.ligatures[first]
    f.save(pruned_path)
    f.close()
    print('GSUB 剪枝：保留 %d 条连字规则（%d 个目标图标）' % (kept_rules, len(lig_map)))

    # 输入字符：全部图标名字母（作为连字替换的输入文本）
    alphabet = sorted(set(''.join(icon_names)))
    run_pyftsubset([
        pruned_path,
        '--output-file=' + SYMBOLS_OUT,
        '--flavor=woff2',
        '--text=' + ''.join(alphabet),
        # rlig 是该字体图标连字的载体（Chromium 默认启用 rlig）
        '--layout-features=rlig,liga',
        '--no-hinting',
        '--desubroutinize',
    ])
    # 临时文件由外部清理（沙箱环境可能拦截文件删除）

    # 校验（针对最终产物）：可变轴存活 + 每个图标名在子集字体的连字表中
    f = TTFont(SYMBOLS_OUT)
    axes = [a.axisTag for a in f['fvar'].axes] if 'fvar' in f else []
    final_map = {}
    if 'GSUB' in f:
        gsub = f['GSUB'].table
        for rec in gsub.FeatureList.FeatureRecord:
            if rec.FeatureTag not in ('rlig', 'liga'):
                continue
            for idx in rec.Feature.LookupListIndex:
                lookup = gsub.LookupList.Lookup[idx]
                for sub in lookup.SubTable:
                    inner = getattr(sub, 'ExtSubTable', sub)
                    if not hasattr(inner, 'ligatures'):
                        continue
                    for first, ligset in inner.ligatures.items():
                        for lig in ligset:
                            final_map[''.join(_gname_to_char(g) for g in [first] + list(lig.Component))] = lig.LigGlyph
    f.close()
    missing = [n for n in icon_names if n not in final_map]
    return axes, final_map, missing


ROBOTO_RANGES = (
    'U+0000-024F,'   # Basic Latin + Latin-1 + Latin Extended-A/B
    'U+0400-052F,'   # Cyrillic + 补充（俄语 UI）
    'U+1E00-1EFF,'   # Latin Extended Additional
    'U+2000-206F,'   # 常用标点（引号/破折号/省略号…）
    'U+20A0-20CF,'   # 货币符号
    'U+2100-214F,'   # Letterlike（™ 等）
    'U+2190-21FF,'   # 箭头
    'U+FEFF,U+FFFD'
)


def convert_roboto():
    converted = []
    for fn in sorted(os.listdir(FONTS)):
        if not fn.endswith('.ttf'):
            continue
        if not (fn.startswith('Roboto-') or fn.startswith('RobotoCondensed-')):
            continue
        src = os.path.join(FONTS, fn)
        dst = os.path.join(FONTS, fn[:-4] + '.woff2')
        run_pyftsubset([
            src,
            '--output-file=' + dst,
            '--flavor=woff2',
            '--unicodes=' + ROBOTO_RANGES,
            # 保留 hinting 与全部默认排版特性，渲染与 TTF 逐像素一致
        ])
        converted.append((src, dst))
    return converted


def main():
    print('== 提取图标名 ==')
    icons = extract_icon_names()
    print('共 %d 个图标：%s%s' % (len(icons), ','.join(icons[:12]), '…' if len(icons) > 12 else ''))

    print('\n== 子集化 Material Symbols Rounded ==')
    axes, lig_map, missing = subset_symbols(icons)
    print('可变轴存活: %s；liga 连字规则: %d 条' % (','.join(axes) or '无', len(lig_map)))
    if missing or 'wght' not in axes:
        print('!! 校验失败：缺失图标连字 %s 或可变轴丢失' % (missing,))
        sys.exit(1)
    print('全部 %d 个图标名连字映射校验通过' % len(icons))

    print('\n== Roboto / Roboto Condensed TTF → woff2（拉丁+西里尔子集）==')
    converted = convert_roboto()

    print('\n== 体积对比 ==')
    total_before = total_after = 0
    pairs = [(SYMBOLS_IN, SYMBOLS_OUT)] + converted
    for src, dst in pairs:
        b, a = os.path.getsize(src), os.path.getsize(dst)
        total_before += b
        total_after += a
        print('%46s %8.1fKB → %7.1fKB' % (os.path.basename(src), b / 1024, a / 1024))
    print('%46s %8.1fKB → %7.1fKB' % ('合计', total_before / 1024, total_after / 1024))
    print('\n完成后：')
    print('  1. 用 material-symbols-rounded.subset.woff2 覆盖 material-symbols-rounded.woff2')
    print('  2. 删除原 16 个 Roboto*.ttf（style.css 已指向 .woff2）')


if __name__ == '__main__':
    main()
