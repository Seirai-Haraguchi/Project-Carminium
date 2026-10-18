

class Biquad {
  constructor() {
    this._b0=1; this._b1=0; this._b2=0; this._a1=0; this._a2=0;
    this._z1=0; this._z2=0;
  }

  setLowPass(f, fs, Q) {
    Q=Math.max(.1,Q); var w0=2*Math.PI*f/fs, c=Math.cos(w0), s=Math.sin(w0);
    var a=s/(2*Q), a0=1+a;
    this._b0=((1-c)*.5)/a0; this._b1=(1-c)/a0; this._b2=((1-c)*.5)/a0;
    this._a1=(-2*c)/a0; this._a2=(1-a)/a0;
  }

  setHighPass(f, fs, Q) {
    Q=Math.max(.1,Q); var w0=2*Math.PI*f/fs, c=Math.cos(w0), s=Math.sin(w0);
    var a=s/(2*Q), a0=1+a;
    this._b0=((1+c)*.5)/a0; this._b1=-(1+c)/a0; this._b2=((1+c)*.5)/a0;
    this._a1=(-2*c)/a0; this._a2=(1-a)/a0;
  }

  setBandPass(f, fs, Q) {
    Q=Math.max(.1,Q); var w0=2*Math.PI*f/fs, c=Math.cos(w0), s=Math.sin(w0);
    var a=s/(2*Q), a0=1+a;
    this._b0=a/a0; this._b1=0; this._b2=-a/a0;
    this._a1=(-2*c)/a0; this._a2=(1-a)/a0;
  }

  setPeak(f, fs, Q, gdb) {
    Q=Math.max(.1,Q); var A=Math.pow(10,gdb/40), w0=2*Math.PI*f/fs;
    var c=Math.cos(w0), s=Math.sin(w0), a=s/(2*Q), a0=1+a/A;
    this._b0=(1+a*A)/a0; this._b1=(-2*c)/a0; this._b2=(1-a*A)/a0;
    this._a1=(-2*c)/a0; this._a2=(1-a/A)/a0;
  }

  setAllPass(f, fs, Q) {
    Q=Math.max(.1,Q); var w0=2*Math.PI*f/fs, c=Math.cos(w0), s=Math.sin(w0);
    var a=s/(2*Q), a0=1+a;
    this._b0=(1-a)/a0; this._b1=(-2*c)/a0; this._b2=(1+a)/a0;
    this._a1=(-2*c)/a0; this._a2=(1-a)/a0;
  }

  setLowShelf(f, fs, gdb, Q) {
    Q=Math.max(.1,Q||.707); var A=Math.pow(10,gdb/40), w0=2*Math.PI*f/fs;
    var c=Math.cos(w0), s=Math.sin(w0), a=s/(2*Q), sqA=Math.sqrt(A);
    var a0=(A+1)+(A-1)*c+2*sqA*a;
    this._b0=(A*((A+1)-(A-1)*c+2*sqA*a))/a0;
    this._b1=(2*A*((A-1)-(A+1)*c))/a0;
    this._b2=(A*((A+1)-(A-1)*c-2*sqA*a))/a0;
    this._a1=(-2*((A-1)+(A+1)*c))/a0;
    this._a2=((A+1)+(A-1)*c-2*sqA*a)/a0;
  }

  setHighShelf(f, fs, gdb, Q) {
    Q=Math.max(.1,Q||.707); var A=Math.pow(10,gdb/40), w0=2*Math.PI*f/fs;
    var c=Math.cos(w0), s=Math.sin(w0), a=s/(2*Q), sqA=Math.sqrt(A);
    var a0=(A+1)-(A-1)*c+2*sqA*a;
    this._b0=(A*((A+1)+(A-1)*c+2*sqA*a))/a0;
    this._b1=(-2*A*((A-1)+(A+1)*c))/a0;
    this._b2=(A*((A+1)+(A-1)*c-2*sqA*a))/a0;
    this._a1=(2*((A-1)-(A+1)*c))/a0;
    this._a2=((A+1)-(A-1)*c-2*sqA*a)/a0;
  }

  process(x) {
    var y = this._b0*x + this._z1;
    this._z1 = this._b1*x - this._a1*y + this._z2;
    this._z2 = this._b2*x - this._a2*y;
    return y;
  }

  reset() { this._z1=0; this._z2=0; }
}


