/**
 * FormatDetector — 浏览器解码能力检测
 *
 * 根据文件扩展名判断是否可以使用 decodeAudioData 解码。
 * 浏览器支持的格式走 Web Audio 原生路径，
 * 不支持的格式（WMA、APE 等）走 FFmpeg 流式 PCM 回退。
 */
(function () {
  'use strict';

  // 浏览器原生可解码的扩展名（Chromium 内核）
  const BROWSER_DECODABLE = new Set([
    'mp3', 'wav', 'ogg', 'oga', 'opus',
    'm4a', 'aac', 'flac', 'mp4', 'weba', 'webm',
  ]);

  // 需要 FFmpeg 回退的已知扩展名
  const NEEDS_FFMPEG = new Set([
    'wma', 'ape', 'alac', 'aiff', 'aif',
    'dsf', 'dff', 'mpc', 'wv', 'tak',
  ]);

  function getExtension(filePath) {
    if (!filePath) return '';
    const idx = filePath.lastIndexOf('.');
    if (idx < 0) return '';
    return filePath.substring(idx + 1).toLowerCase();
  }

  window.FormatDetector = {
    /**
     * 判断文件是否可以用 decodeAudioData 解码
     */
    isBrowserDecodable(filePath) {
      const ext = getExtension(filePath);
      return BROWSER_DECODABLE.has(ext);
    },

    /**
     * 判断文件是否需要 FFmpeg 回退
     */
    needsFFmpeg(filePath) {
      const ext = getExtension(filePath);
      return NEEDS_FFMPEG.has(ext) || !BROWSER_DECODABLE.has(ext);
    },

    /**
     * 获取文件扩展名（小写）
     */
    getExtension,
  };
})();
