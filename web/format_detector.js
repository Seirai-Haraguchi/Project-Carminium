(function () {
  'use strict';

  const BROWSER_DECODABLE = new Set([
    'mp3', 'wav', 'ogg', 'oga', 'opus',
    'm4a', 'aac', 'flac', 'mp4', 'weba', 'webm',
  ]);

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
    isBrowserDecodable(filePath) {
      const ext = getExtension(filePath);
      return BROWSER_DECODABLE.has(ext);
    },

    needsFFmpeg(filePath) {
      const ext = getExtension(filePath);
      return NEEDS_FFMPEG.has(ext) || !BROWSER_DECODABLE.has(ext);
    },

    getExtension,
  };
})();