class LR4 {
  constructor() { this._s1=new Biquad(); this._s2=new Biquad(); }
  static get Q() { return 0.7071067811865476; }
  setLowPass(f,fs) { var q=LR4.Q; this._s1.setLowPass(f,fs,q); this._s2.setLowPass(f,fs,q); }
  setHighPass(f,fs) { var q=LR4.Q; this._s1.setHighPass(f,fs,q); this._s2.setHighPass(f,fs,q); }
  process(x) { return this._s2.process(this._s1.process(x)); }
  reset() { this._s1.reset(); this._s2.reset(); }
}


class OnePole {
  constructor() { this._a=0; this._y=0; }
  setTimeConstant(tcMs, fs) { this._a = 1 - Math.exp(-1/(tcMs*1e-3*fs)); }
  process(x) { this._y += this._a*(x-this._y); return this._y; }
  get value() { return this._y; }
  reset() { this._y=0; }
}


class CompBand {
  constructor() { this._env=0; this._aA=0; this._aR=0; this._T=1; this._p=1; }

  setParams(threshold, ratio, attackMs, releaseMs, fs) {
    this._T = Math.max(1e-6, threshold);
    this._p = Math.max(0.1, ratio - 1);
    this._aA = 1 - Math.exp(-1/(Math.max(0.1,attackMs)*1e-3*fs));
    this._aR = 1 - Math.exp(-1/(Math.max(1,releaseMs)*1e-3*fs));
  }

  process(x) {
    var ax = Math.abs(x);
    var a = (ax > this._env) ? this._aA : this._aR;
    this._env += a * (ax - this._env);
    var G = 1 / (1 + Math.pow(this._env / this._T, this._p));
    return x * G;
  }

  reset() { this._env=0; }
}


class VirtualBassEnhancer {
  constructor() {
    this.harmGain = 0.35;
    this.subGain = 0.15;
    this.bodyGain = 0.18;
    this.resonGain = 0.25;
    this.dryGain = 1.0;
    this.enabled = false;

    this.a2 = 0.15;
    this.a3 = 0.85;
    this.bassCutoff = 120;
    this.harmLow = 120;
    this.harmHigh = 350;

    this.cutoffFrequency = 90;

    this.transHPF = 1000;
    this.transDrive = 2.0;
    this.resonFreq = 2200;
    this.resonQ = 1.0;

    this.dynEqFreq = 150;
    this.dynEqBoostDb = 4;
    this.dynEqCutDb = -6;

    this.loudnessGainDb = 5;

    this._sr=44100; this._osr=88200; this._prepared=false;

    this._hpfL = new LR4(); this._hpfR = new LR4();
    this._delayL=null; this._delayR=null; this._dW=0; this._dN=0;

    this._lpfBass = new LR4();
    this._aaPre = new Biquad(); this._aaPost = new Biquad();
    this._harmHPF = new Biquad(); this._harmLPF = new Biquad();
    this._dcOff=0; this._dcA=0;

    this._bpfSub = new Biquad();
    this._pllPhase=0; this._pllFreq=120; this._subPhase=0;
    this._pllAlpha=0; this._subEnv = new OnePole();

    this._bpfBody = new Biquad();

    this._lpfTrans = new Biquad();
    this._transEnv = new OnePole();

    this._bpfReson = new Biquad();

    this._dynEqL = new Biquad(); this._dynEqR = new Biquad();
    this._dynEqEnv = new OnePole();

    this._xo1L=new LR4(); this._xo1R=new LR4();
    this._xo2L=new LR4(); this._xo2R=new LR4();
    this._xo3L=new LR4(); this._xo3R=new LR4();
    this._cSubL=new CompBand(); this._cSubR=new CompBand();
    this._cBodyL=new CompBand(); this._cBodyR=new CompBand();
    this._cMidL=new CompBand(); this._cMidR=new CompBand();
    this._cHighL=new CompBand(); this._cHighR=new CompBand();

    this._loudL = new Biquad(); this._loudR = new Biquad();

    this._limDelayL=null; this._limDelayR=null;
    this._limW=0; this._limN=0;
    this._limEnvL=0; this._limEnvR=0;
    this._limThresh=0.891;
    this._limAa=0; this._limAr=0;

    this._mono=null; this._bassBuf=null; this._upBuf=null; this._nldBuf=null;
    this._harm2x=null; this._harmBuf=null; this._subBuf=null;
    this._bodyBuf=null; this._transBuf=null; this._resonBuf=null;
  }


