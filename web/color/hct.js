// Material Color Utilities 的本地移植：CAM16 / HCT / TonalPalette。
// 算法与 Google 的 material-color-utilities（Apache-2.0）一致，只保留本项目
// 用得到的部分：seed -> HCT、按 tone 取样、按 tone 反查可达色度。
// 无 DOM 依赖、无副作用，主窗与浮动窗共用同一份（floating.html 也引它）。
(function () {
  'use strict';

  var PI = Math.PI;

  function signum(n) { return n < 0 ? -1 : (n === 0 ? 0 : 1); }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sanitizeDegrees(d) { d = d % 360; return d < 0 ? d + 360 : d; }

  // ── sRGB ↔ XYZ（0-100 标度，与官方 color_utils 一致）──────────────
  function linearized(channel) {
    var n = channel / 255;
    return (n <= 0.040449936 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4)) * 100;
  }

  function delinearized(component) {
    var n = component / 100;
    var d = n <= 0.0031308 ? n * 12.92 : 1.055 * Math.pow(n, 1 / 2.4) - 0.055;
    return clamp(Math.round(d * 255), 0, 255);
  }

  function xyzFromRgb(rgb) {
    var r = linearized(rgb[0]), g = linearized(rgb[1]), b = linearized(rgb[2]);
    return [
      0.41233895 * r + 0.35762064 * g + 0.18051042 * b,
      0.2126 * r + 0.7152 * g + 0.0722 * b,
      0.01932141 * r + 0.11916382 * g + 0.95034478 * b,
    ];
  }

  function rgbFromXyz(x, y, z) {
    var lr = 3.2406 * x - 1.5372 * y - 0.4986 * z;
    var lg = -0.9689 * x + 1.8758 * y + 0.0415 * z;
    var lb = 0.0557 * x - 0.204 * y + 1.057 * z;
    return [delinearized(lr), delinearized(lg), delinearized(lb)];
  }

  // ── L* / Y ─────────────────────────────────────────────────────────
  var LAB_E = 216 / 24389;
  var LAB_KAPPA = 24389 / 27;

  function lstarFromY(y) {
    var y1 = y / 100;
    return y1 <= LAB_E ? LAB_KAPPA * y1 : 116 * Math.cbrt(y1) - 16;
  }

  function yFromLstar(lstar) {
    var ft = (lstar + 16) / 116;
    var ft3 = ft * ft * ft;
    return ft3 > LAB_E ? 100 * ft3 : 100 * ((116 * ft - 16) / LAB_KAPPA);
  }

  function lstarFromRgb(rgb) {
    var y = 0.2126 * linearized(rgb[0]) + 0.7152 * linearized(rgb[1]) +
        0.0722 * linearized(rgb[2]);
    return lstarFromY(y);
  }

  // ── ViewingConditions（sRGB 默认，等价 ViewingConditions.make()）────
  var VC = (function () {
    var white = [95.047, 100.0, 108.883]; // D65
    var rW = white[0] * 0.401288 + white[1] * 0.650173 - white[2] * 0.051461;
    var gW = white[0] * -0.250268 + white[1] * 1.204414 + white[2] * 0.045854;
    var bW = white[0] * -0.002079 + white[1] * 0.048952 + white[2] * 0.953127;

    var surround = 2.0;
    var f = 0.8 + surround / 10.0;
    var c = f >= 0.9 ? lerp(0.59, 0.69, (f - 0.9) * 10) : lerp(0.525, 0.59, (f - 0.8) * 10);
    var adaptingLuminance = (200 / PI) * yFromLstar(50) / 100;
    var d = f * (1 - (1 / 3.6) * Math.exp((-adaptingLuminance - 42) / 92));
    d = clamp(d, 0, 1);

    var rgbD = [d * (100 / rW) + 1 - d, d * (100 / gW) + 1 - d, d * (100 / bW) + 1 - d];
    var k = 1 / (5 * adaptingLuminance + 1);
    var k4 = k * k * k * k;
    var k4F = 1 - k4;
    var fl = k4 * adaptingLuminance + 0.1 * k4F * k4F * Math.cbrt(5 * adaptingLuminance);
    var n = yFromLstar(50) / white[1];
    var z = 1.48 + Math.sqrt(n);
    var nbb = 0.725 / Math.pow(n, 0.2);

    var aw = (function () {
      var f0 = Math.pow((fl * rgbD[0] * rW) / 100, 0.42);
      var f1 = Math.pow((fl * rgbD[1] * gW) / 100, 0.42);
      var f2 = Math.pow((fl * rgbD[2] * bW) / 100, 0.42);
      var a0 = (400 * f0) / (f0 + 27.13);
      var a1 = (400 * f1) / (f1 + 27.13);
      var a2 = (400 * f2) / (f2 + 27.13);
      return (2 * a0 + a1 + 0.05 * a2) * nbb;
    })();

    return { n: n, aw: aw, nbb: nbb, ncb: nbb, c: c, nc: f, rgbD: rgbD, fl: fl,
      flRoot: Math.pow(fl, 0.25), z: z };
  })();

  // ── CAM16 ─────────────────────────────────────────────────────────
  // 只保留本项目需要的正向（rgb -> hue/chroma）与反向（J,chroma,hue -> rgb）。
  function cam16FromXyz(x, y, z) {
    var rC = 0.401288 * x + 0.650173 * y - 0.051461 * z;
    var gC = -0.250268 * x + 1.204414 * y + 0.045854 * z;
    var bC = -0.002079 * x + 0.048952 * y + 0.953127 * z;

    var rD = VC.rgbD[0] * rC, gD = VC.rgbD[1] * gC, bD = VC.rgbD[2] * bC;

    var rAF = Math.pow((VC.fl * Math.abs(rD)) / 100, 0.42);
    var gAF = Math.pow((VC.fl * Math.abs(gD)) / 100, 0.42);
    var bAF = Math.pow((VC.fl * Math.abs(bD)) / 100, 0.42);
    var rA = (signum(rD) * 400 * rAF) / (rAF + 27.13);
    var gA = (signum(gD) * 400 * gAF) / (gAF + 27.13);
    var bA = (signum(bD) * 400 * bAF) / (bAF + 27.13);

    var a = (11 * rA - 12 * gA + bA) / 11;
    var b = (rA + gA - 2 * bA) / 9;
    var u = (20 * rA + 20 * gA + 21 * bA) / 20;
    var p2 = (40 * rA + 20 * gA + bA) / 20;

    var hue = sanitizeDegrees((Math.atan2(b, a) * 180) / PI);
    var ac = p2 * VC.nbb;
    var j = 100 * Math.pow(ac / VC.aw, VC.c * VC.z);
    var huePrime = hue < 20.14 ? hue + 360 : hue;
    var eHue = 0.25 * (Math.cos((huePrime * PI) / 180 + 2) + 3.8);
    var p1 = (50000 / 13) * eHue * VC.nc * VC.ncb;
    var t = (p1 * Math.sqrt(a * a + b * b)) / (u + 0.305);
    var alpha = Math.pow(t, 0.9) * Math.pow(1.64 - Math.pow(0.29, VC.n), 0.73);

    return { hue: hue, chroma: alpha * Math.sqrt(j / 100), j: j };
  }

  function cam16FromRgb(rgb) { return cam16FromXyz.apply(null, xyzFromRgb(rgb)); }

  // (J, chroma, hue) -> sRGB；等价 Cam16.viewed() + argbFromXyz。
  function rgbFromJch(j, chroma, hue) {
    var alpha = (chroma === 0 || j === 0) ? 0 : chroma / Math.sqrt(j / 100);
    var t = Math.pow(alpha / Math.pow(1.64 - Math.pow(0.29, VC.n), 0.73), 1 / 0.9);
    var hRad = (hue * PI) / 180;
    var eHue = 0.25 * (Math.cos(hRad + 2) + 3.8);
    var ac = VC.aw * Math.pow(j / 100, 1 / VC.c / VC.z);
    var p1 = eHue * (50000 / 13) * VC.nc * VC.ncb;
    var p2 = ac / VC.nbb;
    var hSin = Math.sin(hRad), hCos = Math.cos(hRad);
    var gamma = (23 * (p2 + 0.305) * t) /
        (23 * p1 + 11 * t * hCos + 108 * t * hSin);
    var a = gamma * hCos, b = gamma * hSin;

    function channel(a0, a1, a2) {
      var v = (460 * p2 + a0 * a + a1 * b) / 1403;
      var base = Math.max(0, (27.13 * Math.abs(v)) / (400 - Math.abs(v)));
      return signum(v) * (100 / VC.fl) * Math.pow(base, 1 / 0.42);
    }

    var rC = channel(451, 288);
    var gC = channel(-891, -261);
    var bC = channel(-220, -6300);

    var x = 1.86206786 * (rC / VC.rgbD[0]) - 1.01125463 * (gC / VC.rgbD[1]) +
        0.14918677 * (bC / VC.rgbD[2]);
    var y = 0.38752654 * (rC / VC.rgbD[0]) + 0.62144744 * (gC / VC.rgbD[1]) -
        0.00897398 * (bC / VC.rgbD[2]);
    var z = -0.0158415 * (rC / VC.rgbD[0]) - 0.03412294 * (gC / VC.rgbD[1]) +
        1.04996444 * (bC / VC.rgbD[2]);

    return rgbFromXyz(x, y, z);
  }

  // ── HCT 求解 ──────────────────────────────────────────────────────
  // 逐行移植官方 HctSolver：先在 (J, chroma, hue) 空间用牛顿迭代求精确解；
  // 超出 sRGB 色域时沿目标色相在色域边界上二分，得到该 (hue, tone) 可达的
  // 最大色度，与官方行为完全一致。
  var SCALED_DISCOUNT_FROM_LINRGB = [
    [0.001200833568784504, 0.002389694492170889, 0.0002795742885861124],
    [0.0005891086651375999, 0.0029785502573438758, 0.0003270666104008398],
    [0.00010146692491640572, 0.0005364214359186694, 0.0032979401770712076],
  ];
  var LINRGB_FROM_SCALED_DISCOUNT = [
    [1373.2198709594231, -1100.4251190754821, -7.278681089101213],
    [-271.815969077903, 559.6580465940733, -32.46047482791194],
    [1.9622899599665666, -57.173814538844006, 308.7233197812385],
  ];
  var Y_FROM_LINRGB = [0.2126, 0.7152, 0.0722];

  // 临界平面表（官方 HctSolver.CRITICAL_PLANES 原表，255 项）。
  var CRITICAL_PLANES = [
    0.015176349177441876, 0.045529047532325624, 0.07588174588720938,
    0.10623444424209313, 0.13658714259697685, 0.16693984095186062,
    0.19729253930674434, 0.2276452376616281, 0.2579979360165119,
    0.28835063437139563, 0.3188300904430532, 0.350925934958123,
    0.3848314933096426, 0.42057480301049466, 0.458183274052838,
    0.4976837250274023, 0.5391024159806381, 0.5824650784040898,
    0.6277969426914107, 0.6751227633498623, 0.7244668422128921,
    0.775853049866786, 0.829304845476233, 0.8848452951698498,
    0.942497089126609, 1.0022825574869039, 1.0642236851973577,
    1.1283421258858297, 1.1946592148522128, 1.2631959812511864,
    1.3339731595349034, 1.407011200216447, 1.4823302800086415,
    1.5599503113873272, 1.6398909516233677, 1.7221716113234105,
    1.8068114625156377, 1.8938294463134073, 1.9832442801866852,
    2.075074464868551, 2.1693382909216234, 2.2660538449872063,
    2.36523901573795, 2.4669114995532007, 2.5710888059345764,
    2.6777882626779785, 2.7870270208169257, 2.898822059350997,
    3.0131901897720907, 3.1301480604002863, 3.2497121605402226,
    3.3718988244681087, 3.4967242352587946, 3.624204428461639,
    3.754355295633311, 3.887192587735158, 4.022731918402185,
    4.160988767090289, 4.301978482107941, 4.445716283538092,
    4.592217266055746, 4.741496401646282, 4.893568542229298,
    5.048448422192488, 5.20615066083972, 5.3666897647573375,
    5.5300801301023865, 5.696336044816294, 5.865471690767354,
    6.037501145825082, 6.212438385869475, 6.390297286737924,
    6.571091626112461, 6.7548350853498045, 6.941541251256611,
    7.131223617812143, 7.323895587840543, 7.5195704746346665,
    7.7182615035334345, 7.919981813454504, 8.124744458384042,
    8.332562408825165, 8.543448553206703, 8.757415699253682,
    8.974476575321063, 9.194643831691977, 9.417930041841839,
    9.644347703669503, 9.873909240696694, 10.106627003236781,
    10.342513269534024, 10.58158024687427, 10.8238400726681,
    11.069304815507364, 11.317986476196008, 11.569896988756009,
    11.825048221409341, 12.083451977536606, 12.345119996613247,
    12.610063955123938, 12.878295467455942, 13.149826086772048,
    13.42466730586372, 13.702830557985108, 13.984327217668513,
    14.269168601521828, 14.55736596900856, 14.848930523210871,
    15.143873411576273, 15.44220572664832, 15.743938506781891,
    16.04908273684337, 16.35764934889634, 16.66964922287304,
    16.985093187232053, 17.30399201960269, 17.62635644741625,
    17.95219714852476, 18.281524751807332, 18.614349837764564,
    18.95068293910138, 19.290534541298456, 19.633915083172692,
    19.98083495742689, 20.331304511189067, 20.685334046541502,
    21.042933821039977, 21.404114048223256, 21.76888489811322,
    22.137256497705877, 22.50923893145328, 22.884842241736916,
    23.264076429332462, 23.6469514538663, 24.033477234264016,
    24.42366364919083, 24.817520537484558, 25.21505769858089,
    25.61628489293138, 26.021211842414342, 26.429848230738664,
    26.842203703840827, 27.258287870275353, 27.678110301598522,
    28.10168053274597, 28.529008062403893, 28.96010235337422,
    29.39497283293396, 29.83362889318845, 30.276079891419332,
    30.722335150426627, 31.172403958865512, 31.62629557157785,
    32.08401920991837, 32.54558406207592, 33.010999283389665,
    33.4802739966603, 33.953417292456834, 34.430438229418264,
    34.911345834551085, 35.39614910352207, 35.88485700094671,
    36.37747846067349, 36.87402238606382, 37.37449765026789,
    37.87891309649659, 38.38727753828926, 38.89959975977785,
    39.41588851594697, 39.93615253289054, 40.460400508064545,
    40.98864111053629, 41.520882981230194, 42.05713473317016,
    42.597404951718396, 43.141702194811224, 43.6900349931913,
    44.24241185063697, 44.798841244188324, 45.35933162437017,
    45.92389141541209, 46.49252901546552, 47.065252796817916,
    47.64207110610409, 48.22299226451468, 48.808024568002054,
    49.3971762874833, 49.9904556690408, 50.587870934119984,
    51.189430279724725, 51.79514187861014, 52.40501387947288,
    53.0190544071392, 53.637271562750364, 54.259673423945976,
    54.88626804504493, 55.517063457223934, 56.15206766869424,
    56.79128866487574, 57.43473440856916, 58.08241284012621,
    58.734331877617365, 59.39049941699807, 60.05092333227251,
    60.715611475655585, 61.38457167773311, 62.057811747619894,
    62.7353394731159, 63.417162620860914, 64.10328893648692,
    64.79372614476921, 65.48848194977529, 66.18756403501224,
    66.89098006357258, 67.59873767827808, 68.31084450182222,
    69.02730813691093, 69.74813616640164, 70.47333615344107,
    71.20291564160104, 71.93688215501312, 72.67524319850172,
    73.41800625771542, 74.16517879925733, 74.9167682708136,
    75.67278210128072, 76.43322770089146, 77.1981124613393,
    77.96744375590167, 78.74122893956174, 79.51947534912904,
    80.30219030335869, 81.08938110306934, 81.88105503125999,
    82.67721935322541, 83.4778813166706, 84.28304815182372,
    85.09272707154808, 85.90692527145302, 86.72564993000343,
    87.54890820862819, 88.3767072518277, 89.2090541872801,
    90.04595612594655, 90.88742016217518, 91.73345337380438,
    92.58406282226491, 93.43925555268066, 94.29903859396902,
    95.16341895893969, 96.03240364439274, 96.9059996312159,
    97.78421388448044, 98.6670533535366, 99.55452497210776,
  ];

  function mulVec(matrix, v) {
    return [
      matrix[0][0] * v[0] + matrix[0][1] * v[1] + matrix[0][2] * v[2],
      matrix[1][0] * v[0] + matrix[1][1] * v[1] + matrix[1][2] * v[2],
      matrix[2][0] * v[0] + matrix[2][1] * v[1] + matrix[2][2] * v[2],
    ];
  }

  // 去伽马但不取整（官方 trueDelinearized）。
  function trueDelinearized(component) {
    var n = component / 100;
    return (n <= 0.0031308 ? n * 12.92 : 1.055 * Math.pow(n, 1 / 2.4) - 0.055) * 255;
  }

  function chromaticAdaptation(component) {
    var af = Math.pow(Math.abs(component), 0.42);
    return (signum(component) * 400 * af) / (af + 27.13);
  }

  function hueOf(linrgb) {
    var sd = mulVec(SCALED_DISCOUNT_FROM_LINRGB, linrgb);
    var rA = chromaticAdaptation(sd[0]);
    var gA = chromaticAdaptation(sd[1]);
    var bA = chromaticAdaptation(sd[2]);
    var a = (11 * rA - 12 * gA + bA) / 11;
    var b = (rA + gA - 2 * bA) / 9;
    return Math.atan2(b, a);
  }

  function sanitizeRadians(a) { return (a + PI * 8) % (PI * 2); }

  function areInCyclicOrder(a, b, c) {
    return sanitizeRadians(b - a) < sanitizeRadians(c - a);
  }

  function intercept(source, mid, target) {
    return (mid - source) / (target - source);
  }

  function lerpPoint(source, t, target) {
    return [
      source[0] + (target[0] - source[0]) * t,
      source[1] + (target[1] - source[1]) * t,
      source[2] + (target[2] - source[2]) * t,
    ];
  }

  function setCoordinate(source, coordinate, target, axis) {
    return lerpPoint(source, intercept(source[axis], coordinate, target[axis]), target);
  }

  function nthVertex(y, n) {
    var kR = Y_FROM_LINRGB[0], kG = Y_FROM_LINRGB[1], kB = Y_FROM_LINRGB[2];
    var coordA = n % 4 <= 1 ? 0.0 : 100.0;
    var coordB = n % 2 === 0 ? 0.0 : 100.0;
    if (n < 4) {
      var g = coordA, b = coordB;
      var r = (y - g * kG - b * kB) / kR;
      return r >= 0 && r <= 100 ? [r, g, b] : [-1, -1, -1];
    } else if (n < 8) {
      var b2 = coordA, r2 = coordB;
      var g2 = (y - r2 * kR - b2 * kB) / kG;
      return g2 >= 0 && g2 <= 100 ? [r2, g2, b2] : [-1, -1, -1];
    }
    var r3 = coordA, g3 = coordB;
    var b3 = (y - r3 * kR - g3 * kG) / kB;
    return b3 >= 0 && b3 <= 100 ? [r3, g3, b3] : [-1, -1, -1];
  }

  function bisectToSegment(y, targetHue) {
    var left = [-1, -1, -1], right = left;
    var leftHue = 0, rightHue = 0;
    var initialized = false, uncut = true;
    for (var n = 0; n < 12; n++) {
      var mid = nthVertex(y, n);
      if (mid[0] < 0) continue;
      var midHue = hueOf(mid);
      if (!initialized) {
        left = mid; right = mid;
        leftHue = midHue; rightHue = midHue;
        initialized = true;
        continue;
      }
      if (uncut || areInCyclicOrder(leftHue, midHue, rightHue)) {
        uncut = false;
        if (areInCyclicOrder(leftHue, targetHue, midHue)) {
          right = mid; rightHue = midHue;
        } else {
          left = mid; leftHue = midHue;
        }
      }
    }
    return [left, right];
  }

  function criticalPlaneBelow(x) { return Math.floor(x - 0.5); }
  function criticalPlaneAbove(x) { return Math.ceil(x - 0.5); }

  function bisectToLimit(y, targetHue) {
    var segment = bisectToSegment(y, targetHue);
    var left = segment[0];
    var leftHue = hueOf(left);
    var right = segment[1];
    for (var axis = 0; axis < 3; axis++) {
      if (left[axis] !== right[axis]) {
        var lPlane = -1, rPlane = 255;
        if (left[axis] < right[axis]) {
          lPlane = criticalPlaneBelow(trueDelinearized(left[axis]));
          rPlane = criticalPlaneAbove(trueDelinearized(right[axis]));
        } else {
          lPlane = criticalPlaneAbove(trueDelinearized(left[axis]));
          rPlane = criticalPlaneBelow(trueDelinearized(right[axis]));
        }
        for (var i = 0; i < 8; i++) {
          if (Math.abs(rPlane - lPlane) <= 1) break;
          var mPlane = Math.floor((lPlane + rPlane) / 2);
          var midPlaneCoordinate = CRITICAL_PLANES[mPlane];
          var mid = setCoordinate(left, midPlaneCoordinate, right, axis);
          var midHue = hueOf(mid);
          if (areInCyclicOrder(leftHue, targetHue, midHue)) {
            right = mid; rPlane = mPlane;
          } else {
            left = mid; leftHue = midHue; lPlane = mPlane;
          }
        }
      }
    }
    return [
      (left[0] + right[0]) / 2,
      (left[1] + right[1]) / 2,
      (left[2] + right[2]) / 2,
    ];
  }

  function inverseChromaticAdaptation(adapted) {
    var a = Math.abs(adapted);
    var base = Math.max(0, (27.13 * a) / (400 - a));
    return signum(adapted) * Math.pow(base, 1 / 0.42);
  }

  // 牛顿迭代求精确解；失败（色域外）返回 null（官方返回 0 表示未找到）。
  function findResultByJ(hueRadians, chroma, y) {
    var j = Math.sqrt(y) * 11;
    var tInnerCoeff = 1 / Math.pow(1.64 - Math.pow(0.29, VC.n), 0.73);
    var eHue = 0.25 * (Math.cos(hueRadians + 2) + 3.8);
    var p1 = eHue * (50000 / 13) * VC.nc * VC.ncb;
    var hSin = Math.sin(hueRadians), hCos = Math.cos(hueRadians);
    for (var round = 0; round < 5; round++) {
      var jNormalized = j / 100;
      var alpha = chroma === 0 || j === 0 ? 0 : chroma / Math.sqrt(jNormalized);
      var t = Math.pow(alpha * tInnerCoeff, 1 / 0.9);
      var ac = VC.aw * Math.pow(jNormalized, 1 / VC.c / VC.z);
      var p2 = ac / VC.nbb;
      var gamma = (23 * (p2 + 0.305) * t) /
          (23 * p1 + 11 * t * hCos + 108 * t * hSin);
      var a = gamma * hCos, b = gamma * hSin;
      var rA = (460 * p2 + 451 * a + 288 * b) / 1403;
      var gA = (460 * p2 - 891 * a - 261 * b) / 1403;
      var bA = (460 * p2 - 220 * a - 6300 * b) / 1403;
      var linrgb = mulVec(LINRGB_FROM_SCALED_DISCOUNT, [
        inverseChromaticAdaptation(rA),
        inverseChromaticAdaptation(gA),
        inverseChromaticAdaptation(bA),
      ]);
      if (linrgb[0] < 0 || linrgb[1] < 0 || linrgb[2] < 0) return null;
      var fnj = Y_FROM_LINRGB[0] * linrgb[0] + Y_FROM_LINRGB[1] * linrgb[1] +
          Y_FROM_LINRGB[2] * linrgb[2];
      if (fnj <= 0) return null;
      if (round === 4 || Math.abs(fnj - y) < 0.002) {
        if (linrgb[0] > 100.01 || linrgb[1] > 100.01 || linrgb[2] > 100.01) {
          return null;
        }
        return [
          delinearized(linrgb[0]), delinearized(linrgb[1]), delinearized(linrgb[2]),
        ];
      }
      // 牛顿迭代，用 2·fn(j)/j 近似 fn'(j)。
      j = j - ((fnj - y) * j) / (2 * fnj);
    }
    return null;
  }

  // 官方 solveToInt：入参 hue 单位为度，返回 [r,g,b]。
  function solveHct(hueDegrees, chroma, lstar) {
    if (chroma < 0.0001 || lstar < 0.0001 || lstar > 99.9999) {
      var g = delinearized(yFromLstar(lstar));
      return [g, g, g];
    }
    var hueRadians = (sanitizeDegrees(hueDegrees) / 180) * PI;
    var y = yFromLstar(lstar);
    var exact = findResultByJ(hueRadians, chroma, y);
    if (exact) return exact;
    var linrgb = bisectToLimit(y, hueRadians);
    return [
      delinearized(linrgb[0]), delinearized(linrgb[1]), delinearized(linrgb[2]),
    ];
  }

  // ── TonalPalette ──────────────────────────────────────────────────
  function TonalPalette(hue, chroma) {
    this.hue = sanitizeDegrees(hue);
    this.chroma = Math.max(0, chroma);
    this._cache = Object.create(null);
  }

  // 返回 { rgb, chroma }；chroma 是实际可达色度（可能低于 this.chroma）。
  // 注意：官方不量化 tone（Hct.from 直接解全精度值），缓存键不能取整。
  TonalPalette.prototype.at = function (tone) {
    var t = clamp(tone, 0, 100);
    var key = t;
    var hit = this._cache[key];
    if (hit) return hit;
    var rgb = solveHct(this.hue, this.chroma, key);
    var info = { rgb: rgb, chroma: cam16FromRgb(rgb).chroma };
    this._cache[key] = info;
    return info;
  };

  TonalPalette.prototype.tone = function (tone) { return this.at(tone).rgb; };

  // 从 startTone 出发朝一个方向走，找到能表达目标色度的 tone
  // （官方 findBestToneForChroma 的逐行移植，比较不含误差容限）。
  TonalPalette.prototype.bestToneForChroma = function (startTone, byDecreasing) {
    var tone = clamp(startTone, 0, 100);
    var answer = tone;
    var best = this.at(tone);
    while (best.chroma < this.chroma) {
      if (tone < 0 || tone > 100) break;
      tone += byDecreasing ? -1 : 1;
      var candidate = this.at(tone);
      if (best.chroma < candidate.chroma) { best = candidate; answer = tone; }
    }
    return answer;
  };

  // tMaxC / tMinC
  TonalPalette.prototype.maxTone = function (lo, hi) {
    var t = this.bestToneForChroma(100, true);
    return clamp(t, lo === undefined ? 0 : lo, hi === undefined ? 100 : hi);
  };

  TonalPalette.prototype.minTone = function (lo, hi) {
    var t = this.bestToneForChroma(0, false);
    return clamp(t, lo === undefined ? 0 : lo, hi === undefined ? 100 : hi);
  };

  // ── 对比度 ────────────────────────────────────────────────────────
  function ratioOfTones(t1, t2) {
    t1 = clamp(t1, 0, 100);
    t2 = clamp(t2, 0, 100);
    var y1 = yFromLstar(t1), y2 = yFromLstar(t2);
    var hi = Math.max(y1, y2), lo = Math.min(y1, y2);
    return (hi + 5) / (lo + 5);
  }

  // 官方 Contrast.lighter / darker：闭式解 + 0.4 的 gamut 余量，不可达返回 -1。
  function lighter(tone, ratio) {
    if (tone < 0 || tone > 100) return -1;
    var darkY = yFromLstar(tone);
    var lightY = ratio * (darkY + 5) - 5;
    var real = (Math.max(lightY, darkY) + 5) / (Math.min(lightY, darkY) + 5);
    if (real < ratio && Math.abs(real - ratio) > 0.04) return -1;
    var result = lstarFromY(lightY) + 0.4;
    return result < 0 || result > 100 ? -1 : result;
  }

  function darker(tone, ratio) {
    if (tone < 0 || tone > 100) return -1;
    var lightY = yFromLstar(tone);
    var darkY = ((lightY + 5) / ratio) - 5;
    var real = (Math.max(lightY, darkY) + 5) / (Math.min(lightY, darkY) + 5);
    if (real < ratio && Math.abs(real - ratio) > 0.04) return -1;
    var result = lstarFromY(darkY) - 0.4;
    return result < 0 || result > 100 ? -1 : result;
  }

  function lighterUnsafe(tone, ratio) { var v = lighter(tone, ratio); return v < 0 ? 100 : v; }
  function darkerUnsafe(tone, ratio) { var v = darker(tone, ratio); return v < 0 ? 0 : v; }

  // 等价 DynamicColor.foregroundTone：在背景 tone 上取满足对比度的前景 tone
  // （tone < 60 偏好浅前景，否则偏好深前景）。
  function foregroundTone(bgTone, ratio) {
    var lighterT = lighterUnsafe(bgTone, ratio);
    var darkerT = darkerUnsafe(bgTone, ratio);
    var lr = ratioOfTones(lighterT, bgTone);
    var dr = ratioOfTones(darkerT, bgTone);
    if (Math.round(bgTone) < 60) {
      // 两侧都够不到目标比值时的高对比边缘情况（官方 negligibleDifference）。
      var negligible = Math.abs(lr - dr) < 0.1 && lr < ratio && dr < ratio;
      return (lr >= ratio || lr >= dr || negligible) ? lighterT : darkerT;
    }
    return (dr >= ratio || dr >= lr) ? darkerT : lighterT;
  }

  // ── 工具 ──────────────────────────────────────────────────────────
  function hex(rgb) {
    var s = '#';
    for (var i = 0; i < 3; i++) {
      var v = clamp(Math.round(rgb[i]), 0, 255).toString(16);
      s += v.length === 1 ? '0' + v : v;
    }
    return s;
  }

  // 官方的色相分段旋转：piecewise 取值当"旋转增量"叠加到源色相上。
  function rotatedHue(sourceHue, breakpoints, rotations) {
    var size = Math.min(breakpoints.length - 1, rotations.length);
    var rotation = 0;
    for (var i = 0; i < size; i++) {
      if (sourceHue >= breakpoints[i] && sourceHue < breakpoints[i + 1]) {
        rotation = rotations[i];
        break;
      }
    }
    return sanitizeDegrees(sourceHue + rotation);
  }

  function isYellow(hue) { return hue >= 105 && hue < 125; }
  function isCyan(hue) { return hue >= 170 && hue < 207; }
  function isBlue(hue) { return hue >= 250 && hue < 270; }

  // 官方 Hct.from：按 (hue, chroma, tone) 求解，返回实际求解出的
  // hue/chroma/tone/rgb（色域外时 chroma 取可达最大值）。
  function hctFrom(hue, chroma, tone) {
    var t = clamp(tone, 0, 100);
    var rgb = solveHct(sanitizeDegrees(hue), Math.max(0, chroma), t);
    var cam = cam16FromRgb(rgb);
    return { hue: cam.hue, chroma: cam.chroma, tone: lstarFromRgb(rgb), rgb: rgb };
  }

  // 官方 color_utils.labFromArgb 的 rgb 版本（XYZ 需除以 D65 白点归一化）。
  function labF(t) { return t > LAB_E ? Math.cbrt(t) : (LAB_KAPPA * t + 16) / 116; }

  function labFromRgb(rgb) {
    var r = linearized(rgb[0]), g = linearized(rgb[1]), b = linearized(rgb[2]);
    var x = 0.41233895 * r + 0.35762064 * g + 0.18051042 * b;
    var y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    var z = 0.01932141 * r + 0.11916382 * g + 0.95034478 * b;
    var fx = labF(x / 95.047);
    var fy = labF(y / 100);
    var fz = labF(z / 108.883);
    return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
  }

  // 官方 TemperatureCache.rawTemperature：Ou 等人的冷暖度公式（Lab 色相上以 50°
  // 为暖峰）。值越大越暖。
  function rawTemperature(rgb) {
    var lab = labFromRgb(rgb);
    var hue = sanitizeDegrees(Math.atan2(lab.b, lab.a) * 180 / PI);
    var chroma = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
    return -0.5 + 0.02 * Math.pow(chroma, 1.07) *
      Math.cos(sanitizeDegrees(hue - 50) * PI / 180);
  }

  window.AppColor = {
    TonalPalette: TonalPalette,
    fromRgb: cam16FromRgb,
    lstarFromRgb: lstarFromRgb,
    yFromLstar: yFromLstar,
    ratioOfTones: ratioOfTones,
    foregroundTone: foregroundTone,
    lighterUnsafe: lighterUnsafe,
    darkerUnsafe: darkerUnsafe,
    rotatedHue: rotatedHue,
    isYellow: isYellow,
    isCyan: isCyan,
    isBlue: isBlue,
    sanitizeDegrees: sanitizeDegrees,
    hex: hex,
    hctFrom: hctFrom,
    rawTemperature: rawTemperature,
  };
})();
