document.addEventListener('DOMContentLoaded', () => {
    // グローバル状態変数
    const state = {
        isCameraMode: true,
        currentFacingMode: 'environment',
        originalImage: null,
        texture: null,
        isCapturing: false,
        lastProcessedPos: null,
        program: null,
        gl: null,
        particles: [],
        particlesCtx: null,
        video: document.getElementById('video-feed')
    };

    // UI要素の取得
    const canvas = document.getElementById('gl-canvas');
    const particlesCanvas = document.getElementById('particles-canvas');
    const modeToggleBtn = document.getElementById('mode-toggle-btn');
    const cameraSwitchBtn = document.getElementById('camera-switch-btn');
    const shutterBtn = document.getElementById('shutter-btn');
    const saveBtn = document.getElementById('save-btn');
    const imageUpload = document.getElementById('image-upload');
    const filterRectangle = document.getElementById('filter-rectangle');
    const filterIconTop = document.getElementById('filter-icon-top');
    const filterIconBottom = document.getElementById('filter-icon-bottom');
    const filterIconLeft = document.getElementById('filter-icon-left');
    const filterIconRight = document.getElementById('filter-icon-right');

    // WebGLシェーダーのソース
    const vsSource = `
        attribute vec4 a_position;
        varying vec2 v_texCoord;
        void main() {
            gl_Position = a_position;
            v_texCoord = a_position.xy * 0.5 + 0.5;
        }
    `;
    const fsSource = `
        precision mediump float;
        uniform sampler2D u_image;
        uniform float u_brightness;
        uniform float u_temp;
        uniform float u_contrast;
        uniform float u_saturation;
        uniform float u_fade;
        uniform float u_hue_shift;
        varying vec2 v_texCoord;

        vec3 rgb2hsl(vec3 color) {
            float H = 0.0, S = 0.0, L = 0.0;
            float Cmin = min(min(color.r, color.g), color.b);
            float Cmax = max(max(color.r, color.g), color.b);
            float delta = Cmax - Cmin;

            L = (Cmax + Cmin) / 2.0;

            if (delta == 0.0) {
                H = 0.0;
                S = 0.0;
            } else {
                if (L < 0.5) S = delta / (Cmax + Cmin);
                else S = delta / (2.0 - Cmax - Cmin);

                float delta_R = (((Cmax - color.r) / 6.0) + (delta / 2.0)) / delta;
                float delta_G = (((Cmax - color.g) / 6.0) + (delta / 2.0)) / delta;
                float delta_B = (((Cmax - color.b) / 6.0) + (delta / 2.0)) / delta;

                if (color.r == Cmax) H = delta_B - delta_G;
                else if (color.g == Cmax) H = (1.0 / 3.0) + delta_R - delta_B;
                else if (color.b == Cmax) H = (2.0 / 3.0) + delta_G - delta_R;

                if (H < 0.0) H += 1.0;
                if (H > 1.0) H -= 1.0;
            }
            return vec3(H, S, L);
        }

        float hue2rgb(float p, float q, float t) {
            if (t < 0.0) t += 1.0;
            if (t > 1.0) t -= 1.0;
            if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
            if (t < 1.0/2.0) return q;
            if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
            return p;
        }

        vec3 hsl2rgb(vec3 hsl) {
            float H = hsl.x, S = hsl.y, L = hsl.z;
            float R, G, B;

            if (S == 0.0) {
                R = L;
                G = L;
                B = L;
            } else {
                float Q = (L < 0.5) ? (L * (1.0 + S)) : (L + S - L * S);
                float P = 2.0 * L - Q;
                R = hue2rgb(P, Q, H + 1.0/3.0);
                G = hue2rgb(P, Q, H);
                B = hue2rgb(P, Q, H - 1.0/3.0);
            }
            return vec3(R, G, B);
        }

        void main() {
            vec4 original_color = texture2D(u_image, vec2(v_texCoord.x, 1.0 - v_texCoord.y));
            vec4 final_color = original_color;
            
            // フィルム風フェード効果
            float fadeIntensity = u_fade;
            float luma = dot(final_color.rgb, vec3(0.299, 0.587, 0.114));
            final_color.rgb = final_color.rgb + vec3(fadeIntensity * 0.2);
            final_color.rgb = mix(final_color.rgb, vec3(luma), fadeIntensity * 0.4);

            // 明るさ調整
            float exposure = u_brightness * 2.0;
            final_color.rgb *= pow(2.0, exposure);
            
            // 色温度調整
            vec3 color_temp_matrix = vec3(1.0);
            if (u_temp > 0.0) {
                color_temp_matrix = vec3(1.0 + u_temp * 0.3, 1.0 + u_temp * 0.05, 1.0 - u_temp * 0.2);
            } else {
                color_temp_matrix = vec3(1.0 + u_temp * 0.2, 1.0 + u_temp * 0.05, 1.0 - u_temp * 0.3);
            }
            final_color.rgb *= color_temp_matrix;

            // コントラスト調整
            final_color.rgb = (final_color.rgb - 0.5) * (1.0 + u_contrast * 0.8) + 0.5;
            
            // 彩度調整
            luma = dot(final_color.rgb, vec3(0.299, 0.587, 0.114));
            final_color.rgb = mix(vec3(luma), final_color.rgb, 1.0 + u_saturation * 0.5);

            // 色相シフト調整
            if (abs(u_hue_shift) > 0.001) {
                vec3 hsl = rgb2hsl(final_color.rgb);
                hsl.x += u_hue_shift * 0.05;
                hsl.x = mod(hsl.x, 1.0);
                final_color.rgb = hsl2rgb(hsl);
            }
            
            gl_FragColor = final_color;
        }
    `;

    // WebGL初期化関数
    function initWebGL() {
        const gl = canvas.getContext('webgl');
        if (!gl) {
            alert('WebGLは現在のブラウザでサポートされていません。');
            return null;
        }
        state.gl = gl;

        const vertexShader = createShader(gl, gl.VERTEX_SHADER, vsSource);
        const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
        const program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);
        gl.useProgram(program);

        const positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        const positions = [-1, 1, 1, 1, -1, -1, -1, -1, 1, 1, 1, -1];
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

        const positionAttributeLocation = gl.getAttribLocation(program, 'a_position');
        gl.enableVertexAttribArray(positionAttributeLocation);
        gl.vertexAttribPointer(positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);

        state.program = program;
        state.texture = gl.createTexture();
        gl.bindTexture(state.texture, state.texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

        return true;
    }
    
    // シェーダー作成ヘルパー関数
    function createShader(gl, type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('シェーダーのコンパイル中にエラーが発生しました: ' + gl.getInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }
        return shader;
    }

    // カメラの映像をWebGLテクスチャに変換する
    function updateVideoTexture() {
        if (!state.isCameraMode || !state.video.srcObject) return;
        state.gl.bindTexture(state.gl.TEXTURE_2D, state.texture);
        state.gl.texImage2D(state.gl.TEXTURE_2D, 0, state.gl.RGBA, state.gl.RGBA, state.gl.UNSIGNED_BYTE, state.video);
    }

    // カメラ起動ロジック
    async function startCamera() {
        if (state.video.srcObject) {
            state.video.srcObject.getTracks().forEach(track => track.stop());
        }
        const constraints = {
            video: {
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                facingMode: state.currentFacingMode
            }
        };
        try {
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            state.video.srcObject = stream;
            await state.video.play();
            updateModeUI();
        } catch (err) {
            console.error('カメラへのアクセスが拒否されました: ' + err);
            state.isCameraMode = false;
            updateModeUI();
            alert('カメラへのアクセスが拒否されました。写真編集モードに切り替えます。');
            imageUpload.click();
        }
    }

    // パーティクルクラス
    class Particle {
        constructor(x, y) {
            this.x = x;
            this.y = y;
            this.size = Math.random() * 5 + 1;
            this.life = 100;
            this.opacity = 1.0;
            this.velocity = {
                x: (Math.random() - 0.5) * 2,
                y: (Math.random() - 0.5) * 2
            };
        }

        update() {
            this.x += this.velocity.x;
            this.y += this.velocity.y;
            this.life -= 1;
            this.opacity = this.life / 100;
        }

        draw() {
            state.particlesCtx.globalAlpha = this.opacity;
            state.particlesCtx.fillStyle = `rgba(255, 255, 255, ${this.opacity})`;
            state.particlesCtx.beginPath();
            state.particlesCtx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            state.particlesCtx.fill();
        }
    }

    // メイン描画ループ
    function renderLoop() {
        state.gl.clearColor(0, 0, 0, 1);
        state.gl.clear(state.gl.COLOR_BUFFER_BIT);

        updateVideoTexture();

        let brightness = 0.0;
        let temp = 0.0;
        let contrast = 0.0;
        let saturation = 0.0;
        let fade = 0.0;
        let hue_shift = 0.0;
        
        const gl = state.gl;
        const program = state.program;

        const brightnessLocation = gl.getUniformLocation(program, 'u_brightness');
        const tempLocation = gl.getUniformLocation(program, 'u_temp');
        const contrastLocation = gl.getUniformLocation(program, 'u_contrast');
        const saturationLocation = gl.getUniformLocation(program, 'u_saturation');
        const fadeLocation = gl.getUniformLocation(program, 'u_fade');
        const hueShiftLocation = gl.getUniformLocation(program, 'u_hue_shift');
        
        if (state.lastProcessedPos) {
            const normalizedX = state.lastProcessedPos.x;
            const normalizedY = state.lastProcessedPos.y;

            brightness = -(normalizedY - 0.5) * 2.0; 
            temp = (normalizedX - 0.5) * 2.0;
            
            const distFromCenter = Math.sqrt(
                Math.pow(normalizedX - 0.5, 2) + 
                Math.pow(normalizedY - 0.5, 2)
            ) * 2.0;
            const clampedDistFromCenter = Math.min(distFromCenter, 1.0); 

            contrast = clampedDistFromCenter * 0.5;
            saturation = clampedDistFromCenter * 0.5;
            fade = clampedDistFromCenter * 0.8;
            hue_shift = (normalizedX - 0.5) * 2.0;
        }

        gl.uniform1f(brightnessLocation, brightness);
        gl.uniform1f(tempLocation, temp);
        gl.uniform1f(contrastLocation, contrast);
        gl.uniform1f(saturationLocation, saturation);
        gl.uniform1f(fadeLocation, fade);
        gl.uniform1f(hueShiftLocation, hue_shift);

        updateFilterIcons(brightness, temp, contrast, saturation, fade, hue_shift);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // パーティクルアニメーション
        state.particlesCtx.clearRect(0, 0, particlesCanvas.width, particlesCanvas.height);
        for (let i = state.particles.length - 1; i >= 0; i--) {
            state.particles[i].update();
            state.particles[i].draw();
            if (state.particles[i].life <= 0) {
                state.particles.splice(i, 1);
            }
        }
        
        if (state.isCapturing) {
            captureFrame();
            state.isCapturing = false;
        }

        requestAnimationFrame(renderLoop);
    }
    
    function captureFrame() {
        const source = state.isCameraMode ? state.video : state.originalImage;
        const sourceWidth = source.videoWidth || source.width;
        const sourceHeight = source.videoHeight || source.height;

        const offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = sourceWidth;
        offscreenCanvas.height = sourceHeight;
        const offscreenGl = offscreenCanvas.getContext('webgl');
        if (!offscreenGl) {
            console.error('オフスクリーンWebGLコンテキストの作成に失敗しました。');
            return;
        }

        const offscreenProgram = initOffscreenWebGL(offscreenGl);
        offscreenGl.useProgram(offscreenProgram);

        const offscreenTexture = offscreenGl.createTexture();
        offscreenGl.bindTexture(offscreenGl.TEXTURE_2D, offscreenTexture);
        offscreenGl.texParameteri(offscreenGl.TEXTURE_2D, offscreenGl.TEXTURE_WRAP_S, offscreenGl.CLAMP_TO_EDGE);
        offscreenGl.texParameteri(offscreenGl.TEXTURE_2D, offscreenGl.TEXTURE_WRAP_T, offscreenGl.CLAMP_TO_EDGE);
        offscreenGl.texParameteri(offscreenGl.TEXTURE_2D, offscreenGl.TEXTURE_MIN_FILTER, offscreenGl.LINEAR);
        offscreenGl.texImage2D(offscreenGl.TEXTURE_2D, 0, offscreenGl.RGBA, offscreenGl.RGBA, offscreenGl.UNSIGNED_BYTE, source);

        let brightness = 0, temp = 0, contrast = 0, saturation = 0, fade = 0, hue_shift = 0;
        if (state.lastProcessedPos) {
            const normalizedX = state.lastProcessedPos.x;
            const normalizedY = state.lastProcessedPos.y;
            brightness = -(normalizedY - 0.5) * 2.0;
            temp = (normalizedX - 0.5) * 2.0;
            const distFromCenter = Math.sqrt(Math.pow(normalizedX - 0.5, 2) + Math.pow(normalizedY - 0.5, 2)) * 2.0;
            const clampedDistFromCenter = Math.min(distFromCenter, 1.0);
            contrast = clampedDistFromCenter * 0.5;
            saturation = clampedDistFromCenter * 0.5;
            fade = clampedDistFromCenter * 0.8;
            hue_shift = (normalizedX - 0.5) * 2.0;
        }

        offscreenGl.uniform1f(offscreenGl.getUniformLocation(offscreenProgram, 'u_brightness'), brightness);
        offscreenGl.uniform1f(offscreenGl.getUniformLocation(offscreenProgram, 'u_temp'), temp);
        offscreenGl.uniform1f(offscreenGl.getUniformLocation(offscreenProgram, 'u_contrast'), contrast);
        offscreenGl.uniform1f(offscreenGl.getUniformLocation(offscreenProgram, 'u_saturation'), saturation);
        offscreenGl.uniform1f(offscreenGl.getUniformLocation(offscreenProgram, 'u_fade'), fade);
        offscreenGl.uniform1f(offscreenGl.getUniformLocation(offscreenProgram, 'u_hue_shift'), hue_shift);
        
        offscreenGl.drawArrays(offscreenGl.TRIANGLES, 0, 6);

        const dataURL = offscreenCanvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.href = dataURL;
        link.download = `filtered_photo_${Date.now()}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
    
    function initOffscreenWebGL(gl) {
        const vertexShader = createShader(gl, gl.VERTEX_SHADER, vsSource);
        const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
        const program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);
        gl.useProgram(program);

        const positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        const positions = [-1, 1, 1, 1, -1, -1, -1, -1, 1, 1, 1, -1];
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

        const positionAttributeLocation = gl.getAttribLocation(program, 'a_position');
        gl.enableVertexAttribArray(positionAttributeLocation);
        gl.vertexAttribPointer(positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);

        return program;
    }

    let isTouching = false;

    function handleStart(e) {
        const targetTagName = e.target.tagName.toLowerCase();
        if (targetTagName === 'button' || targetTagName === 'svg' || targetTagName === 'path') {
            return;
        }
        e.preventDefault();
        isTouching = true;
        handleMove(e);
    }
    
    function handleMove(e) {
        if (!isTouching) return;

        let x, y;
        if (e.touches) {
            x = e.touches[0].clientX;
            y = e.touches[0].clientY;
        } else {
            x = e.clientX;
            y = e.clientY;
        }

        const rect = filterRectangle.getBoundingClientRect();
        const rectLeft = rect.left;
        const rectTop = rect.top;
        const rectWidth = rect.width;
        const rectHeight = rect.height;

        let clampedX = Math.max(rectLeft, Math.min(x, rectLeft + rectWidth));
        let clampedY = Math.max(rectTop, Math.min(y, rectTop + rectHeight));
        
        for (let i = 0; i < 5; i++) {
            state.particles.push(new Particle(clampedX, clampedY));
        }
        
        state.lastProcessedPos = { 
            x: (clampedX - rectLeft) / rectWidth, 
            y: (clampedY - rectTop) / rectHeight 
        };
    }

    function handleEnd() {
        isTouching = false;
    }
    
    function updateModeUI() {
        if (state.isCameraMode) {
            modeToggleBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v16H4z"/><path d="M9 12h6"/><path d="M12 9v6"/></svg>';
            modeToggleBtn.setAttribute('title', '写真編集モード');
            shutterBtn.classList.remove('hidden');
            saveBtn.classList.add('hidden');
            cameraSwitchBtn.classList.remove('hidden');
            imageUpload.classList.add('hidden');
        } else {
            modeToggleBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>';
            modeToggleBtn.setAttribute('title', 'リアルタイム撮影モード');
            shutterBtn.classList.add('hidden');
            saveBtn.classList.remove('hidden');
            cameraSwitchBtn.classList.add('hidden');
            imageUpload.classList.remove('hidden');
        }
        state.lastProcessedPos = null;
        const gl = state.gl;
        if (gl) {
            gl.uniform1f(gl.getUniformLocation(state.program, 'u_brightness'), 0.0);
            gl.uniform1f(gl.getUniformLocation(state.program, 'u_temp'), 0.0);
            gl.uniform1f(gl.getUniformLocation(state.program, 'u_contrast'), 0.0);
            gl.uniform1f(gl.getUniformLocation(state.program, 'u_saturation'), 0.0);
            gl.uniform1f(gl.getUniformLocation(state.program, 'u_fade'), 0.0);
            gl.uniform1f(gl.getUniformLocation(state.program, 'u_hue_shift'), 0.0);
            updateFilterIcons(0, 0, 0, 0, 0, 0);
        }
    }
    
    // イベントリスナーの登録
    function addEventListeners() {
        modeToggleBtn.addEventListener('click', () => {
            state.isCameraMode = !state.isCameraMode;
            if (state.isCameraMode) {
                startCamera();
            } else {
                if (state.video.srcObject) {
                    state.video.srcObject.getTracks().forEach(track => track.stop());
                }
                imageUpload.click();
            }
        });
        
        cameraSwitchBtn.addEventListener('click', () => {
            state.currentFacingMode = (state.currentFacingMode === 'user') ? 'environment' : 'user';
            startCamera();
        });

        imageUpload.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) {
                state.isCameraMode = true;
                startCamera();
                return;
            }
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    state.originalImage = img;
                    updateModeUI();
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
        });

        shutterBtn.addEventListener('click', () => {
            if (state.isCameraMode) {
                state.isCapturing = true;
            }
        });
        
        saveBtn.addEventListener('click', () => {
            if (!state.isCameraMode && state.originalImage) {
                state.isCapturing = true;
            }
        });

        filterRectangle.addEventListener('mousedown', handleStart);
        filterRectangle.addEventListener('mousemove', handleMove);
        filterRectangle.addEventListener('mouseup', handleEnd);
        filterRectangle.addEventListener('mouseleave', handleEnd);
        filterRectangle.addEventListener('touchstart', handleStart, { passive: false });
        filterRectangle.addEventListener('touchmove', handleMove, { passive: false });
        filterRectangle.addEventListener('touchend', handleEnd);

        window.addEventListener('resize', () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            state.gl.viewport(0, 0, canvas.width, canvas.height);
            particlesCanvas.width = window.innerWidth;
            particlesCanvas.height = window.innerHeight;
            updateModeUI();
        });
    }

    // 初期化関数
    function init() {
        if (!initWebGL()) return;
        state.particlesCtx = particlesCanvas.getContext('2d');
        addEventListeners();
        window.dispatchEvent(new Event('resize'));
        startCamera();
        renderLoop();
    }
    
    init();
});