  prepare(sampleRate, maxBlockSize) {
    this._sr = sampleRate;
    this._osr = sampleRate * 2;

    this._hpfL.setHighPass(this.cutoffFrequency, sampleRate);
    this._hpfR.setHighPass(this.cutoffFrequency, sampleRate);

    this._lpfBass.setLowPass(this.bassCutoff, sampleRate);

    var nyq = sampleRate * 0.5;
    this._aaPre.setLowPass(nyq*0.85, this._osr, 0.707);
    this._aaPost.setLowPass(nyq*0.85, this._osr, 0.707);

    this._harmHPF.setHighPass(this.harmLow, this._osr, 0.707);
    this._harmLPF.setLowPass(this.harmHigh, this._osr, 0.707);

    this._dcA = 1 - Math.exp(-1/(0.003*sampleRate));

    this._bpfSub.setBandPass(125, sampleRate, 2.0);
    this._pllAlpha = 1 - Math.exp(-1/(0.005*sampleRate));
    this._subEnv.setTimeConstant(15, sampleRate);

    this._bpfBody.setBandPass(400, sampleRate, 0.7);

    this._lpfTrans.setLowPass(this.transHPF, sampleRate, 0.707);
    this._transEnv.setTimeConstant(10, sampleRate);

    this._bpfReson.setBandPass(this.resonFreq, sampleRate, this.resonQ);

    this._dynEqL.setLowShelf(this.dynEqFreq, sampleRate, this.dynEqBoostDb, 0.707);
    this._dynEqR.setLowShelf(this.dynEqFreq, sampleRate, this.dynEqBoostDb, 0.707);
    this._dynEqEnv.setTimeConstant(50, sampleRate);

    this._xo1L.setLowPass(120, sampleRate);
    this._xo2L.setLowPass(400, sampleRate);
    this._xo3L.setLowPass(2000, sampleRate);
    this._xo1L_hp = new LR4(); this._xo1R_hp = new LR4();
    this._xo2L_hp = new LR4(); this._xo2R_hp = new LR4();
    this._xo3L_hp = new LR4(); this._xo3R_hp = new LR4();
    this._xo1L.setLowPass(120, sampleRate);
    this._xo1R.setLowPass(120, sampleRate);
    this._xo1L_hp.setHighPass(120, sampleRate);
    this._xo1R_hp.setHighPass(120, sampleRate);
    this._xo2L.setLowPass(400, sampleRate);
    this._xo2R.setLowPass(400, sampleRate);
    this._xo2L_hp.setHighPass(400, sampleRate);
    this._xo2R_hp.setHighPass(400, sampleRate);
    this._xo3L.setLowPass(2000, sampleRate);
    this._xo3R.setLowPass(2000, sampleRate);
    this._xo3L_hp.setHighPass(2000, sampleRate);
    this._xo3R_hp.setHighPass(2000, sampleRate);

    this._cSubL.setParams(0.5, 3.0, 10, 100, sampleRate);
    this._cSubR.setParams(0.5, 3.0, 10, 100, sampleRate);
    this._cBodyL.setParams(0.6, 2.0, 10, 100, sampleRate);
    this._cBodyR.setParams(0.6, 2.0, 10, 100, sampleRate);
    this._cMidL.setParams(0.7, 1.5, 5, 80, sampleRate);
    this._cMidR.setParams(0.7, 1.5, 5, 80, sampleRate);
    this._cHighL.setParams(0.6, 2.0, 2, 60, sampleRate);
    this._cHighR.setParams(0.6, 2.0, 2, 60, sampleRate);

    this._loudL.setLowShelf(250, sampleRate, this.loudnessGainDb, 0.707);
    this._loudR.setLowShelf(250, sampleRate, this.loudnessGainDb, 0.707);

    this._limN = Math.ceil(0.001 * sampleRate);
    this._limDelayL = new Float32Array(this._limN);
    this._limDelayR = new Float32Array(this._limN);
    this._limW = 0;
    this._limAa = 1 - Math.exp(-1/(0.001*sampleRate));
    this._limAr = 1 - Math.exp(-1/(0.080*sampleRate));

    this._dN = 2;
    this._delayL = new Float32Array(this._dN);
    this._delayR = new Float32Array(this._dN);
    this._dW = 0;

    var n = maxBlockSize, n2 = maxBlockSize*2;
    this._mono=new Float32Array(n);
    this._bassBuf=new Float32Array(n);
    this._upBuf=new Float32Array(n2);
    this._nldBuf=new Float32Array(n2);
    this._harm2x=new Float32Array(n2);
    this._harmBuf=new Float32Array(n);
    this._subBuf=new Float32Array(n);
    this._bodyBuf=new Float32Array(n);
    this._transBuf=new Float32Array(n);
    this._resonBuf=new Float32Array(n);

    this._dcOff=0; this._pllPhase=0; this._pllFreq=120; this._subPhase=0;
    this._limEnvL=0; this._limEnvR=0;

    this._prepared = true;
  }


