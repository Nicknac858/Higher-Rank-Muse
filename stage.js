
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
        var cityImg = document.getElementById('orbit-city');
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
           revolve around. The city photo remains the fallback: if the GL
           context or any shader fails, initSpine returns null and the
           photo journey runs exactly as before. On success the html element
           gets the 'spine-on' class, which swaps the photo for this canvas.
           Four tiny point systems (helical strands, star crown, city base,
           rising motes) share one generated sprite texture; additive
           blending, no depth test, DPR capped at 1 — under ~1400 points
           and 4 draw calls, so it stays feather-light. */
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

          /* One shared point sprite: white core fading to transparent. */
          var spriteCanvas = document.createElement('canvas');
          spriteCanvas.width = 64; spriteCanvas.height = 64;
          var sctx = spriteCanvas.getContext('2d');
          var spriteGrad = sctx.createRadialGradient(32,32,0,32,32,32);
          spriteGrad.addColorStop(0,'rgba(255,255,255,1)');
          spriteGrad.addColorStop(.25,'rgba(255,255,255,.85)');
          spriteGrad.addColorStop(.6,'rgba(255,255,255,.26)');
          spriteGrad.addColorStop(1,'rgba(255,255,255,0)');
          sctx.fillStyle = spriteGrad;
          sctx.fillRect(0,0,64,64);
          var spriteTex = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, spriteTex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, spriteCanvas);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

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

          /* Strands: 3 intertwined helices. The vertex shader builds each
             point's position from aS (0 at the top .. 1 at the bottom) so
             uPhase can rotate the whole column in registration with the
             panels and the 2D ribbon. */
          var strandVs = [
            'attribute float aS;',
            'attribute float aStrand;',
            'attribute float aRand;',
            'uniform mat4 uProj;',
            'uniform mat4 uView;',
            'uniform float uPhase;',
            'uniform float uTime;',
            'uniform float uPointScale;',
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
            '  vColor = aS < 0.5 ? mix(top, mid, aS * 2.0) : mix(mid, bot, (aS - 0.5) * 2.0);',
            '  float pulse = 0.85 + 0.15 * sin(uTime * 2.2 + aS * 18.0 + aStrand * 2.1);',
            '  gl_PointSize = (0.05 + 0.055 * sin(aS * 3.14159265)) * (0.8 + aRand * 0.4) * pulse * uPointScale / max(1.0, -mv.z);',
            '  vAlpha = 0.8;',
            '}'
          ].join('\n');

          /* Static clouds (star crown + city base): precomputed positions,
             per-point size/color, gentle per-point flicker from uTime. */
          var cloudVs = [
            'attribute vec3 aPos;',
            'attribute float aSize;',
            'attribute vec3 aColor;',
            'attribute float aRand;',
            'uniform mat4 uProj;',
            'uniform mat4 uView;',
            'uniform float uTime;',
            'uniform float uPointScale;',
            'varying vec3 vColor;',
            'varying float vAlpha;',
            'void main(){',
            '  vec4 mv = uView * vec4(aPos, 1.0);',
            '  gl_Position = uProj * mv;',
            '  float flick = 0.72 + 0.28 * sin(uTime * (1.2 + aRand * 2.6) + aRand * 43.7);',
            '  gl_PointSize = aSize * uPointScale / max(1.0, -mv.z);',
            '  vColor = aColor;',
            '  vAlpha = flick;',
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
            '  vAlpha = 0.55 * sin(s * 3.14159265);',
            '}'
          ].join('\n');

          function makeSystem(vsSrc, data) {
            var prog = buildProgram(vsSrc, fsSrc);
            if (!prog) return null;
            var sys = {
              prog: prog, count: 0, attribs: [],
              uProj: gl.getUniformLocation(prog, 'uProj'),
              uView: gl.getUniformLocation(prog, 'uView'),
              uPhase: gl.getUniformLocation(prog, 'uPhase'),
              uTime: gl.getUniformLocation(prog, 'uTime'),
              uPointScale: gl.getUniformLocation(prog, 'uPointScale'),
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

          /* Strand geometry: 3 strands x 220 points. */
          var strandS = [], strandIdx = [], strandRand = [];
          for (var st = 0; st < 3; st++) {
            for (var si = 0; si < 220; si++) {
              strandS.push(si / 219);
              strandIdx.push(st);
              strandRand.push(Math.random());
            }
          }
          var strands = makeSystem(strandVs, {
            aS: { values: new Float32Array(strandS), size: 1 },
            aStrand: { values: new Float32Array(strandIdx), size: 1 },
            aRand: { values: new Float32Array(strandRand), size: 1 }
          });
          if (!strands) return null;

          /* Star crown: one large soft sprite at the top plus sparkles. */
          var crownPos = [0, 2.35, 0], crownSize = [0.9], crownColor = [0.88, 0.97, 1.0], crownRand = [0.5];
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
          }
          var crown = makeSystem(cloudVs, {
            aPos: { values: new Float32Array(crownPos), size: 3 },
            aSize: { values: new Float32Array(crownSize), size: 1 },
            aColor: { values: new Float32Array(crownColor), size: 3 },
            aRand: { values: new Float32Array(crownRand), size: 1 }
          });
          if (!crown) return null;

          /* City base: ~500 lights in a flat disc — the city from above. */
          var cityPos = [], citySize = [], cityColor = [], cityRand = [];
          for (var bi = 0; bi < 500; bi++) {
            var bAng = Math.random() * Math.PI * 2;
            var bRad = 1.9 * Math.sqrt(Math.random());
            cityPos.push(Math.cos(bAng) * bRad, -2.3 + (Math.random() - 0.5) * 0.05, Math.sin(bAng) * bRad);
            citySize.push(0.025 + Math.random() * 0.045);
            var bPick = Math.random();
            if (bPick < 0.45) cityColor.push(0.18, 0.49, 0.96);
            else if (bPick < 0.8) cityColor.push(0.38, 0.85, 1.0);
            else cityColor.push(0.82, 0.92, 1.0);
            cityRand.push(Math.random());
          }
          var cityBase = makeSystem(cloudVs, {
            aPos: { values: new Float32Array(cityPos), size: 3 },
            aSize: { values: new Float32Array(citySize), size: 1 },
            aColor: { values: new Float32Array(cityColor), size: 3 },
            aRand: { values: new Float32Array(cityRand), size: 1 }
          });
          if (!cityBase) return null;

          /* Rising motes: 150 points drifting up the column volume. */
          var moteS = [], moteRand = [];
          for (var mi = 0; mi < 150; mi++) { moteS.push(Math.random()); moteRand.push(Math.random()); }
          var motes = makeSystem(moteVs, {
            aS: { values: new Float32Array(moteS), size: 1 },
            aRand: { values: new Float32Array(moteRand), size: 1 }
          });
          if (!motes) return null;

          var systems = [strands, crown, cityBase, motes];

          gl.disable(gl.DEPTH_TEST);
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, spriteTex);

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

          function resize() {
            glCanvas.width = window.innerWidth;
            glCanvas.height = window.innerHeight;
            gl.viewport(0, 0, glCanvas.width, glCanvas.height);
          }
          resize();

          function drawSystem(sys, proj, view, phase, time, pointScale) {
            gl.useProgram(sys.prog);
            gl.uniformMatrix4fv(sys.uProj, false, proj);
            gl.uniformMatrix4fv(sys.uView, false, view);
            if (sys.uPhase) gl.uniform1f(sys.uPhase, phase);
            if (sys.uTime) gl.uniform1f(sys.uTime, time);
            if (sys.uPointScale) gl.uniform1f(sys.uPointScale, pointScale);
            if (sys.uTex) gl.uniform1i(sys.uTex, 0);
            for (var i = 0; i < sys.attribs.length; i++) {
              var at = sys.attribs[i];
              gl.bindBuffer(gl.ARRAY_BUFFER, at.buf);
              gl.enableVertexAttribArray(at.loc);
              gl.vertexAttribPointer(at.loc, at.size, gl.FLOAT, false, 0, 0);
            }
            gl.drawArrays(gl.POINTS, 0, sys.count);
            for (var j = 0; j < sys.attribs.length; j++) gl.disableVertexAttribArray(sys.attribs[j].loc);
          }

          /* Camera orbits and descends in sync with the scroll position:
             it opens looking up at the star crown and ends looking down
             into the city base, while uPhase rotates the strands at the
             same 1.83 rate as the panels and the 2D helical ribbon. */
          function render(display, now) {
            if (lost) return;
            var total = fallbackPanels.length - 1;
            var cp = total > 0 ? Math.max(0, Math.min(1, display / total)) : 0;
            var ang = cp * 0.9;
            var camRadius = 6.4;
            var eye = [Math.sin(ang) * camRadius, 2.6 + (-1.9 - 2.6) * cp, Math.cos(ang) * camRadius];
            var lookY = 1.5 + (-1.2 - 1.5) * cp;
            var aspect = glCanvas.width / Math.max(1, glCanvas.height);
            var proj = perspective(42 * Math.PI / 180, aspect, 0.1, 60);
            var view = lookAt(eye, [0, lookY, 0]);
            var phase = display * 1.83;
            var time = now * 0.001;
            var pointScale = glCanvas.height / (2 * Math.tan(21 * Math.PI / 180));
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            for (var i = 0; i < systems.length; i++) drawSystem(systems[i], proj, view, phase, time, pointScale);
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
          if (cityImg && !spineActive) {
            var cp = fallbackDisplay / (fallbackPanels.length - 1);
            var ih = window.innerHeight;
            var imgH = ih * 1.9;
            var focal = 0.14 + cp * 0.72;
            var ty = ih * 0.5 - focal * imgH;
            var cStr = 'translate(-50%,' + ty.toFixed(1) + 'px) rotate(' + (-10 + cp * 20).toFixed(2) + 'deg) scale(' + (1.12 + cp * .18).toFixed(3) + ')';
            var oStr2 = '50% ' + (focal * 100).toFixed(1) + '%';
            if (cityImg._t !== cStr) { cityImg._t = cStr; cityImg.style.transform = cStr; }
            if (cityImg._o !== oStr2) { cityImg._o = oStr2; cityImg.style.transformOrigin = oStr2; }
          }
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
  