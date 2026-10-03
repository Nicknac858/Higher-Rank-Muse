
    (function () {
      var orbitExperience = document.querySelector('.orbit-experience');
      var desktopQuery = window.matchMedia('(min-width: 901px) and (prefers-reduced-motion: no-preference)');
      if (!orbitExperience || !desktopQuery.matches) return;

      var canvas = document.getElementById('orbit-canvas');

      /* The panel flight is self-contained; WebGL capability gates the cinematic desktop experience. */
      if (!window.THREE) {
        var webglProbe = document.createElement('canvas');
        var webglAvailable = false;
        try { webglAvailable = !!(webglProbe.getContext('webgl') || webglProbe.getContext('experimental-webgl')); } catch (error) { webglAvailable = false; }
        if (!webglAvailable) return;
        document.documentElement.classList.add('orbit-ready');
        var fallbackRing = document.getElementById('orbit-ring');
        var fallbackPanels = Array.prototype.slice.call(document.querySelectorAll('.orbit-panel'));
        var fallbackProgress = document.querySelector('.orbit-progress');
        var fallbackCount = document.getElementById('orbit-count');
        var fallbackTitle = document.getElementById('orbit-title');
        var fallbackDots = [];
        var fallbackTarget = 0;
        var fallbackDisplay = 0;
        var ctx = canvas.getContext('2d');
        var canvasRatio = Math.min(window.devicePixelRatio || 1, 1);
        var fallbackBg = document.createElement('canvas');
        var spine = null;
        var spineLastDisplay = -1;

        fallbackPanels.forEach(function (panel, index) {
          var dot = document.createElement('button');
          dot.type = 'button';
          dot.className = 'orbit-dot' + (index === 0 ? ' is-active' : '');
          dot.setAttribute('aria-label', 'Go to ' + panel.getAttribute('data-title'));
          dot.addEventListener('click', function () { fallbackGo(index); });
          fallbackProgress.appendChild(dot);
          fallbackDots.push(dot);
        });

        /* Real-time 3D spine: a glowing helical column of light rendered in
           raw WebGL1 (no libraries, no external assets) that the panels
           revolve around. It draws ON TOP of the photoreal plate stack
           (the world inside the central column): if the GL context or any
           shader fails, initSpine returns null and the plates still
           crossfade on their own via the scroll driver. On success the
           html element gets the 'spine-on' class, which reveals this
           canvas; the plates stay visible underneath either way.
           The point systems (starfield, helical strands, star crown,
           city base, rising motes, sparkle glints) share two generated
           sprite textures. Volumetric mesh bodies layer over them —
           helical light tubes, a glass core, light shafts, a reflective
           ground disc with a mirrored city, and a nebula dust field —
           each built independently and skipped if its shader fails.
           Additive blending, no depth test throughout: draw order and
           the shaders carry all the depth. */
        function initSpine() {
          var glCanvas = document.getElementById('orbit-spine');
          if (!glCanvas) return null;
          var gl = null;
          var ctxOpts = { alpha:true, antialias:false, depth:false, stencil:false, preserveDrawingBuffer:true, powerPreference:'low-power' };
          try { gl = glCanvas.getContext('webgl', ctxOpts) || glCanvas.getContext('experimental-webgl', ctxOpts); } catch (error) { gl = null; }
          if (!gl) return null;

          function compileShader(type, src) {
            var sh = gl.createShader(type);
            gl.shaderSource(sh, src);
            gl.compileShader(sh);
            if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { gl.deleteShader(sh); return null; }
            return sh;
          }
          function buildProgram(vsSrc, fsSrc) {
            var vs = compileShader(gl.VERTEX_SHADER, vsSrc);
            var fs = compileShader(gl.FRAGMENT_SHADER, fsSrc);
            if (!vs || !fs) return null;
            var pr = gl.createProgram();
            gl.attachShader(pr, vs);
            gl.attachShader(pr, fs);
            gl.linkProgram(pr);
            if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { gl.deleteProgram(pr); return null; }
            return pr;
          }

          /* Point sprites at 128x128: (a) a soft disc with a hot white
             core; (b) the same disc plus thin cross diffraction spikes
             for star glints and the crown. */
          function makeSpriteTexture(sparkle) {
            var c = document.createElement('canvas');
            c.width = 128; c.height = 128;
            var g2 = c.getContext('2d');
            var grad = g2.createRadialGradient(64, 64, 0, 64, 64, 64);
            grad.addColorStop(0, 'rgba(255,255,255,1)');
            grad.addColorStop(.18, 'rgba(255,255,255,.95)');
            grad.addColorStop(.45, 'rgba(255,255,255,.32)');
            grad.addColorStop(1, 'rgba(255,255,255,0)');
            g2.fillStyle = grad;
            g2.fillRect(0, 0, 128, 128);
            if (sparkle) {
              g2.globalCompositeOperation = 'lighter';
              var hg = g2.createLinearGradient(0, 0, 128, 0);
              hg.addColorStop(0, 'rgba(255,255,255,0)');
              hg.addColorStop(.5, 'rgba(255,255,255,.9)');
              hg.addColorStop(1, 'rgba(255,255,255,0)');
              g2.fillStyle = hg;
              g2.fillRect(0, 63, 128, 2);
              var vg = g2.createLinearGradient(0, 0, 0, 128);
              vg.addColorStop(0, 'rgba(255,255,255,0)');
              vg.addColorStop(.5, 'rgba(255,255,255,.9)');
              vg.addColorStop(1, 'rgba(255,255,255,0)');
              g2.fillStyle = vg;
              g2.fillRect(63, 0, 2, 128);
            }
            var tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            return tex;
          }
          var softTex = makeSpriteTexture(false);
          var sparkleTex = makeSpriteTexture(true);

          var fsSrc = [
            'precision mediump float;',
            'uniform sampler2D uTex;',
            'varying vec3 vColor;',
            'varying float vAlpha;',
            'void main(){',
            '  vec4 tex = texture2D(uTex, gl_PointCoord);',
            '  gl_FragColor = vec4(vColor, vAlpha) * tex;',
            '}'
          ].join('\n');

          /* Strands: 3 intertwined helices, every point drawn twice via
             aLayer (0 = bright core shifted toward white, 1 = wide faint
             halo). A traveling energy pulse runs down aS and multiplies
             alpha. uPhase rotates the column in registration with the
             panels and the 2D ribbon; uBreath is the whole-scene
             breathing factor. */
          var strandVs = [
            'attribute float aS;',
            'attribute float aStrand;',
            'attribute float aRand;',
            'attribute float aLayer;',
            'uniform mat4 uProj;',
            'uniform mat4 uView;',
            'uniform float uPhase;',
            'uniform float uTime;',
            'uniform float uPointScale;',
            'uniform float uBreath;',
            'uniform float uEnv;',
            'uniform vec2 uCourse;',
            'varying vec3 vColor;',
            'varying float vAlpha;',
            'void main(){',
            '  float ang = aS * 3.14159265 * 7.0 + aStrand * 2.094 + uPhase;',
            '  float radius = 0.55 * (0.75 + 0.25 * sin(aS * 3.14159265));',
            '  vec3 pos = vec3(cos(ang) * radius, (0.5 - aS) * 4.4, sin(ang) * radius);',
            '  vec4 mv = uView * vec4(pos, 1.0);',
            '  gl_Position = uProj * mv;',
            '  vec3 top = vec3(0.38, 0.93, 1.0);',
            '  vec3 mid = vec3(0.18, 0.49, 0.96);',
            '  vec3 bot = vec3(0.80, 0.92, 1.0);',
            '  vec3 base = aS < 0.5 ? mix(top, mid, aS * 2.0) : mix(mid, bot, (aS - 0.5) * 2.0);',
            '  float pulse = 0.85 + 0.15 * sin(uTime * 2.2 + aS * 18.0 + aStrand * 2.1);',
            '  float size = (0.05 + 0.055 * sin(aS * 3.14159265)) * (0.8 + aRand * 0.4) * pulse;',
            '  float energy = 1.0 + 0.9 * pow(0.5 + 0.5 * sin(aS * 24.0 - uTime * 2.6 + aStrand * 2.1), 3.0);',
            '  float cdx = (aS - uCourse.x) * 6.0;',
            '  float cdy = (aS - uCourse.y) * 6.0;',
            '  float cg = exp(-cdx * cdx) * 1.6 + exp(-cdy * cdy) * 1.2;',
            '  float isHalo = step(0.5, aLayer);',
            '  gl_PointSize = size * mix(1.0, 3.4, isHalo) * uPointScale / max(1.0, -mv.z);',
            '  vColor = mix(base, vec3(1.0), mix(0.45, 0.05, isHalo));',
            '  vColor = mix(vColor, vec3(1.0), min(0.6, cg * 0.45));',
            '  float hazeF = exp(-max(0.0, -mv.z - 6.0) * 0.05);',
            '  vAlpha = 0.85 * energy * uBreath * mix(1.0, 0.15, isHalo) * (0.75 + cg * (0.5 + uEnv)) * hazeF;',
            '}'
          ].join('\n');

          /* Static clouds (star crown + city base): precomputed positions,
             per-point size/color/alpha, gentle per-point flicker. */
          var cloudVs = [
            'attribute vec3 aPos;',
            'attribute float aSize;',
            'attribute vec3 aColor;',
            'attribute float aRand;',
            'attribute float aAlpha;',
            'uniform mat4 uProj;',
            'uniform mat4 uView;',
            'uniform float uTime;',
            'uniform float uPointScale;',
            'uniform float uBreath;',
            'varying vec3 vColor;',
            'varying float vAlpha;',
            'void main(){',
            '  vec4 mv = uView * vec4(aPos, 1.0);',
            '  gl_Position = uProj * mv;',
            '  float flick = 0.72 + 0.28 * sin(uTime * (1.2 + aRand * 2.6) + aRand * 43.7);',
            '  gl_PointSize = aSize * uPointScale / max(1.0, -mv.z);',
            '  float hazeF = exp(-max(0.0, -mv.z - 6.0) * 0.05);',
            '  vColor = aColor;',
            '  vAlpha = flick * aAlpha * uBreath * hazeF;',
            '}'
          ].join('\n');

          /* City variant: a lived-in settlement flicker — a wider swing
             (0.45–1.0) plus hash-driven blink-outs that drop ~8% of the
             lights to 25% alpha at any moment, each on its own clock.
             The one large ground-glow sprite (aSize > 0.5) never blinks.
             Two extra uniforms drive the mirrored draw: uMirror flips
             each light across the ground plane (y = -2.32) with a softer,
             larger sprite so the settlement reflects on the dark ground. */
          var cityVs = [
            'attribute vec3 aPos;',
            'attribute float aSize;',
            'attribute vec3 aColor;',
            'attribute float aRand;',
            'attribute float aAlpha;',
            'uniform mat4 uProj;',
            'uniform mat4 uView;',
            'uniform float uTime;',
            'uniform float uPointScale;',
            'uniform float uBreath;',
            'uniform float uMirror;',
            'uniform float uAlphaMul;',
            'varying vec3 vColor;',
            'varying float vAlpha;',
            'void main(){',
            '  vec3 pos = aPos;',
            '  if (uMirror > 0.5) pos.y = -4.64 - aPos.y;',
            '  vec4 mv = uView * vec4(pos, 1.0);',
            '  gl_Position = uProj * mv;',
            '  float flick = 0.45 + 0.55 * (0.5 + 0.5 * sin(uTime * (1.2 + aRand * 2.6) + aRand * 43.7));',
            '  float stepIdx = floor(uTime * (0.5 + aRand));',
            '  float hash = fract(sin(aRand * 127.1 + stepIdx * 311.7) * 43758.5453);',
            '  float blink = (hash < 0.08 && aSize < 0.5) ? 0.25 : 1.0;',
            '  gl_PointSize = aSize * mix(1.0, 1.35, uMirror) * uPointScale / max(1.0, -mv.z);',
            '  float hazeF = exp(-max(0.0, -mv.z - 6.0) * 0.05);',
            '  vColor = aColor;',
            '  vAlpha = flick * blink * aAlpha * uBreath * uAlphaMul * hazeF;',
            '}'
          ].join('\n');

          /* Crown variant: the large central sprite (aSize >= 0.5) gets a
             slow breathing pulse on top of the cloud behavior. */
          var crownVs = [
            'attribute vec3 aPos;',
            'attribute float aSize;',
            'attribute vec3 aColor;',
            'attribute float aRand;',
            'attribute float aAlpha;',
            'uniform mat4 uProj;',
            'uniform mat4 uView;',
            'uniform float uTime;',
            'uniform float uPointScale;',
            'uniform float uBreath;',
            'varying vec3 vColor;',
            'varying float vAlpha;',
            'void main(){',
            '  vec4 mv = uView * vec4(aPos, 1.0);',
            '  gl_Position = uProj * mv;',
            '  float flick = 0.72 + 0.28 * sin(uTime * (1.2 + aRand * 2.6) + aRand * 43.7);',
            '  float breathe = 1.0 + 0.12 * step(0.5, aSize) * (0.5 + 0.5 * sin(uTime * 0.9));',
            '  gl_PointSize = aSize * breathe * uPointScale / max(1.0, -mv.z);',
            '  float hazeF = exp(-max(0.0, -mv.z - 6.0) * 0.05);',
            '  vColor = aColor;',
            '  vAlpha = flick * aAlpha * uBreath * hazeF;',
            '}'
          ].join('\n');

          /* Rising motes: aS wraps upward over time inside the shader, so
             particles continually climb the column and fade at the ends. */
          var moteVs = [
            'attribute float aS;',
            'attribute float aRand;',
            'uniform mat4 uProj;',
            'uniform mat4 uView;',
            'uniform float uPhase;',
            'uniform float uTime;',
            'uniform float uPointScale;',
            'uniform float uBreath;',
            'varying vec3 vColor;',
            'varying float vAlpha;',
            'void main(){',
            '  float s = fract(aS + uTime * (0.02 + aRand * 0.03));',
            '  float ang = s * 3.14159265 * 7.0 + aRand * 6.28318 + uPhase;',
            '  float radius = (0.12 + aRand * 0.5) * (0.75 + 0.25 * sin(s * 3.14159265));',
            '  vec3 pos = vec3(cos(ang) * radius, (0.5 - s) * 4.4, sin(ang) * radius);',
            '  vec4 mv = uView * vec4(pos, 1.0);',
            '  gl_Position = uProj * mv;',
            '  gl_PointSize = (0.025 + aRand * 0.04) * uPointScale / max(1.0, -mv.z);',
            '  vColor = mix(vec3(0.40, 0.80, 1.0), vec3(0.85, 0.95, 1.0), aRand);',
            '  float hazeF = exp(-max(0.0, -mv.z - 6.0) * 0.05);',
            '  vAlpha = 0.55 * sin(s * 3.14159265) * uBreath * hazeF;',
            '}'
          ].join('\n');

          /* Sparkle glints: points on the helix (aRand picks the strand
             and phase) whose alpha is a sharp pow-24 flash — brief star
             glints that pop and vanish along the column. */
          var glintVs = [
            'attribute float aS;',
            'attribute float aStrand;',
            'attribute float aRand;',
            'attribute float aSize;',
            'uniform mat4 uProj;',
            'uniform mat4 uView;',
            'uniform float uPhase;',
            'uniform float uTime;',
            'uniform float uPointScale;',
            'uniform float uBreath;',
            'varying vec3 vColor;',
            'varying float vAlpha;',
            'void main(){',
            '  float ang = aS * 3.14159265 * 7.0 + aStrand * 2.094 + uPhase;',
            '  float radius = 0.55 * (0.75 + 0.25 * sin(aS * 3.14159265));',
            '  vec3 pos = vec3(cos(ang) * radius, (0.5 - aS) * 4.4, sin(ang) * radius);',
            '  vec4 mv = uView * vec4(pos, 1.0);',
            '  gl_Position = uProj * mv;',
            '  float flash = pow(max(0.0, sin(uTime * (0.5 + aRand * 0.9) + aRand * 61.0)), 24.0);',
            '  gl_PointSize = aSize * uPointScale / max(1.0, -mv.z);',
            '  vColor = vec3(0.88, 0.96, 1.0);',
            '  float hazeF = exp(-max(0.0, -mv.z - 6.0) * 0.05);',
            '  vAlpha = flash * uBreath * hazeF;',
            '}'
          ].join('\n');

          function makeSystem(vsSrc, data, tex) {
            var prog = buildProgram(vsSrc, fsSrc);
            if (!prog) return null;
            var sys = {
              prog: prog, tex: tex, count: 0, attribs: [],
              uProj: gl.getUniformLocation(prog, 'uProj'),
              uView: gl.getUniformLocation(prog, 'uView'),
              uPhase: gl.getUniformLocation(prog, 'uPhase'),
              uTime: gl.getUniformLocation(prog, 'uTime'),
              uPointScale: gl.getUniformLocation(prog, 'uPointScale'),
              uBreath: gl.getUniformLocation(prog, 'uBreath'),
              uTex: gl.getUniformLocation(prog, 'uTex')
            };
            for (var name in data) {
              var loc = gl.getAttribLocation(prog, name);
              if (loc < 0) continue;
              var buf = gl.createBuffer();
              gl.bindBuffer(gl.ARRAY_BUFFER, buf);
              gl.bufferData(gl.ARRAY_BUFFER, data[name].values, gl.STATIC_DRAW);
              sys.attribs.push({ loc: loc, buf: buf, size: data[name].size });
              sys.count = data[name].values.length / data[name].size;
            }
            return sys.count > 0 ? sys : null;
          }

          /* Mesh counterpart to makeSystem for the volumetric bodies:
             same attribute-map shape and the same degrade-independently
             contract — a failed program yields null and drawAll skips
             just that element. Meshes draw untextured triangles with
             per-fragment fresnel shading; count comes from any attribute
             (all share the same vertex count). */
          function makeMesh(vsSrc, fsMeshSrc, data, mode) {
            var prog = buildProgram(vsSrc, fsMeshSrc);
            if (!prog) return null;
            var sys = {
              prog: prog, mode: mode, count: 0, attribs: [],
              uProj: gl.getUniformLocation(prog, 'uProj'),
              uView: gl.getUniformLocation(prog, 'uView'),
              uPhase: gl.getUniformLocation(prog, 'uPhase'),
              uTime: gl.getUniformLocation(prog, 'uTime'),
              uBreath: gl.getUniformLocation(prog, 'uBreath'),
              uEnv: gl.getUniformLocation(prog, 'uEnv'),
              uCourse: gl.getUniformLocation(prog, 'uCourse')
            };
            for (var name in data) {
              var loc = gl.getAttribLocation(prog, name);
              if (loc < 0) continue;
              var buf = gl.createBuffer();
              gl.bindBuffer(gl.ARRAY_BUFFER, buf);
              gl.bufferData(gl.ARRAY_BUFFER, data[name].values, gl.STATIC_DRAW);
              sys.attribs.push({ loc: loc, buf: buf, size: data[name].size });
              sys.count = data[name].values.length / data[name].size;
            }
            return sys.count > 0 ? sys : null;
          }

          /* Strand geometry: 3 strands x 300 points, core layer first,
             then the same 900 points again as the halo layer (so the
             quality governor can skip the halo with one draw count). */
          var baseS = [], baseIdx = [], baseRand = [];
          for (var st = 0; st < 3; st++) {
            for (var si = 0; si < 300; si++) {
              baseS.push(si / 299);
              baseIdx.push(st);
              baseRand.push(Math.random());
            }
          }
          var strandS = [], strandIdx = [], strandRand = [], strandLayer = [];
          for (var layer = 0; layer < 2; layer++) {
            for (var pi = 0; pi < baseS.length; pi++) {
              strandS.push(baseS[pi]);
              strandIdx.push(baseIdx[pi]);
              strandRand.push(baseRand[pi]);
              strandLayer.push(layer);
            }
          }
          var strands = makeSystem(strandVs, {
            aS: { values: new Float32Array(strandS), size: 1 },
            aStrand: { values: new Float32Array(strandIdx), size: 1 },
            aRand: { values: new Float32Array(strandRand), size: 1 },
            aLayer: { values: new Float32Array(strandLayer), size: 1 }
          }, softTex);
          if (!strands) return null;
          strands.haloStart = baseS.length;
          strands.uCourse = gl.getUniformLocation(strands.prog, 'uCourse');
          strands.uEnv = gl.getUniformLocation(strands.prog, 'uEnv');

          /* Star crown: one large sparkle sprite at the top plus sparkles,
             all on the sparkle texture. */
          var crownPos = [0, 2.35, 0], crownSize = [0.9], crownColor = [0.88, 0.97, 1.0], crownRand = [0.5], crownAlpha = [1.0];
          for (var ci = 0; ci < 40; ci++) {
            var cAng = Math.random() * Math.PI * 2;
            var cRad = Math.pow(Math.random(), 0.6) * 0.3;
            crownPos.push(Math.cos(cAng) * cRad, 2.35 + (Math.random() - 0.5) * 0.22, Math.sin(cAng) * cRad);
            crownSize.push(0.03 + Math.random() * 0.06);
            var cPick = Math.random();
            if (cPick < 0.4) crownColor.push(0.45, 0.9, 1.0);
            else if (cPick < 0.75) crownColor.push(0.85, 0.95, 1.0);
            else crownColor.push(0.35, 0.6, 1.0);
            crownRand.push(Math.random());
            crownAlpha.push(0.9);
          }
          var crown = makeSystem(crownVs, {
            aPos: { values: new Float32Array(crownPos), size: 3 },
            aSize: { values: new Float32Array(crownSize), size: 1 },
            aColor: { values: new Float32Array(crownColor), size: 3 },
            aRand: { values: new Float32Array(crownRand), size: 1 },
            aAlpha: { values: new Float32Array(crownAlpha), size: 1 }
          }, sparkleTex);
          if (!crown) return null;

          /* City base: 800 lights in a flat disc, plus one large, very
             faint soft sprite at the center as ground glow. */
          var cityPos = [], citySize = [], cityColor = [], cityRand = [], cityAlpha = [];
          for (var bi = 0; bi < 800; bi++) {
            var bAng = Math.random() * Math.PI * 2;
            var bRad = 1.9 * Math.sqrt(Math.random());
            cityPos.push(Math.cos(bAng) * bRad, -2.3 + (Math.random() - 0.5) * 0.05, Math.sin(bAng) * bRad);
            citySize.push(0.025 + Math.random() * 0.045);
            var bPick = Math.random();
            if (bPick < 0.12) cityColor.push(1.0, 0.78, 0.5);
            else if (bPick < 0.5) cityColor.push(0.18, 0.49, 0.96);
            else if (bPick < 0.82) cityColor.push(0.38, 0.85, 1.0);
            else cityColor.push(0.82, 0.92, 1.0);
            cityRand.push(Math.random());
            cityAlpha.push(0.85);
          }
          cityPos.push(0, -2.32, 0);
          citySize.push(2.6);
          cityColor.push(0.18, 0.49, 0.96);
          cityRand.push(0.5);
          cityAlpha.push(0.10);
          var cityBase = makeSystem(cityVs, {
            aPos: { values: new Float32Array(cityPos), size: 3 },
            aSize: { values: new Float32Array(citySize), size: 1 },
            aColor: { values: new Float32Array(cityColor), size: 3 },
            aRand: { values: new Float32Array(cityRand), size: 1 },
            aAlpha: { values: new Float32Array(cityAlpha), size: 1 }
          }, softTex);
          if (!cityBase) return null;
          cityBase.uMirror = gl.getUniformLocation(cityBase.prog, 'uMirror');
          cityBase.uAlphaMul = gl.getUniformLocation(cityBase.prog, 'uAlphaMul');

          /* Rising motes: 220 points drifting up the column volume. */
          var moteS = [], moteRand = [];
          for (var mi = 0; mi < 220; mi++) { moteS.push(Math.random()); moteRand.push(Math.random()); }
          var motes = makeSystem(moteVs, {
            aS: { values: new Float32Array(moteS), size: 1 },
            aRand: { values: new Float32Array(moteRand), size: 1 }
          }, softTex);
          if (!motes) return null;

          /* Sparkle glints: ~90 flash points riding the helix. */
          var glintS = [], glintIdx = [], glintRand = [], glintSize = [];
          for (var gi = 0; gi < 90; gi++) {
            var gRand = Math.random();
            glintS.push(Math.random());
            glintIdx.push(Math.floor(gRand * 2.999));
            glintRand.push(gRand);
            glintSize.push(0.10 + Math.random() * 0.12);
          }
          var glints = makeSystem(glintVs, {
            aS: { values: new Float32Array(glintS), size: 1 },
            aStrand: { values: new Float32Array(glintIdx), size: 1 },
            aRand: { values: new Float32Array(glintRand), size: 1 },
            aSize: { values: new Float32Array(glintSize), size: 1 }
          }, sparkleTex);
          if (!glints) return null;

          /* Starfield: ~420 static stars on a far plane behind the
             column, sparkle sprites under the gentle cloud flicker, so
             the sky itself twinkles in front of the plates' painted
             stars. Drawn first of all the systems (additive blending). */
          var starPos = [], starSize = [], starColor = [], starRand = [], starAlpha = [];
          for (var fi = 0; fi < 420; fi++) {
            starPos.push(-7.5 + Math.random() * 15, -4.5 + Math.random() * 9, -9);
            starSize.push(0.02 + Math.random() * 0.04);
            var fPick = Math.random();
            if (fPick < 0.45) starColor.push(0.85, 0.93, 1.0);
            else if (fPick < 0.8) starColor.push(0.55, 0.75, 1.0);
            else starColor.push(1.0, 1.0, 1.0);
            starRand.push(Math.random());
            starAlpha.push(0.35 + Math.random() * 0.5);
          }
          var starfield = makeSystem(cloudVs, {
            aPos: { values: new Float32Array(starPos), size: 3 },
            aSize: { values: new Float32Array(starSize), size: 1 },
            aColor: { values: new Float32Array(starColor), size: 3 },
            aRand: { values: new Float32Array(starRand), size: 1 },
            aAlpha: { values: new Float32Array(starAlpha), size: 1 }
          }, sparkleTex);
          if (!starfield) return null;

          /* ---- Volumetric bodies: real geometry over the point cloud ----
             Each element builds independently below; if any one shader
             fails, its variable stays null and drawAll skips just that
             element. All mesh shaders share one varying set (vColor,
             vAlpha, vNorm, vView, vAux, vDist) and the same manual depth
             haze as the point shaders, so distant geometry melts into
             the black. Depth test stays OFF; draw order is the depth. */

          /* Helical light tubes: fresnel body shading in the fragment
             pass — bright where the surface faces the camera, falling
             away at the silhouette, like a holographic tube of light. */
          var tubeVs = [
            'attribute vec3 aPos;',
            'attribute vec3 aNormal;',
            'attribute float aS;',
            'uniform mat4 uProj;',
            'uniform mat4 uView;',
            'uniform float uPhase;',
            'uniform float uBreath;',
            'uniform float uEnv;',
            'uniform vec2 uCourse;',
            'varying vec3 vColor;',
            'varying float vAlpha;',
            'varying vec3 vNorm;',
            'varying vec3 vView;',
            'varying float vAux;',
            'varying float vDist;',
            'void main(){',
            '  float ca = cos(uPhase);',
            '  float sa = sin(uPhase);',
            '  vec3 pos = vec3(ca * aPos.x - sa * aPos.z, aPos.y, sa * aPos.x + ca * aPos.z);',
            '  vec3 nrm = vec3(ca * aNormal.x - sa * aNormal.z, aNormal.y, sa * aNormal.x + ca * aNormal.z);',
            '  vec4 mv = uView * vec4(pos, 1.0);',
            '  gl_Position = uProj * mv;',
            '  vNorm = mat3(uView) * nrm;',
            '  vView = -mv.xyz;',
            '  vDist = -mv.z;',
            '  vec3 top = vec3(0.38, 0.93, 1.0);',
            '  vec3 mid = vec3(0.18, 0.49, 0.96);',
            '  vec3 bot = vec3(0.80, 0.92, 1.0);',
            '  vec3 base = aS < 0.5 ? mix(top, mid, aS * 2.0) : mix(mid, bot, (aS - 0.5) * 2.0);',
            '  float cdx = (aS - uCourse.x) * 6.0;',
            '  float cdy = (aS - uCourse.y) * 6.0;',
            '  float cg = exp(-cdx * cdx) * 1.6 + exp(-cdy * cdy) * 1.2;',
            '  vColor = mix(base, vec3(1.0), min(0.6, cg * 0.45));',
            '  vAux = cg;',
            '  vAlpha = uBreath * (0.75 + cg * (0.5 + uEnv));',
            '}'
          ].join('\n');
          var tubeFs = [
            'precision mediump float;',
            'varying vec3 vColor;',
            'varying float vAlpha;',
            'varying vec3 vNorm;',
            'varying vec3 vView;',
            'varying float vAux;',
            'varying float vDist;',
            'void main(){',
            '  float fr = abs(dot(normalize(vNorm), normalize(vView)));',
            '  float body = 0.14 + 0.95 * pow(fr, 1.5);',
            '  float haze = exp(-max(0.0, vDist - 6.0) * 0.05);',
            '  gl_FragColor = vec4(vColor * (0.72 + 0.45 * fr), vAlpha * body * haze);',
            '}'
          ].join('\n');

          /* Glass core: a barely-there cylinder the tubes wrap around —
             fresnel rim alpha plus a faint vertical gradient. */
          var glassVs = [
            'attribute vec3 aPos;',
            'attribute vec3 aNormal;',
            'uniform mat4 uProj;',
            'uniform mat4 uView;',
            'varying vec3 vColor;',
            'varying float vAlpha;',
            'varying vec3 vNorm;',
            'varying vec3 vView;',
            'varying float vAux;',
            'varying float vDist;',
            'void main(){',
            '  vec4 mv = uView * vec4(aPos, 1.0);',
            '  gl_Position = uProj * mv;',
            '  vNorm = mat3(uView) * aNormal;',
            '  vView = -mv.xyz;',
            '  vDist = -mv.z;',
            '  vAux = clamp((aPos.y + 2.3) / 4.65, 0.0, 1.0);',
            '  vColor = vec3(0.45, 0.72, 1.0);',
            '  vAlpha = 1.0;',
            '}'
          ].join('\n');
          var glassFs = [
            'precision mediump float;',
            'varying vec3 vColor;',
            'varying float vAlpha;',
            'varying vec3 vNorm;',
            'varying vec3 vView;',
            'varying float vAux;',
            'varying float vDist;',
            'void main(){',
            '  float fr = abs(dot(normalize(vNorm), normalize(vView)));',
            '  float a = pow(1.0 - fr, 2.5) * 0.32 + vAux * 0.045 + 0.010;',
            '  float haze = exp(-max(0.0, vDist - 6.0) * 0.05);',
            '  gl_FragColor = vec4(vColor, a * haze);',
            '}'
          ].join('\n');

          /* Light shafts: open cones whose alpha dies along their height
             and at their silhouette edges, flickering per cone, swelling
             with the heartbeat envelope (uEnv). */
          var shaftVs = [
            'attribute vec3 aPos;',
            'attribute vec3 aNormal;',
            'attribute float aH;',
            'attribute float aPhase;',
            'uniform mat4 uProj;',
            'uniform mat4 uView;',
            'uniform float uTime;',
            'varying vec3 vColor;',
            'varying float vAlpha;',
            'varying vec3 vNorm;',
            'varying vec3 vView;',
            'varying float vAux;',
            'varying float vDist;',
            'void main(){',
            '  vec4 mv = uView * vec4(aPos, 1.0);',
            '  gl_Position = uProj * mv;',
            '  vNorm = mat3(uView) * aNormal;',
            '  vView = -mv.xyz;',
            '  vDist = -mv.z;',
            '  vAux = aH;',
            '  float flick = 0.72 + 0.28 * sin(uTime * (1.1 + aPhase * 1.7) + aPhase * 47.0);',
            '  vAlpha = flick;',
            '  vColor = mix(vec3(0.35, 0.62, 1.0), vec3(0.78, 0.90, 1.0), aH * 0.35);',
            '}'
          ].join('\n');
          var shaftFs = [
            'precision mediump float;',
            'uniform float uEnv;',
            'varying vec3 vColor;',
            'varying float vAlpha;',
            'varying vec3 vNorm;',
            'varying vec3 vView;',
            'varying float vAux;',
            'varying float vDist;',
            'void main(){',
            '  float fr = abs(dot(normalize(vNorm), normalize(vView)));',
            '  float hf = pow(1.0 - vAux, 1.6);',
            '  float haze = exp(-max(0.0, vDist - 6.0) * 0.05);',
            '  float a = hf * pow(fr, 1.2) * 0.20 * vAlpha * (0.65 + 0.65 * uEnv) * haze;',
            '  gl_FragColor = vec4(vColor, a);',
            '}'
          ].join('\n');

          /* Reflective ground: near-black glossy disc — a soft pool of
             blue glow under the column, a fresnel sheen at grazing
             angles, fading to pure black at the rim. */
          var groundVs = [
            'attribute vec3 aPos;',
            'uniform mat4 uProj;',
            'uniform mat4 uView;',
            'varying vec3 vColor;',
            'varying float vAlpha;',
            'varying vec3 vNorm;',
            'varying vec3 vView;',
            'varying float vAux;',
            'varying float vDist;',
            'void main(){',
            '  vec4 mv = uView * vec4(aPos, 1.0);',
            '  gl_Position = uProj * mv;',
            '  vNorm = mat3(uView) * vec3(0.0, 1.0, 0.0);',
            '  vView = -mv.xyz;',
            '  vDist = -mv.z;',
            '  vAux = length(aPos.xz) / 3.6;',
            '  vColor = vec3(0.0);',
            '  vAlpha = 1.0;',
            '}'
          ].join('\n');
          var groundFs = [
            'precision mediump float;',
            'uniform float uBreath;',
            'varying vec3 vNorm;',
            'varying vec3 vView;',
            'varying float vAux;',
            'varying float vDist;',
            'void main(){',
            '  float r = vAux;',
            '  float pool = exp(-r * r * 5.0) * (0.30 + 0.30 * uBreath);',
            '  vec3 col = vec3(0.10, 0.28, 0.62) * pool;',
            '  float fr = abs(dot(normalize(vNorm), normalize(vView)));',
            '  float sheen = pow(1.0 - fr, 3.0) * 0.30 * (1.0 - r * 0.45);',
            '  col += vec3(0.22, 0.42, 0.72) * sheen;',
            '  float rim = 1.0 - smoothstep(0.55, 1.0, r);',
            '  float haze = exp(-max(0.0, vDist - 6.0) * 0.05);',
            '  gl_FragColor = vec4(col, rim * haze);',
            '}'
          ].join('\n');

          /* Nebula dust: the cloud point shader with a very slow orbital
             drift baked into the vertex stage, so the whole shell creeps
             around the column while each mote flickers on its own. */
          var dustVs = [
            'attribute vec3 aPos;',
            'attribute float aSize;',
            'attribute vec3 aColor;',
            'attribute float aRand;',
            'attribute float aAlpha;',
            'uniform mat4 uProj;',
            'uniform mat4 uView;',
            'uniform float uTime;',
            'uniform float uPointScale;',
            'uniform float uBreath;',
            'varying vec3 vColor;',
            'varying float vAlpha;',
            'void main(){',
            '  float rot = uTime * 0.006;',
            '  float ca = cos(rot);',
            '  float sa = sin(rot);',
            '  vec3 pos = vec3(ca * aPos.x - sa * aPos.z, aPos.y, sa * aPos.x + ca * aPos.z);',
            '  vec4 mv = uView * vec4(pos, 1.0);',
            '  gl_Position = uProj * mv;',
            '  float flick = 0.72 + 0.28 * sin(uTime * (1.2 + aRand * 2.6) + aRand * 43.7);',
            '  gl_PointSize = aSize * uPointScale / max(1.0, -mv.z);',
            '  float hazeF = exp(-max(0.0, -mv.z - 6.0) * 0.05);',
            '  vColor = aColor;',
            '  vAlpha = flick * aAlpha * uBreath * hazeF;',
            '}'
          ].join('\n');

          /* Tube geometry: two triangle tubes swept along the exact
             strand helix (240 length steps x 10 radial), radius ~0.085
             tapering toward both ends. The phase rotation happens in
             the vertex shader, so the tubes stay registered with the
             point strands at every scroll position. */
          var tubes = null;
          (function buildTubes() {
            var SEG = 240, RAD = 10;
            var pos = [], nrm = [], ss = [];
            function centerAt(s, off) {
              var ang = s * Math.PI * 7 + off;
              var radius = 0.55 * (0.75 + 0.25 * Math.sin(s * Math.PI));
              return [Math.cos(ang) * radius, (0.5 - s) * 4.4, Math.sin(ang) * radius];
            }
            function vertAt(s, off, theta) {
              var c = centerAt(s, off);
              var cA = centerAt(Math.max(0, s - 0.004), off);
              var cB = centerAt(Math.min(1, s + 0.004), off);
              var tx = cB[0] - cA[0], ty = cB[1] - cA[1], tz = cB[2] - cA[2];
              var tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1; tx /= tl; ty /= tl; tz /= tl;
              var n1x = tz, n1z = -tx;
              var n1l = Math.sqrt(n1x * n1x + n1z * n1z) || 1; n1x /= n1l; n1z /= n1l;
              var n2x = ty * n1z, n2y = tz * n1x - tx * n1z, n2z = -ty * n1x;
              var taper = 0.45 + 0.55 * Math.pow(Math.sin(Math.PI * s), 0.6);
              var tr = 0.085 * taper;
              var co = Math.cos(theta), si = Math.sin(theta);
              var nx = co * n1x + si * n2x, ny = si * n2y, nz = co * n1z + si * n2z;
              return { p: [c[0] + nx * tr, c[1] + ny * tr, c[2] + nz * tr], n: [nx, ny, nz], s: s };
            }
            function emit(v) {
              pos.push(v.p[0], v.p[1], v.p[2]);
              nrm.push(v.n[0], v.n[1], v.n[2]);
              ss.push(v.s);
            }
            for (var stI = 0; stI < 2; stI++) {
              var off = stI * 2.094;
              var grid = [];
              for (var i = 0; i <= SEG; i++) {
                var row = [];
                for (var j = 0; j <= RAD; j++) row.push(vertAt(i / SEG, off, (j / RAD) * Math.PI * 2));
                grid.push(row);
              }
              for (var q = 0; q < SEG; q++) {
                for (var r = 0; r < RAD; r++) {
                  emit(grid[q][r]); emit(grid[q + 1][r]); emit(grid[q + 1][r + 1]);
                  emit(grid[q][r]); emit(grid[q + 1][r + 1]); emit(grid[q][r + 1]);
                }
              }
            }
            tubes = makeMesh(tubeVs, tubeFs, {
              aPos: { values: new Float32Array(pos), size: 3 },
              aNormal: { values: new Float32Array(nrm), size: 3 },
              aS: { values: new Float32Array(ss), size: 1 }
            }, gl.TRIANGLES);
          })();

          /* Glass core geometry: one open cylinder, 48 segments. */
          var glassCore = null;
          (function buildGlass() {
            var SEG = 48, R = 0.34, Y0 = -2.3, Y1 = 2.35;
            var pos = [], nrm = [];
            function emit(x, y, z, a) {
              pos.push(x, y, z);
              nrm.push(Math.cos(a), 0, Math.sin(a));
            }
            for (var i = 0; i < SEG; i++) {
              var a0 = (i / SEG) * Math.PI * 2, a1 = ((i + 1) / SEG) * Math.PI * 2;
              emit(Math.cos(a0) * R, Y0, Math.sin(a0) * R, a0);
              emit(Math.cos(a1) * R, Y0, Math.sin(a1) * R, a1);
              emit(Math.cos(a1) * R, Y1, Math.sin(a1) * R, a1);
              emit(Math.cos(a0) * R, Y0, Math.sin(a0) * R, a0);
              emit(Math.cos(a1) * R, Y1, Math.sin(a1) * R, a1);
              emit(Math.cos(a0) * R, Y1, Math.sin(a0) * R, a0);
            }
            glassCore = makeMesh(glassVs, glassFs, {
              aPos: { values: new Float32Array(pos), size: 3 },
              aNormal: { values: new Float32Array(nrm), size: 3 }
            }, gl.TRIANGLES);
          })();

          /* Shaft geometry: 7 seeded cones rising from the city base
             plus one hero beam from the crown star, merged into a
             single buffer so the whole set draws in one call. */
          var shafts = null;
          (function buildShafts() {
            var pos = [], nrm = [], hh = [], ph = [];
            var seed = 987654321;
            function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
            function emit(px, py, pz, nx, ny, nz, h, phase) {
              pos.push(px, py, pz);
              nrm.push(nx, ny, nz);
              hh.push(h);
              ph.push(phase);
            }
            function cone(cx, cy, cz, height, rBase, phase) {
              var SEG = 10;
              var rows = [[], []];
              for (var j = 0; j <= SEG; j++) {
                var a = (j / SEG) * Math.PI * 2;
                var ca = Math.cos(a), sa = Math.sin(a);
                rows[0].push([cx + ca * rBase, cy, cz + sa * rBase, ca, 0.18, sa, 0]);
                rows[1].push([cx + ca * rBase * 0.12, cy + height, cz + sa * rBase * 0.12, ca, 0.18, sa, 1]);
              }
              for (var j2 = 0; j2 < SEG; j2++) {
                var b0 = rows[0][j2], b1 = rows[0][j2 + 1], t0 = rows[1][j2], t1 = rows[1][j2 + 1];
                emit(b0[0], b0[1], b0[2], b0[3], b0[4], b0[5], b0[6], phase);
                emit(t0[0], t0[1], t0[2], t0[3], t0[4], t0[5], t0[6], phase);
                emit(t1[0], t1[1], t1[2], t1[3], t1[4], t1[5], t1[6], phase);
                emit(b0[0], b0[1], b0[2], b0[3], b0[4], b0[5], b0[6], phase);
                emit(t1[0], t1[1], t1[2], t1[3], t1[4], t1[5], t1[6], phase);
                emit(b1[0], b1[1], b1[2], b1[3], b1[4], b1[5], b1[6], phase);
              }
            }
            for (var k = 0; k < 7; k++) {
              var ang = rnd() * Math.PI * 2;
              var rad = Math.sqrt(rnd()) * 1.6;
              cone(Math.cos(ang) * rad, -2.3, Math.sin(ang) * rad, 1.8 + rnd() * 1.8, 0.10 + rnd() * 0.10, rnd());
            }
            cone(0, 2.32, 0, 3.2, 0.20, rnd());
            shafts = makeMesh(shaftVs, shaftFs, {
              aPos: { values: new Float32Array(pos), size: 3 },
              aNormal: { values: new Float32Array(nrm), size: 3 },
              aH: { values: new Float32Array(hh), size: 1 },
              aPhase: { values: new Float32Array(ph), size: 1 }
            }, gl.TRIANGLES);
          })();

          /* Ground geometry: a 64-segment triangle fan, radius 3.6. */
          var ground = null;
          (function buildGround() {
            var SEG = 64, R = 3.6, Y = -2.34;
            var pos = [];
            for (var i = 0; i < SEG; i++) {
              var a0 = (i / SEG) * Math.PI * 2, a1 = ((i + 1) / SEG) * Math.PI * 2;
              pos.push(0, Y, 0);
              pos.push(Math.cos(a0) * R, Y, Math.sin(a0) * R);
              pos.push(Math.cos(a1) * R, Y, Math.sin(a1) * R);
            }
            ground = makeMesh(groundVs, groundFs, {
              aPos: { values: new Float32Array(pos), size: 3 }
            }, gl.TRIANGLES);
          })();

          /* Nebula dust field: ~1500 motes in a spherical shell
             (radius 3.5–13) around the column, faint blue-white. */
          var dustPos = [], dustSize = [], dustColor = [], dustRand = [], dustAlpha = [];
          for (var di = 0; di < 1500; di++) {
            var du = Math.random() * 2 - 1;
            var dth = Math.random() * Math.PI * 2;
            var dsq = Math.sqrt(1 - du * du);
            var dr = 3.5 + Math.random() * 9.5;
            dustPos.push(dsq * Math.cos(dth) * dr, du * dr, dsq * Math.sin(dth) * dr);
            dustSize.push(0.03 + Math.random() * 0.07);
            var dPick = Math.random();
            if (dPick < 0.5) dustColor.push(0.55, 0.72, 1.0);
            else if (dPick < 0.8) dustColor.push(0.82, 0.90, 1.0);
            else dustColor.push(0.38, 0.55, 0.95);
            dustRand.push(Math.random());
            dustAlpha.push(0.05 + Math.random() * 0.17);
          }
          var dust = makeSystem(dustVs, {
            aPos: { values: new Float32Array(dustPos), size: 3 },
            aSize: { values: new Float32Array(dustSize), size: 1 },
            aColor: { values: new Float32Array(dustColor), size: 3 },
            aRand: { values: new Float32Array(dustRand), size: 1 },
            aAlpha: { values: new Float32Array(dustAlpha), size: 1 }
          }, softTex);

          /* ---- Bloom pipeline (WebGL1, UNSIGNED_BYTE targets) ----
             Scene renders into an FBO; a separable 9-tap gaussian runs
             over two quarter-resolution targets (two iterations); a
             composite pass adds scene + bloom * uBloomStrength (driven by
             the heartbeat) to the screen. If
             any target fails FRAMEBUFFER_COMPLETE, bloomOK stays false
             and rendering falls back to the direct-to-screen path. */
          var postVs = [
            'attribute vec2 aPos;',
            'varying vec2 vUv;',
            'void main(){',
            '  vUv = aPos * 0.5 + 0.5;',
            '  gl_Position = vec4(aPos, 0.0, 1.0);',
            '}'
          ].join('\n');
          var blurFs = [
            'precision mediump float;',
            'uniform sampler2D uTex;',
            'uniform vec2 uDir;',
            'varying vec2 vUv;',
            'void main(){',
            '  vec4 c = texture2D(uTex, vUv) * 0.227027;',
            '  c += texture2D(uTex, vUv + uDir * 1.0) * 0.1945946;',
            '  c += texture2D(uTex, vUv - uDir * 1.0) * 0.1945946;',
            '  c += texture2D(uTex, vUv + uDir * 2.0) * 0.1216216;',
            '  c += texture2D(uTex, vUv - uDir * 2.0) * 0.1216216;',
            '  c += texture2D(uTex, vUv + uDir * 3.0) * 0.054054;',
            '  c += texture2D(uTex, vUv - uDir * 3.0) * 0.054054;',
            '  c += texture2D(uTex, vUv + uDir * 4.0) * 0.016216;',
            '  c += texture2D(uTex, vUv - uDir * 4.0) * 0.016216;',
            '  gl_FragColor = c;',
            '}'
          ].join('\n');
          /* Composite grade (bloom path only): chromatic aberration
             (radial R/B split), a vignette, and animated film grain over
             the scene + bloom add. */
          var compFs = [
            'precision mediump float;',
            'uniform sampler2D uScene;',
            'uniform sampler2D uBloom;',
            'uniform float uBloomStrength;',
            'uniform float uTime;',
            'uniform vec2 uRes;',
            'varying vec2 vUv;',
            'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
            'void main(){',
            '  vec2 off = (vUv - 0.5) * 0.0035;',
            '  vec3 col;',
            '  col.r = texture2D(uScene, vUv + off).r;',
            '  col.g = texture2D(uScene, vUv).g;',
            '  col.b = texture2D(uScene, vUv - off).b;',
            '  float alpha = texture2D(uScene, vUv).a;',
            '  col += texture2D(uBloom, vUv).rgb * uBloomStrength;',
            '  col *= 1.0 - 0.34 * smoothstep(0.55, 1.3, length((vUv - 0.5) * vec2(1.25, 1.0)) * 1.4);',
            '  col += (hash(vUv * uRes + fract(uTime) * 371.0) - 0.5) * 0.05;',
            '  gl_FragColor = vec4(col, alpha);',
            '}'
          ].join('\n');
          var blurProg = buildProgram(postVs, blurFs);
          var compProg = buildProgram(postVs, compFs);
          var blurAPos = blurProg ? gl.getAttribLocation(blurProg, 'aPos') : -1;
          var blurUTex = blurProg ? gl.getUniformLocation(blurProg, 'uTex') : null;
          var blurUDir = blurProg ? gl.getUniformLocation(blurProg, 'uDir') : null;
          var compAPos = compProg ? gl.getAttribLocation(compProg, 'aPos') : -1;
          var compUScene = compProg ? gl.getUniformLocation(compProg, 'uScene') : null;
          var compUBloom = compProg ? gl.getUniformLocation(compProg, 'uBloom') : null;
          var compUBloomStrength = compProg ? gl.getUniformLocation(compProg, 'uBloomStrength') : null;
          var compUTime = compProg ? gl.getUniformLocation(compProg, 'uTime') : null;
          var compURes = compProg ? gl.getUniformLocation(compProg, 'uRes') : null;
          var quadBuf = gl.createBuffer();
          gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

          function createTarget(w, h) {
            var tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            var fb = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
            var ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            if (!ok) { gl.deleteFramebuffer(fb); gl.deleteTexture(tex); return null; }
            return { fb: fb, tex: tex, w: w, h: h };
          }
          function deleteTarget(t) {
            if (!t) return;
            gl.deleteFramebuffer(t.fb);
            gl.deleteTexture(t.tex);
          }
          var sceneT = null, blurA = null, blurB = null, bloomOK = false;
          function buildTargets(w, h) {
            deleteTarget(sceneT); deleteTarget(blurA); deleteTarget(blurB);
            sceneT = null; blurA = null; blurB = null; bloomOK = false;
            if (!blurProg || !compProg) return;
            var qw = Math.max(1, w >> 2), qh = Math.max(1, h >> 2);
            sceneT = createTarget(w, h);
            blurA = createTarget(qw, qh);
            blurB = createTarget(qw, qh);
            if (sceneT && blurA && blurB) { bloomOK = true; return; }
            deleteTarget(sceneT); deleteTarget(blurA); deleteTarget(blurB);
            sceneT = null; blurA = null; blurB = null;
          }
          function drawQuad(posLoc) {
            gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
            gl.enableVertexAttribArray(posLoc);
            gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            gl.disableVertexAttribArray(posLoc);
          }
          function blurPass(srcTex, dst, dirX, dirY, srcW, srcH) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
            gl.viewport(0, 0, dst.w, dst.h);
            gl.useProgram(blurProg);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, srcTex);
            gl.uniform1i(blurUTex, 0);
            gl.uniform2f(blurUDir, dirX / srcW, dirY / srcH);
            drawQuad(blurAPos);
          }

          gl.disable(gl.DEPTH_TEST);
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

          var lost = false;
          glCanvas.addEventListener('webglcontextlost', function (event) {
            event.preventDefault();
            lost = true;
            document.documentElement.classList.remove('spine-on');
          });

          function perspective(fovY, aspect, near, far) {
            var f = 1 / Math.tan(fovY / 2);
            var nf = 1 / (near - far);
            return new Float32Array([
              f / aspect, 0, 0, 0,
              0, f, 0, 0,
              0, 0, (far + near) * nf, -1,
              0, 0, 2 * far * near * nf, 0
            ]);
          }
          function lookAt(eye, center) {
            var zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
            var zl = Math.sqrt(zx * zx + zy * zy + zz * zz) || 1; zx /= zl; zy /= zl; zz /= zl;
            var xx = zz, xy = 0, xz = -zx; /* cross(up=(0,1,0), z) */
            var xl = Math.sqrt(xx * xx + xy * xy + xz * xz) || 1; xx /= xl; xy /= xl; xz /= xl;
            var yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
            return new Float32Array([
              xx, xy, xz, 0,
              yx, yy, yz, 0,
              zx, zy, zz, 0,
              -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
              -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
              -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
              1
            ]);
          }

          /* Quality governor: EMA of frame delta drives four tiers —
             0: DPR up to 2 + bloom; 1: DPR 1.5 + bloom; 2: DPR 1.25 +
             bloom, mirrored city skipped; 3: DPR 1, no bloom, halo
             layer skipped, dust/shafts/glass/mirror skipped. Steps down
             after ~90 sustained slow frames, back up only after ~600
             fast frames, at most one change per 1.5s. */
          var DPR_TIERS = [2, 1.5, 1.25, 1];
          var tier = 0;
          var govEma = 16.7, govSlow = 0, govFast = 0, govLastNow = 0, govLastChange = 0;
          var curW = 0, curH = 0;

          function resize() {
            var dpr = Math.min(window.devicePixelRatio || 1, DPR_TIERS[tier]);
            var w = Math.max(1, Math.floor(window.innerWidth * dpr));
            var h = Math.max(1, Math.floor(window.innerHeight * dpr));
            if (w === curW && h === curH) { gl.viewport(0, 0, w, h); return; }
            curW = w; curH = h;
            glCanvas.width = w;
            glCanvas.height = h;
            gl.viewport(0, 0, w, h);
            buildTargets(w, h);
          }
          function applyTier(next, now) {
            tier = next;
            govLastChange = now;
            govSlow = 0; govFast = 0;
            resize();
          }
          function governor(now) {
            if (govLastNow) {
              var dt = now - govLastNow;
              if (dt > 0 && dt <= 100) {
                govEma = govEma * 0.95 + dt * 0.05;
                if (govEma > 24) { govSlow++; govFast = 0; }
                else if (govEma < 12) { govFast++; govSlow = 0; }
                else { govSlow = 0; govFast = 0; }
                if (now - govLastChange >= 1500) {
                  if (govSlow >= 90 && tier < 3) applyTier(tier + 1, now);
                  else if (govFast >= 600 && tier > 0) applyTier(tier - 1, now);
                }
              }
            }
            govLastNow = now;
          }
          resize();

          /* Mouse parallax (fine pointers only): the target is normalized
             -0.5..0.5 across the window and exponentially smoothed in
             render, then layered on top of the scroll orbit math so the
             camera leans gently toward the cursor. */
          var mouseTX = 0, mouseTY = 0, mouseSX = 0, mouseSY = 0;
          if (window.matchMedia && window.matchMedia('(pointer:fine)').matches) {
            window.addEventListener('pointermove', function (event) {
              mouseTX = event.clientX / Math.max(1, window.innerWidth) - 0.5;
              mouseTY = event.clientY / Math.max(1, window.innerHeight) - 0.5;
            }, { passive: true });
          }

          function drawSystem(sys, proj, view, phase, time, pointScale, breath, count, env, course, mirror, alphaMul) {
            gl.useProgram(sys.prog);
            gl.uniformMatrix4fv(sys.uProj, false, proj);
            gl.uniformMatrix4fv(sys.uView, false, view);
            if (sys.uPhase) gl.uniform1f(sys.uPhase, phase);
            if (sys.uTime) gl.uniform1f(sys.uTime, time);
            if (sys.uPointScale) gl.uniform1f(sys.uPointScale, pointScale);
            if (sys.uBreath) gl.uniform1f(sys.uBreath, breath);
            if (sys.uEnv) gl.uniform1f(sys.uEnv, env);
            if (sys.uCourse) gl.uniform2f(sys.uCourse, course[0], course[1]);
            if (sys.uMirror) gl.uniform1f(sys.uMirror, mirror || 0);
            if (sys.uAlphaMul) gl.uniform1f(sys.uAlphaMul, alphaMul == null ? 1 : alphaMul);
            if (sys.uTex) gl.uniform1i(sys.uTex, 0);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, sys.tex);
            for (var i = 0; i < sys.attribs.length; i++) {
              var at = sys.attribs[i];
              gl.bindBuffer(gl.ARRAY_BUFFER, at.buf);
              gl.enableVertexAttribArray(at.loc);
              gl.vertexAttribPointer(at.loc, at.size, gl.FLOAT, false, 0, 0);
            }
            gl.drawArrays(gl.POINTS, 0, count);
            for (var j = 0; j < sys.attribs.length; j++) gl.disableVertexAttribArray(sys.attribs[j].loc);
          }
          function drawMesh(sys, proj, view, phase, time, breath, env, course) {
            gl.useProgram(sys.prog);
            gl.uniformMatrix4fv(sys.uProj, false, proj);
            gl.uniformMatrix4fv(sys.uView, false, view);
            if (sys.uPhase) gl.uniform1f(sys.uPhase, phase);
            if (sys.uTime) gl.uniform1f(sys.uTime, time);
            if (sys.uBreath) gl.uniform1f(sys.uBreath, breath);
            if (sys.uEnv) gl.uniform1f(sys.uEnv, env);
            if (sys.uCourse) gl.uniform2f(sys.uCourse, course[0], course[1]);
            for (var i = 0; i < sys.attribs.length; i++) {
              var at = sys.attribs[i];
              gl.bindBuffer(gl.ARRAY_BUFFER, at.buf);
              gl.enableVertexAttribArray(at.loc);
              gl.vertexAttribPointer(at.loc, at.size, gl.FLOAT, false, 0, 0);
            }
            gl.drawArrays(sys.mode, 0, sys.count);
            for (var j = 0; j < sys.attribs.length; j++) gl.disableVertexAttribArray(sys.attribs[j].loc);
          }
          function drawAll(proj, view, phase, time, pointScale, breath, env, course) {
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
            /* Draw order is the depth cue (depth test stays off): far
               dust and the ground first, the mirrored city under the
               glass, then the volumetric bodies, and the bright point
               systems last so they sit on top of everything. The
               governor sheds the expensive layers by tier: tier 2 drops
               the mirrored city, tier 3 also drops dust, shafts and the
               glass core — points and tubes always remain. */
            if (tier < 3 && dust) drawSystem(dust, proj, view, phase, time, pointScale, breath, dust.count, env, course);
            if (ground) drawMesh(ground, proj, view, phase, time, breath, env, course);
            if (tier < 2) drawSystem(cityBase, proj, view, phase, time, pointScale, breath, cityBase.count, env, course, 1, 0.32);
            if (tier < 3 && glassCore) drawMesh(glassCore, proj, view, phase, time, breath, env, course);
            if (tubes) drawMesh(tubes, proj, view, phase, time, breath, env, course);
            if (tier < 3 && shafts) drawMesh(shafts, proj, view, phase, time, breath, env, course);
            drawSystem(starfield, proj, view, phase, time, pointScale, breath, starfield.count, env, course);
            drawSystem(strands, proj, view, phase, time, pointScale, breath, tier >= 3 ? strands.haloStart : strands.count, env, course);
            drawSystem(crown, proj, view, phase, time, pointScale, breath, crown.count, env, course);
            drawSystem(cityBase, proj, view, phase, time, pointScale, breath, cityBase.count, env, course);
            drawSystem(motes, proj, view, phase, time, pointScale, breath, motes.count, env, course);
            drawSystem(glints, proj, view, phase, time, pointScale, breath, glints.count, env, course);
          }

          /* Heartbeat: a lub-dub envelope with an irregular rhythm. Each
             cycle (0.82s–1.18s, re-randomized per beat) opens with a
             strong thump (amplitude 1.0, ~90ms decay) and a softer second
             thump 24% in (amplitude .55, ~70ms decay), over a quiet
             baseline of .12 plus a very slow faint breathing sine. The
             envelope drives uBreath for every point system and the bloom
             composite strength, so the whole core visibly beats. Each
             strong thump also launches a coursing pulse down the strands;
             two pulses run staggered on their own randomized schedules
             (2.2s–3.4s crown -> city), idling parked off-strand between
             runs. */
          var hbStart = 0, hbCycle = 1000, hbFired = true;
          var coursePulses = [
            { active: false, start: 0, dur: 2800, idleUntil: -1 },
            { active: false, start: 0, dur: 2800, idleUntil: -1 }
          ];
          var courseInit = false;
          function startCourse(i, nowMs) {
            var p = coursePulses[i];
            p.active = true;
            p.start = nowMs;
            p.dur = 2200 + Math.random() * 1200;
          }
          function launchCourse(nowMs) {
            for (var i = 0; i < coursePulses.length; i++) {
              if (!coursePulses[i].active) { startCourse(i, nowMs); return; }
            }
          }
          function heartbeat(nowMs) {
            if (!hbStart) { hbStart = nowMs; hbCycle = 820 + Math.random() * 360; hbFired = false; }
            var el = nowMs - hbStart;
            if (el >= hbCycle) {
              hbStart += hbCycle;
              hbCycle = 820 + Math.random() * 360;
              el = nowMs - hbStart;
              hbFired = false;
              if (el >= hbCycle) { hbStart = nowMs; el = 0; } /* slept tab: resync */
            }
            var env = 0.12 + 0.03 * Math.sin(nowMs * 0.001 * 0.5);
            env += Math.exp(-el / 90);
            var el2 = el - hbCycle * 0.24;
            if (el2 > 0) env += 0.55 * Math.exp(-el2 / 70);
            if (!hbFired && el < 120) { hbFired = true; launchCourse(nowMs); }
            return env;
          }
          function coursePositions(nowMs) {
            if (!courseInit) {
              courseInit = true;
              coursePulses[0].idleUntil = nowMs + 250;
              coursePulses[1].idleUntil = nowMs + 1650;
            }
            var out = [-1, -1];
            for (var i = 0; i < coursePulses.length; i++) {
              var p = coursePulses[i];
              if (p.active) {
                var t = (nowMs - p.start) / p.dur;
                if (t >= 1) { p.active = false; p.idleUntil = nowMs + 300 + Math.random() * 700; }
                else out[i] = t;
              } else if (p.idleUntil >= 0 && nowMs >= p.idleUntil) {
                startCourse(i, nowMs);
                out[i] = 0;
              }
            }
            return out;
          }

          /* Camera orbits and descends in sync with the scroll position:
             it opens looking up at the star crown and ends looking down
             into the city base, while uPhase rotates the strands at the
             same 1.83 rate as the panels and the 2D helical ribbon. */
          function render(display, now) {
            if (lost) return;
            governor(now);
            var total = fallbackPanels.length - 1;
            var cp = total > 0 ? Math.max(0, Math.min(1, display / total)) : 0;
            var ang = cp * 0.9;
            var camRadius = 6.4;
            var eye = [Math.sin(ang) * camRadius, 2.6 + (-1.9 - 2.6) * cp, Math.cos(ang) * camRadius];
            var lookY = 1.5 + (-1.2 - 1.5) * cp;
            mouseSX += (mouseTX - mouseSX) * 0.05;
            mouseSY += (mouseTY - mouseSY) * 0.05;
            eye[0] += mouseSX * 0.45;
            eye[1] += -mouseSY * 0.28;
            var aspect = glCanvas.width / Math.max(1, glCanvas.height);
            var proj = perspective(42 * Math.PI / 180, aspect, 0.1, 60);
            var view = lookAt(eye, [mouseSX * 0.35, lookY, 0]);
            var phase = display * 1.83;
            var time = now * 0.001;
            var pointScale = glCanvas.height / (2 * Math.tan(21 * Math.PI / 180));
            var envelope = heartbeat(now);
            var course = coursePositions(now);
            var breath = 0.45 + 0.75 * envelope;
            var bloomFactor = 0.8 + 0.9 * envelope;
            var useBloom = bloomOK && tier < 3;
            /* Direct path has no composite pass, so the heartbeat's bloom
               swing is folded into breath instead — the thump still reads. */
            var drawBreath = useBloom ? breath : breath * bloomFactor;
            if (useBloom) {
              gl.bindFramebuffer(gl.FRAMEBUFFER, sceneT.fb);
              gl.viewport(0, 0, sceneT.w, sceneT.h);
              gl.clearColor(0, 0, 0, 0);
              gl.clear(gl.COLOR_BUFFER_BIT);
              drawAll(proj, view, phase, time, pointScale, drawBreath, envelope, course);
              gl.disable(gl.BLEND);
              blurPass(sceneT.tex, blurA, 1, 0, sceneT.w, sceneT.h);
              blurPass(blurA.tex, blurB, 0, 1, blurA.w, blurA.h);
              blurPass(blurB.tex, blurA, 1, 0, blurB.w, blurB.h);
              blurPass(blurA.tex, blurB, 0, 1, blurA.w, blurA.h);
              gl.bindFramebuffer(gl.FRAMEBUFFER, null);
              gl.viewport(0, 0, glCanvas.width, glCanvas.height);
              gl.useProgram(compProg);
              gl.activeTexture(gl.TEXTURE0);
              gl.bindTexture(gl.TEXTURE_2D, sceneT.tex);
              gl.uniform1i(compUScene, 0);
              gl.activeTexture(gl.TEXTURE1);
              gl.bindTexture(gl.TEXTURE_2D, blurB.tex);
              gl.uniform1i(compUBloom, 1);
              if (compUBloomStrength) gl.uniform1f(compUBloomStrength, bloomFactor);
              if (compUTime) gl.uniform1f(compUTime, time);
              if (compURes) gl.uniform2f(compURes, glCanvas.width, glCanvas.height);
              drawQuad(compAPos);
              gl.activeTexture(gl.TEXTURE0);
            } else {
              gl.bindFramebuffer(gl.FRAMEBUFFER, null);
              gl.viewport(0, 0, glCanvas.width, glCanvas.height);
              gl.clearColor(0, 0, 0, 0);
              gl.clear(gl.COLOR_BUFFER_BIT);
              drawAll(proj, view, phase, time, pointScale, drawBreath, envelope, course);
            }
          }

          return {
            resize: resize,
            render: render,
            isActive: function () { return !lost; }
          };
        }

        function fallbackEase(value) {
          /* Linear scroll mapping. The previous dwell-plateau ease froze the
             target for the first and last 10% of every segment, which made
             the first and last panels feel glued in place when trying to
             scroll away from them. The frame loop's time-based damping
             provides all the softness the motion needs. */
          if (value <= 0) return 0;
          if (value >= fallbackPanels.length - 1) return fallbackPanels.length - 1;
          return value;
        }
        function fallbackTargetFromScroll() {
          var distance = Math.max(1, orbitExperience.offsetHeight - window.innerHeight);
          var raw = Math.max(0, Math.min(1, (window.scrollY - orbitExperience.offsetTop) / distance));
          fallbackTarget = fallbackEase(raw * (fallbackPanels.length - 1));
        }
        function fallbackGo(index) {
          var distance = orbitExperience.offsetHeight - window.innerHeight;
          window.scrollTo({ top: orbitExperience.offsetTop + distance * index / (fallbackPanels.length - 1), behavior:'smooth' });
        }
        function fallbackResize() {
          canvas.width = Math.floor(window.innerWidth * canvasRatio);
          canvas.height = Math.floor(window.innerHeight * canvasRatio);
          canvas.style.width = window.innerWidth + 'px';
          canvas.style.height = window.innerHeight + 'px';
          ctx.setTransform(canvasRatio,0,0,canvasRatio,0,0);
          if (spine) spine.resize();
          /* Pre-render the static background gradient once per resize; the
             per-frame paint then just blits it instead of rebuilding a
             full-screen radial gradient 60 times a second. */
          fallbackBg.width = canvas.width;
          fallbackBg.height = canvas.height;
          var bgCtx = fallbackBg.getContext('2d');
          var bgGrad = bgCtx.createRadialGradient(canvas.width*.5,canvas.height*.5,0,canvas.width*.5,canvas.height*.5,Math.max(canvas.width,canvas.height)*.78);
          bgGrad.addColorStop(0,'#060606'); bgGrad.addColorStop(.28,'#010101'); bgGrad.addColorStop(1,'#000000');
          bgCtx.fillStyle = bgGrad; bgCtx.fillRect(0,0,canvas.width,canvas.height);
          fallbackStaticDrawn = false;
          fallbackTargetFromScroll();
          fallbackKick();
        }
        function fallbackArtwork(now, velocity) {
          var w = window.innerWidth, h = window.innerHeight;
          /* Blit the pre-rendered background (opaque, so it also clears). */
          ctx.save(); ctx.setTransform(1,0,0,1,0,0);
          ctx.drawImage(fallbackBg,0,0);
          ctx.restore();
          var cx=w*.5, cy=h*.5, t=now*.00034;
          var boost=Math.min(.2,Math.abs(velocity)*2);
          ctx.save(); ctx.globalCompositeOperation='lighter';
          ctx.translate(cx,cy); ctx.rotate(-Math.PI/5.2); ctx.translate(-cx,-cy);
          for(var i=0;i<6;i++){
            var offset=(i-2.5)*34;
            var alpha=.22+i*.026+boost;
            /* Glow is faked with a wide low-alpha under-stroke: canvas
               shadowBlur forces a full-surface software blur per stroke
               and was the main cause of the scroll freezing on desktop. */
            ctx.beginPath();
            ctx.moveTo(-w*.18,cy+offset+Math.sin(t+i)*18);
            ctx.bezierCurveTo(w*.2,cy-95+offset,w*.76,cy+95+offset,w*1.18,cy+Math.cos(t+i)*22+offset);
            ctx.strokeStyle='rgba('+(46+i*8)+','+(124+i*15)+',255,'+(alpha*.30*.4)+')';
            ctx.lineWidth=i===2?7.5:3.6;
            ctx.stroke();
            ctx.strokeStyle='rgba('+(46+i*8)+','+(124+i*15)+',255,'+(alpha*.4)+')';
            ctx.lineWidth=i===2?2.4:1.15;
            ctx.stroke();
          }
          ctx.restore();
          /* Helical ribbon: a candy-cane stripe winding down the stage axis,
             rotating in step with the panels' spiral position. Drawn as one
             path per brightness band instead of ~110 individually
             shadow-blurred segments. */
          ctx.save(); ctx.globalCompositeOperation='lighter';
          var helixPhase=fallbackDisplay*1.83;
          var helixR=Math.min(w,h)*.335;
          var helixSteps=84;
          var helixBoost=Math.min(.12,Math.abs(velocity)*1.4);
          for(var band=0;band<3;band++){
            ctx.beginPath();
            for(var hs=0;hs<helixSteps;hs++){
              var hp0=hs/helixSteps, hp1=(hs+1)/helixSteps;
              var ha0=hp0*Math.PI*2*2.15+helixPhase;
              var ha1=hp1*Math.PI*2*2.15+helixPhase;
              var hFront=(Math.cos(ha0)+1)/2;
              if (Math.abs(hFront-(band*.5+.25))>.30) continue;
              ctx.moveTo(cx+Math.sin(ha0)*helixR,h*.05+hp0*h*.9);
              ctx.lineTo(cx+Math.sin(ha1)*helixR,h*.05+hp1*h*.9);
            }
            ctx.strokeStyle='rgba(96,190,255,'+(.05+(band*.5+.25)*.26+helixBoost)+')';
            ctx.lineWidth=.8+(band*.5+.25)*1.7;
            ctx.stroke();
          }
          ctx.restore();
        }
        var fallbackVisible = true;
        var fallbackRunning = false;
        var fallbackLastTime = 0;
        var fallbackLastNearest = -1;
        var fallbackLastArt = 0;
        var fallbackLastScroll = 0;
        var fallbackEma = 16.7;
        var fallbackFrames = 0;
        var fallbackLowPower = false;
        var fallbackStaticDrawn = false;
        function fallbackKick() {
          if (!fallbackRunning && fallbackVisible && !document.hidden) {
            fallbackRunning = true;
            fallbackLastTime = 0;
            requestAnimationFrame(fallbackFrame);
          }
        }
        function fallbackFrame(now) {
          if (!fallbackVisible || document.hidden) { fallbackRunning = false; return; }
          /* Time-based damping: the old per-frame lerp (display += delta*.15)
             tied motion speed to frame rate, so on any machine that dropped
             frames the panels crawled slower and slower and appeared to stop.
             Damping by elapsed time keeps the pace identical at any fps. */
          var dt = fallbackLastTime ? Math.min(64, now - fallbackLastTime) : 16.7;
          fallbackLastTime = now;
          /* Adaptive safety net: if frames stay slow despite the cheap
             compositing above (very weak GPU / software rasterizer), drop
             to a static background and let the loop sleep whenever the
             panels settle, so the page can never grind to a halt. */
          fallbackEma = fallbackEma * .95 + dt * .05;
          fallbackFrames++;
          if (!fallbackLowPower && fallbackFrames > 45 && fallbackEma > 28) {
            fallbackLowPower = true;
            fallbackStaticDrawn = false;
          }
          var before = fallbackDisplay;
          var delta = fallbackTarget - fallbackDisplay;
          fallbackDisplay += delta * (1 - Math.pow(.82, dt / 16.7));
          if (Math.abs(fallbackTarget - fallbackDisplay) < .0004) fallbackDisplay = fallbackTarget;
          var settled = fallbackDisplay === fallbackTarget;
          var velocity = fallbackDisplay - before;
          fallbackRing.style.transform = 'none';
          var spineActive = !!(spine && spine.isActive());
          if (spineActive) {
            /* In low-power mode the spine only re-renders when the scroll
               position has actually moved, so a weak GPU is never ground
               down by a near-static scene. */
            if (!fallbackLowPower || Math.abs(fallbackDisplay - spineLastDisplay) > 0.001) {
              spine.render(fallbackDisplay, now);
              spineLastDisplay = fallbackDisplay;
            }
          }
          var nearest = Math.max(0,Math.min(fallbackPanels.length-1,Math.round(fallbackDisplay)));
          fallbackPanels.forEach(function(panel,index){
            var offset=index-fallbackDisplay;
            var distance=Math.abs(offset);
            /* Helical path: each panel rides a candy-cane stripe around the
               stage's central vertical axis, descending as it travels.
               offset +1.6 -> small, dim, high and behind the axis;
               offset 0    -> front-center, flat, full size, razor sharp;
               offset -1.6 -> small, dim, low, gone around the far side. */
            var theta=offset*1.83;
            var cosT=Math.cos(theta), sinT=Math.sin(theta);
            var frontness=(cosT+1)/2;
            var focus=Math.pow(Math.max(0,cosT),1.25);
            var depthDim=.3+.7*frontness;
            var distFade=Math.max(0,Math.min(1,1.2-distance*.68));
            var opacity=depthDim*distFade;
            if (opacity<=0.01) {
              if (panel._vis!=='hidden') { panel._vis='hidden'; panel.style.visibility='hidden'; }
            } else {
              if (panel._vis!=='visible') { panel._vis='visible'; panel.style.visibility='visible'; }
              var x=sinT*36;
              var y=-offset*24;
              var rotY=-theta*30;
              var rotZ=sinT*-5;
              var scale=.47+.53*focus;
              var tStr='translate3d('+x.toFixed(2)+'vw,'+y.toFixed(2)+'vh,'+((cosT-1)*90).toFixed(1)+'px) rotateY('+rotY.toFixed(2)+'deg) rotateZ('+rotZ.toFixed(2)+'deg) scale('+scale.toFixed(3)+')';
              if (panel._t!==tStr) { panel._t=tStr; panel.style.transform=tStr; }
              var oStr=opacity.toFixed(3);
              if (panel._o!==oStr) { panel._o=oStr; panel.style.opacity=oStr; }
              /* No CSS filter on panels, ever. A blur()/saturate() filter on
                 a full-viewport panel forces the browser to re-rasterize and
                 blur a screen-sized surface for every in-flight panel on
                 every frame — on machines with software rasterization (most
                 corporate Chrome/Edge installs) that is what froze the
                 panels solid once more than one was on screen. Depth is
                 carried by scale, opacity and rotation only, which the
                 compositor animates without repainting the cards. */
              var zStr=String(Math.round(10+cosT*10-distance));
              if (panel._z!==zStr) { panel._z=zStr; panel.style.zIndex=zStr; }
            }
            var active=index===nearest;
            if (panel._active!==active) {
              panel._active=active;
              panel.classList.toggle('is-active',active);
              panel.setAttribute('aria-hidden',active?'false':'true');
              panel.inert=!active;
            }
          });
          if (nearest!==fallbackLastNearest) {
            fallbackLastNearest=nearest;
            fallbackDots.forEach(function(dot,index){ dot.classList.toggle('is-active',index===nearest); if(index===nearest)dot.setAttribute('aria-current','step');else dot.removeAttribute('aria-current'); });
            fallbackCount.textContent=String(nearest+1).padStart(2,'0')+' / '+String(fallbackPanels.length).padStart(2,'0');
            fallbackTitle.textContent=fallbackPanels[nearest].getAttribute('data-title');
          }
          /* Background artwork is decorative: paint it at ~30fps, and in
             low-power mode paint one static frame and then stop paying
             for it entirely. */
          if (fallbackLowPower) {
            if (!fallbackStaticDrawn) { fallbackArtwork(now, 0); fallbackStaticDrawn = true; }
          } else if (now - fallbackLastArt >= 32 && now - fallbackLastScroll > 160) {
            fallbackArtwork(now, velocity);
            fallbackLastArt = now;
          }
          if (fallbackLowPower && settled) { fallbackRunning = false; return; }
          requestAnimationFrame(fallbackFrame);
        }
        function fallbackBindForm(form){
          if(!form)return;
          form.addEventListener('submit',function(event){
            event.preventDefault(); if(!form.reportValidity())return;
            var data=new FormData(form);
            var subject='Higher Rank Strategy Call — '+(data.get('business')||data.get('name'));
            var body=['Name: '+data.get('name'),'Email: '+data.get('email'),'Business / brand name: '+(data.get('business')||'Not provided'),'','What I am trying to accomplish:',data.get('goal'),'',"What's getting in the way:",data.get('blocker')].join('\n');
            var note=form.querySelector('[data-form-note]'); if(note)note.textContent='Your email app is opening with the message ready to review and send.';
            window.location.href='mailto:N.Young@HigherRankMedia.com?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body);
          });
        }
        fallbackBindForm(document.getElementById('orbit-strategy-form'));
        document.addEventListener('click',function(event){
          var link=event.target.closest('a[href^="#"]'); if(!link)return;
          var map={'#main':0,'#services':1,'#process':2,'#live':5,'#about':6,'#contact':7};
          var index=map[link.getAttribute('href')]; if(typeof index==='number'){event.preventDefault();fallbackGo(index);}
        });
        window.addEventListener('scroll',function(){ fallbackLastScroll = performance.now(); fallbackTargetFromScroll(); fallbackKick(); },{passive:true});
        window.addEventListener('resize',fallbackResize,{passive:true});
        document.addEventListener('visibilitychange',function(){ if (!document.hidden) fallbackKick(); });
        if ('IntersectionObserver' in window) {
          new IntersectionObserver(function(entries){
            fallbackVisible = entries[0].isIntersecting;
            if (fallbackVisible) fallbackKick();
          },{threshold:.01}).observe(orbitExperience);
        }
        spine = initSpine();
        if (spine) document.documentElement.classList.add('spine-on');
        fallbackResize(); fallbackTargetFromScroll(); fallbackKick();
        return;
      }

      var canvas = document.getElementById('orbit-canvas');
      var renderer;
      try {
        renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: false, powerPreference: 'high-performance' });
      } catch (error) { return; }

      document.documentElement.classList.add('orbit-ready');
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.setClearColor(0x020705, 1);
      renderer.outputColorSpace = THREE.SRGBColorSpace;

      var scene = new THREE.Scene();
      var camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
      camera.position.z = 2;
      var uniforms = {
        uTime: { value: 0 },
        uAspect: { value: 1 },
        uVelocity: { value: 0 }
      };
      var material = new THREE.ShaderMaterial({
        transparent: false,
        depthWrite: false,
        uniforms: uniforms,
        vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position,1.0);}',
        fragmentShader: [
          'precision highp float;',
          'varying vec2 vUv; uniform float uTime; uniform float uAspect; uniform float uVelocity;',
          'float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
          'float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}',
          'void main(){',
          ' vec2 p=vUv-.5; p.x*=uAspect;',
          ' vec2 c=vec2(.17*uAspect,.015); vec2 q=p-c;',
          ' float r=length(q); float a=atan(q.y,q.x);',
          ' float pulse=.5+.5*sin(uTime*.65);',
          ' float shell=exp(-20.*r)*.42;',
          ' shell+=smoothstep(.018,0.,abs(r-(.18+.018*sin(a*3.-uTime*.42))))*.72;',
          ' shell+=smoothstep(.012,0.,abs(r-(.27+.025*sin(a*5.+uTime*.31))))*.38;',
          ' shell+=smoothstep(.008,0.,abs(r-(.34+.014*sin(a*7.-uTime*.24))))*.2;',
          ' float filaments=0.;',
          ' for(float i=0.;i<5.;i++){',
          '   float phase=i*1.256+uTime*(.08+i*.018)+uVelocity*.035;',
          '   float curve=sin((p.x-c.x)*2.1+phase)*(.12+i*.015);',
          '   float y=c.y+curve+(i-2.)*.09;',
          '   float d=abs(p.y-y);',
          '   filaments+=smoothstep(.012,0.,d)*.5+smoothstep(.075,0.,d)*.08;',
          ' }',
          ' filaments*=smoothstep(.72,.12,abs(p.x-c.x));',
          ' float dust=step(.993,hash(floor(vUv*vec2(240.,140.))))*(.35+.65*noise(vUv*52.+uTime*.025));',
          ' float vignette=smoothstep(.92,.14,length(vec2((vUv.x-.5)*.9,vUv.y-.5)));',
          ' vec3 base=mix(vec3(.006,.027,.018),vec3(.008,.05,.032),vUv.y);',
          ' vec3 glow=vec3(.08,.96,.55)*(shell+filaments*(.55+abs(uVelocity)*.004));',
          ' glow+=vec3(.42,1.,.73)*dust*.33;',
          ' gl_FragColor=vec4((base+glow)*vignette,1.);',
          '}'
        ].join('\n')
      });
      scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

      var ring = document.getElementById('orbit-ring');
      var panels = Array.prototype.slice.call(document.querySelectorAll('.orbit-panel'));
      var progress = document.querySelector('.orbit-progress');
      var count = document.getElementById('orbit-count');
      var title = document.getElementById('orbit-title');
      var targetPosition = 0;
      var displayPosition = 0;
      var previousPosition = 0;
      var visible = true;
      var running = false;
      var startTime = performance.now();

      panels.forEach(function (panel, index) {
        var dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'orbit-dot' + (index === 0 ? ' is-active' : '');
        dot.setAttribute('aria-label', 'Go to ' + panel.getAttribute('data-title'));
        dot.addEventListener('click', function () { goToPanel(index); });
        progress.appendChild(dot);
      });
      var dots = Array.prototype.slice.call(progress.querySelectorAll('.orbit-dot'));

      function resizeOrbit() {
        var width = Math.max(1, window.innerWidth);
        var height = Math.max(1, window.innerHeight);
        renderer.setSize(width, height, false);
        uniforms.uAspect.value = width / height;
        updateTarget();
      }

      function easedSegment(value) {
        var low = Math.floor(value);
        var fraction = value - low;
        if (low >= panels.length - 1) return panels.length - 1;
        if (fraction <= .1) return low;
        if (fraction >= .9) return low + 1;
        var t = (fraction - .1) / .8;
        t = t * t * (3 - 2 * t);
        return low + t;
      }

      function updateTarget() {
        var distance = Math.max(1, orbitExperience.offsetHeight - window.innerHeight);
        var raw = Math.max(0, Math.min(1, (window.scrollY - orbitExperience.offsetTop) / distance));
        targetPosition = easedSegment(raw * (panels.length - 1));
        startLoop();
      }

      function goToPanel(index) {
        var distance = orbitExperience.offsetHeight - window.innerHeight;
        var y = orbitExperience.offsetTop + distance * (index / (panels.length - 1));
        window.scrollTo({ top: y, behavior: 'smooth' });
      }

      function updatePanelState() {
        var nearest = Math.max(0, Math.min(panels.length - 1, Math.round(displayPosition)));
        panels.forEach(function (panel, index) {
          var degrees = (index - displayPosition) * 45;
          while (degrees > 180) degrees -= 360;
          while (degrees < -180) degrees += 360;
          var depth = Math.abs(degrees);
          var opacity = depth < 24 ? 1 : depth < 62 ? .35 : depth < 105 ? .1 : .025;
          panel.style.opacity = String(opacity);
          panel.style.filter = 'blur(' + (depth < 24 ? 0 : Math.min(5, depth / 28)).toFixed(2) + 'px) saturate(' + (depth < 24 ? 1 : .5) + ')';
          var active = index === nearest;
          panel.classList.toggle('is-active', active);
          panel.setAttribute('aria-hidden', active ? 'false' : 'true');
          panel.inert = !active;
        });
        dots.forEach(function (dot, index) {
          var active = index === nearest;
          dot.classList.toggle('is-active', active);
          if (active) dot.setAttribute('aria-current', 'step');
          else dot.removeAttribute('aria-current');
        });
        count.textContent = String(nearest + 1).padStart(2, '0') + ' / ' + String(panels.length).padStart(2, '0');
        title.textContent = panels[nearest].getAttribute('data-title');
      }

      function render(now) {
        running = false;
        if (!visible || document.hidden || !document.documentElement.classList.contains('orbit-ready')) return;
        var delta = targetPosition - displayPosition;
        displayPosition += delta * .13;
        var velocity = displayPosition - previousPosition;
        previousPosition = displayPosition;
        uniforms.uTime.value = (now - startTime) * .001;
        uniforms.uVelocity.value += (velocity * 900 - uniforms.uVelocity.value) * .08;
        ring.style.transform = 'rotateY(' + (-displayPosition * 45).toFixed(3) + 'deg)';
        updatePanelState();
        renderer.render(scene, camera);
        if (Math.abs(delta) > .0002 || Math.abs(uniforms.uVelocity.value) > .015 || visible) startLoop();
      }

      function startLoop() {
        if (!running && visible && !document.hidden) {
          running = true;
          requestAnimationFrame(render);
        }
      }

      function bindMailForm(form) {
        if (!form) return;
        form.addEventListener('submit', function (event) {
          event.preventDefault();
          if (!form.reportValidity()) return;
          var data = new FormData(form);
          var subject = 'Higher Rank Strategy Call — ' + (data.get('business') || data.get('name'));
          var body = ['Name: ' + data.get('name'),'Email: ' + data.get('email'),'Business / brand name: ' + (data.get('business') || 'Not provided'),'','What I am trying to accomplish:',data.get('goal'),'',"What's getting in the way:",data.get('blocker')].join('\n');
          var formNote = form.querySelector('[data-form-note]');
          if (formNote) formNote.textContent = 'Your email app is opening with the message ready to review and send.';
          window.location.href = 'mailto:N.Young@HigherRankMedia.com?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
        });
      }
      bindMailForm(document.getElementById('orbit-strategy-form'));

      document.addEventListener('click', function (event) {
        var link = event.target.closest('a[href^="#"]');
        if (!link || !document.documentElement.classList.contains('orbit-ready')) return;
        var map = { '#main':0, '#services':1, '#process':2, '#live':5, '#about':6, '#contact':7 };
        var index = map[link.getAttribute('href')];
        if (typeof index === 'number') { event.preventDefault(); goToPanel(index); }
      });

      window.addEventListener('scroll', updateTarget, { passive:true });
      window.addEventListener('resize', resizeOrbit, { passive:true });
      document.addEventListener('visibilitychange', startLoop);
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (entries) {
          visible = entries[0].isIntersecting;
          if (visible) startLoop();
        }, { threshold:.01 }).observe(orbitExperience);
      }
      canvas.addEventListener('webglcontextlost', function (event) {
        event.preventDefault();
        visible = false;
        document.documentElement.classList.remove('orbit-ready');
      }, false);

      resizeOrbit();
      updateTarget();
      updatePanelState();
      startLoop();
    })();
  