  setParameter(name, value) {
    switch (name) {
      case 'enabled': this.enabled = !!value; break;
      case 'harmGain': this.harmGain = Math.max(0, Math.min(1, value)); break;
      case 'subGain': this.subGain = Math.max(0, Math.min(1, value)); break;
      case 'bodyGain': this.bodyGain = Math.max(0, Math.min(1, value)); break;
      case 'resonGain': this.resonGain = Math.max(0, Math.min(1, value)); break;
      case 'dryGain': this.dryGain = Math.max(0, Math.min(1, value)); break;
      case 'a2': this.a2 = Math.max(0, Math.min(1, value)); break;
      case 'a3': this.a3 = Math.max(0, Math.min(2, value)); break;
      case 'cutoffFrequency':
        this.cutoffFrequency = Math.max(50, Math.min(300, value));
        if (this._prepared) {
          this._hpfL.setHighPass(this.cutoffFrequency, this._sr);
          this._hpfR.setHighPass(this.cutoffFrequency, this._sr);
        }
        break;
      case 'transDrive': this.transDrive = Math.max(1, Math.min(5, value)); break;
      case 'resonFreq':
        this.resonFreq = Math.max(1000, Math.min(4000, value));
        if (this._prepared) this._bpfReson.setBandPass(this.resonFreq, this._sr, this.resonQ);
        break;
    }
  }

  setParameters(p) {
    var keys = ['enabled','harmGain','subGain','bodyGain','resonGain','dryGain',
                'a2','a3','cutoffFrequency','transDrive','resonFreq'];
    for (var i=0; i<keys.length; i++)
      if (p[keys[i]] !== undefined) this.setParameter(keys[i], p[keys[i]]);
  }


