
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

        fallbackPanels.forEach(function (panel, index) {
          var dot = document.createElement('button');
          dot.type = 'button';
          dot.className = 'orbit-dot' + (index === 0 ? ' is-active' : '');
          dot.setAttribute('aria-label', 'Go to ' + panel.getAttribute('data-title'));
          dot.addEventListener('click', function () { fallbackGo(index); });
          fallbackProgress.appendChild(dot);
          fallbackDots.push(dot);
        });

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
          /* Pre-render the static background gradient once per resize; the
             per-frame paint then just blits it instead of rebuilding a
             full-screen radial gradient 60 times a second. */
          fallbackBg.width = canvas.width;
          fallbackBg.height = canvas.height;
          var bgCtx = fallbackBg.getContext('2d');
          var bgGrad = bgCtx.createRadialGradient(canvas.width*.5,canvas.height*.5,0,canvas.width*.5,canvas.height*.5,Math.max(canvas.width,canvas.height)*.78);
          bgGrad.addColorStop(0,'#030b1e'); bgGrad.addColorStop(.28,'#01030a'); bgGrad.addColorStop(1,'#000000');
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
            ctx.strokeStyle='rgba('+(46+i*8)+','+(124+i*15)+',255,'+(alpha*.30)+')';
            ctx.lineWidth=i===2?7.5:3.6;
            ctx.stroke();
            ctx.strokeStyle='rgba('+(46+i*8)+','+(124+i*15)+',255,'+alpha+')';
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
          if (cityImg) {
            var cp = fallbackDisplay / (fallbackPanels.length - 1);
            var cStr = 'translate(-50%,-50%) rotate(' + (-17 + cp * 34).toFixed(2) + 'deg) scale(' + (1.02 + cp * .1).toFixed(3) + ')';
            if (cityImg._t !== cStr) { cityImg._t = cStr; cityImg.style.transform = cStr; }
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
  