  processBlock(inL, inR, outL, outR, frames) {
    if (!this._prepared || !this.enabled) {
      for (var i=0; i<frames; i++) { outL[i]=inL[i]; outR[i]=inR[i]; }
      return;
    }

    var sr = this._sr, osr = this._osr;
    var n2 = frames * 2;

    for (var i=0; i<frames; i++)
      this._mono[i] = (inL[i] + inR[i]) * 0.5;

    for (var i=0; i<frames; i++)
      this._bassBuf[i] = this._lpfBass.process(this._mono[i]);

    for (var i=0; i<frames; i++) {
      var j=i*2;
      this._upBuf[j] = this._bassBuf[i];
      var next = (i<frames-1) ? this._bassBuf[i+1] : this._bassBuf[i];
      this._upBuf[j+1] = (this._bassBuf[i]+next)*0.5;
    }

    for (var i=0; i<n2; i++) this._upBuf[i] = this._aaPre.process(this._upBuf[i]);

    var a2=this.a2, a3=this.a3, dcA=this._dcA, dcOff=this._dcOff;
    for (var i=0; i<n2; i++) {
      var x = this._upBuf[i];
      dcOff += dcA * (Math.abs(x) - dcOff);
      var xc = x>1 ? 1 : (x<-1 ? -1 : x);
      var x2 = xc*xc;
      var x3 = x2*xc;
      var H = a2*x2 + a3*x3;
      var A = 1/(1 + 0.8*Math.abs(x));
      this._nldBuf[i] = 0.35 * A * H;
    }
    this._dcOff = dcOff;

    for (var i=0; i<n2; i++) this._harm2x[i] = this._harmHPF.process(this._nldBuf[i]);
    for (var i=0; i<n2; i++) this._harm2x[i] = this._harmLPF.process(this._harm2x[i]);

    for (var i=0; i<n2; i++) this._harm2x[i] = this._aaPost.process(this._harm2x[i]);
    for (var i=0; i<frames; i++) this._harmBuf[i] = this._harm2x[i*2];

    var pllPhase=this._pllPhase, pllFreq=this._pllFreq, subPhase=this._subPhase;
    var pllA=this._pllAlpha, twoPI=2*Math.PI, pi=Math.PI;
    for (var i=0; i<frames; i++) {
      var xb = this._bpfSub.process(this._mono[i]);

      var lo = Math.sin(pllPhase);
      var pd = xb * lo;
      pllFreq += pllA * pd * 300;
      if (pllFreq < 80) pllFreq = 80;
      if (pllFreq > 200) pllFreq = 200;
      pllPhase += twoPI * pllFreq / sr;
      if (pllPhase > twoPI) pllPhase -= twoPI;

      subPhase += pi * pllFreq / sr;
      if (subPhase > twoPI) subPhase -= twoPI;

      this._subEnv.process(Math.abs(xb));

      var s = this.subGain * this._subEnv.value * Math.sin(subPhase);
      var lim = this.subGain * Math.abs(this._mono[i]);
      if (s > lim) s = lim; else if (s < -lim) s = -lim;
      this._subBuf[i] = s;
    }
    this._pllPhase = pllPhase; this._pllFreq = pllFreq; this._subPhase = subPhase;

    for (var i=0; i<frames; i++)
      this._bodyBuf[i] = this._bpfBody.process(this._mono[i]);

    var tDrive = this.transDrive;
    for (var i=0; i<frames; i++) {
      var lp = this._lpfTrans.process(this._mono[i]);
      var T = this._mono[i] - lp;
      var T2 = Math.tanh(tDrive * T);
      this._transEnv.process(Math.abs(T));
      var G = 1 + 0.8 * this._transEnv.value;
      this._transBuf[i] = T2 * G;
    }

    for (var i=0; i<frames; i++)
      this._resonBuf[i] = this._bpfReson.process(this._transBuf[i]);

    var dryG = this.dryGain;
    var hG = this.harmGain, sG = this.subGain, bG = this.bodyGain, rG = this.resonGain;
    var dN=this._dN, dW=this._dW, dBL=this._delayL, dBR=this._delayR;

    for (var i=0; i<frames; i++) {
      var mainL = this._hpfL.process(inL[i]);
      var mainR = this._hpfR.process(inR[i]);
      var dl = dBL[dW], dr = dBR[dW];
      dBL[dW] = mainL; dBR[dW] = mainR;
      dW = (dW+1) % dN;

      var enh = this._harmBuf[i]*hG + this._subBuf[i]*sG
              + this._bodyBuf[i]*bG + this._resonBuf[i]*rG;

      outL[i] = dl * dryG + enh;
      outR[i] = dr * dryG + enh;
    }
    this._dW = dW;

    for (var i=0; i<frames; i++) {
      var lvl = Math.abs(outL[i]);
      this._dynEqEnv.process(lvl);
      var k = 3.0;
      var gComp = 1/(1 + k * this._dynEqEnv.value);
      var gainDb = this.dynEqBoostDb * gComp + this.dynEqCutDb * (1 - gComp);
      var dynGain = Math.pow(10, gainDb/20);
      var shelvedL = this._dynEqL.process(outL[i]);
      var shelvedR = this._dynEqR.process(outR[i]);
      outL[i] = outL[i] + (shelvedL - outL[i]) * dynGain;
      outR[i] = outR[i] + (shelvedR - outR[i]) * dynGain;
    }

    for (var i=0; i<frames; i++) {
      var l = outL[i], r = outR[i];

      var subL = this._xo1L.process(l);
      var hp1L = this._xo1L_hp.process(l);
      var bodyL = this._xo2L.process(hp1L);
      var hp2L = this._xo2L_hp.process(hp1L);
      var midL = this._xo3L.process(hp2L);
      var highL = this._xo3L_hp.process(hp2L);

      var subR = this._xo1R.process(r);
      var hp1R = this._xo1R_hp.process(r);
      var bodyR = this._xo2R.process(hp1R);
      var hp2R = this._xo2R_hp.process(hp1R);
      var midR = this._xo3R.process(hp2R);
      var highR = this._xo3R_hp.process(hp2R);

      outL[i] = this._cSubL.process(subL) + this._cBodyL.process(bodyL)
              + this._cMidL.process(midL) + this._cHighL.process(highL);
      outR[i] = this._cSubR.process(subR) + this._cBodyR.process(bodyR)
              + this._cMidR.process(midR) + this._cHighR.process(highR);
    }

    for (var i=0; i<frames; i++) {
      outL[i] = this._loudL.process(outL[i]);
      outR[i] = this._loudR.process(outR[i]);
    }

    var lt=this._limThresh, la=this._limAa, lr=this._limAr;
    var lw=this._limW, ln=this._limN;
    var eL=this._limEnvL, eR=this._limEnvR;
    var dLL=this._limDelayL, dRR=this._limDelayR;
    for (var i=0; i<frames; i++) {
      var delayedL = dLL[lw], delayedR = dRR[lw];
      dLL[lw] = outL[i]; dRR[lw] = outR[i];
      lw = (lw+1) % ln;

      var aL = Math.abs(outL[i]), aR = Math.abs(outR[i]);
      var aMax = aL > aR ? aL : aR;
      var a = (aMax > eL) ? la : lr;
      eL += a * (aMax - eL);

      var g = 1;
      if (eL > lt) g = lt / eL;

      outL[i] = delayedL * g;
      outR[i] = delayedR * g;
    }
    this._limW = lw; this._limEnvL = eL; this._limEnvR = eR;
  }


  reset() {
    this._hpfL.reset(); this._hpfR.reset(); this._lpfBass.reset();
    this._aaPre.reset(); this._aaPost.reset();
    this._harmHPF.reset(); this._harmLPF.reset();
    this._bpfSub.reset(); this._bpfBody.reset();
    this._lpfTrans.reset(); this._bpfReson.reset();
    this._dynEqL.reset(); this._dynEqR.reset(); this._dynEqEnv.reset();
    this._subEnv.reset(); this._transEnv.reset();
    this._xo1L.reset(); this._xo1R.reset();
    this._xo1L_hp.reset(); this._xo1R_hp.reset();
    this._xo2L.reset(); this._xo2R.reset();
    this._xo2L_hp.reset(); this._xo2R_hp.reset();
    this._xo3L.reset(); this._xo3R.reset();
    this._xo3L_hp.reset(); this._xo3R_hp.reset();
    this._cSubL.reset(); this._cSubR.reset();
    this._cBodyL.reset(); this._cBodyR.reset();
    this._cMidL.reset(); this._cMidR.reset();
    this._cHighL.reset(); this._cHighR.reset();
    this._loudL.reset(); this._loudR.reset();
    this._dcOff=0; this._pllPhase=0; this._pllFreq=120; this._subPhase=0;
    this._limEnvL=0; this._limEnvR=0; this._limW=0;
    if (this._delayL) this._delayL.fill(0);
    if (this._delayR) this._delayR.fill(0);
    if (this._limDelayL) this._limDelayL.fill(0);
    if (this._limDelayR) this._limDelayR.fill(0);
    this._dW=0;
    if (this._mono) this._mono.fill(0);
    if (this._bassBuf) this._bassBuf.fill(0);
    if (this._upBuf) this._upBuf.fill(0);
    if (this._nldBuf) this._nldBuf.fill(0);
    if (this._harm2x) this._harm2x.fill(0);
    if (this._harmBuf) this._harmBuf.fill(0);
    if (this._subBuf) this._subBuf.fill(0);
    if (this._bodyBuf) this._bodyBuf.fill(0);
    if (this._transBuf) this._transBuf.fill(0);
    if (this._resonBuf) this._resonBuf.fill(0);
  }
}


class VBEProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._vbe = new VirtualBassEnhancer();
    this._pending = null;

    this.port.onmessage = (e) => {
      var msg = e.data;
      switch (msg.type) {
        case 'prepare':
          this._vbe.prepare(msg.sampleRate || sampleRate, msg.maxBlockSize || 128);
          if (this._pending) { this._vbe.setParameters(this._pending); this._pending = null; }
          break;
        case 'params':
          if (this._vbe._prepared) this._vbe.setParameters(msg.params);
          else this._pending = msg.params;
          break;
        case 'param':
          if (this._vbe._prepared) this._vbe.setParameter(msg.name, msg.value);
          else { this._pending = this._pending || {}; this._pending[msg.name] = msg.value; }
          break;
        case 'enabled':
          if (this._vbe._prepared) this._vbe.setParameter('enabled', msg.value);
          break;
        case 'reset':
          this._vbe.reset();
          break;
      }
    };

    this._vbe.prepare(sampleRate, 128);
  }

  process(inputs, outputs) {
    var input = inputs[0], output = outputs[0];
    if (!input || input.length === 0 || input[0].length === 0) {
      if (output && output.length > 0)
        for (var ch=0; ch<output.length; ch++) output[ch].fill(0);
      return true;
    }
    var inL = input[0], inR = input.length >= 2 ? input[1] : input[0];
    var outL = output[0], outR = output.length >= 2 ? output[1] : output[0];
    this._vbe.processBlock(inL, inR, outL, outR, inL.length);
    for (var ch=2; ch<output.length; ch++) output[ch].fill(0);
    return true;
  }
}

registerProcessor('vbe-processor', VBEProcessor);
