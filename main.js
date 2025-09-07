document.addEventListener('DOMContentLoaded', () => {
    // UI要素の取得
    const canvas = document.getElementById('gl-canvas');
    const video = document.getElementById('video-feed');
    const modeToggleBtn = document.getElementById('mode-toggle-btn');
    const cameraSwitchBtn = document.getElementById('camera-switch-btn');
    const shutterBtn = document.getElementById('shutter-btn');
    const saveBtn = document.getElementById('save-btn');
    const imageUpload = document.getElementById('image-upload');
    const touchIndicator = document.getElementById('touch-indicator');
    const filterRectangle = document.getElementById('filter-rectangle');
    const filterIconTop = document.getElementById('filter-icon-top');
    const filterIconBottom = document.getElementById('filter-icon-bottom');
    const filterIconLeft = document.getElementById('filter-icon-left');
    const filterIconRight = document.getElementById('filter-icon-right');

    // WebGLコンテキストの取得とエラーチェック
    const gl = canvas.getContext('webgl');
    if (!gl) {
        alert('WebGLは現在のブラウザでサポートされていません。');
        return;
    }

    // グローバル状態変数
    let isCameraMode = true;
    let currentFacingMode = 'environment';
    let originalImage = null;
    let texture = null;
    let isCapturing = false;
    let lastProcessedPos = null;
    let program = null;

    // WebGLシェーダーのソース
    const vsSource = `
        attribute vec4 a_position;
        varying vec2 v_texCoord;
        void main() {
            gl_Position = a_position;
            v_texCoord = a_position.xy * 0.5 + 0.5;
        }
    `;

    // 4つのフィルターを統合し、グラデーションを適用するフラグメントシェーダー
    const fsSource = `
        precision mediump float;
        uniform sampler2D u_image;
        uniform vec2 u_resolution;
        uniform float u_time;
        uniform vec2 u_touch_pos;
        varying vec2 v_texCoord;

        // ランダムな値を生成する関数
        float random(vec2 st) {
            return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
        }

        // タッチ位置から各フィルターの適用度を計算する関数
        vec4 calculateWeights(vec2 touchPos) {
            vec2 center = vec2(0.5, 0.5);
            vec2 normalizedPos = touchPos - center;
            float topWeight = smoothstep(0.0, 1.0, normalizedPos.y + 0.5);
            float bottomWeight = smoothstep(0.0, 1.0, 0.5 - normalizedPos.y);
            float rightWeight = smoothstep(0.0, 1.0, normalizedPos.x + 0.5);
            float leftWeight = smoothstep(0.0, 1.0, 0.5 - normalizedPos.x);

            float totalWeight = topWeight + bottomWeight + rightWeight + leftWeight;
            return vec4(topWeight, rightWeight, bottomWeight, leftWeight) / totalWeight;
        }

        void main() {
            vec2 st = gl_FragCoord.xy / u_resolution.xy;
            vec4 baseColor = texture2D(u_image, vec2(v_texCoord.x, 1.0 - v_texCoord.y));

            // タッチされていない場合はフィルターを適用しない
            if (u_touch_pos.x < 0.0) {
                gl_FragColor = baseColor;
                return;
            }

            // 各フィルターの適用度を計算
            vec4 weights = calculateWeights(u_touch_pos);

            // フィルターを個別に適用した色を計算
            vec4 filteredColorTop = baseColor;
            vec3 noise = vec3(random(st + u_time), random(st * 2.0 - u_time), random(st + 5.0 * u_time));
            filteredColorTop.rgb += noise * 0.2 * weights.x; // レトロフィルム（グレイン＆ノイズ）
            filteredColorTop.rgb *= mix(vec3(1.0), vec3(1.1, 1.05, 0.9), weights.x);
            vec2 uv = st - 0.5;
            float vignette = smoothstep(0.8, 0.2, dot(uv, uv) * 2.0);
            filteredColorTop.rgb *= mix(vec3(1.0), vec3(vignette), weights.x);

            vec4 filteredColorRight = baseColor;
            float grayRight = dot(baseColor.rgb, vec3(0.299, 0.587, 0.114));
            vec3 sepia = vec3(grayRight * 1.2, grayRight * 1.0, grayRight * 0.8);
            filteredColorRight.rgb = mix(baseColor.rgb, sepia, weights.y); // セピアトーン

            vec4 filteredColorBottom = baseColor;
            float brightness = dot(baseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
            vec3 bloom = vec3(0.0);
            if (brightness > 0.8) {
                bloom = (baseColor.rgb - 0.8) * 1.5;
            }
            filteredColorBottom.rgb = mix(baseColor.rgb, baseColor.rgb + bloom * 1.5, weights.z); // ブルーム＆グロー

            vec4 filteredColorLeft = baseColor;
            vec4 red = texture2D(u_image, vec2(v_texCoord.x, 1.0 - v_texCoord.y) + vec2(sin(u_time * 0.1) * 0.01 * weights.w, cos(u_time * 0.1) * 0.01 * weights.w));
            vec4 green = texture2D(u_image, vec2(v_texCoord.x, 1.0 - v_texCoord.y));
            vec4 blue = texture2D(u_image, vec2(v_texCoord.x, 1.0 - v_texCoord.y) + vec2(cos(u_time * 0.1) * -0.01 * weights.w, sin(u_time * 0.1) * 0.01 * weights.w));
            filteredColorLeft.rgb = vec3(red.r, green.g, blue.b); // カラーシフト

            // 各フィルターの色を重みに応じてブレンド
            vec4 finalColor = 
                filteredColorTop * weights.x +
                filteredColorRight * weights.y +
                filteredColorBottom * weights.z +
                filteredColorLeft * weights.w;

            gl_FragColor = finalColor;
        }
    `;

    // WebGL初期化関数
    function initWebGL(context, vsSource, fsSource) {
        const vertexShader = createShader(context, context.VERTEX_SHADER, vsSource);
        const fragmentShader = createShader(context, context.FRAGMENT_SHADER, fsSource);
        const program = context.createProgram();
        context.attachShader(program, vertexShader);
        context.attachShader(program, fragmentShader);
        context.linkProgram(program);
        context.useProgram(program);

        const positionBuffer = context.createBuffer();
        context.bindBuffer(context.ARRAY_BUFFER, positionBuffer);
        const positions = [-1, 1, 1, 1, -1, -1, -1, -1, 1, 1, 1, -1];
        context.bufferData(context.ARRAY_BUFFER, new Float32Array(positions), context.STATIC_DRAW);

        const positionAttributeLocation = context.getAttribLocation(program, 'a_position');
        context.enableVertexAttribArray(positionAttributeLocation);
        context.vertexAttribPointer(positionAttributeLocation, 2, context.FLOAT, false, 0, 0);

        return program;
    }
    
    // シェーダー作成ヘルパー関数
    function createShader(context, type, source) {
        const shader = context.createShader(type);
        context.shaderSource(shader, source);
        context.compileShader(shader);
        if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) {
            console.error('シェーダーのコンパイル中にエラーが発生しました: ' + context.getInfoLog(shader));
            context.deleteShader(shader);
            return null;
        }
        return shader;
    }

    // カメラの映像をWebGLテクスチャに変換するループ
    async function renderVideoFrame() {
        if (!isCameraMode || !video.srcObject) return;
        try {
            await video.play();
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
        } catch (e) {
            console.error("video.play()に失敗しました:", e);
            if (isCameraMode) {
                console.log("カメラの再起動を試みます。");
                await startCamera();
            }
        }
        video.requestVideoFrameCallback(renderVideoFrame);
    }

    // カメラ起動ロジック
    async function startCamera() {
        if (video.srcObject) {
            video.srcObject.getTracks().forEach(track => track.stop());
        }
        const constraints = {
            video: {
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                facingMode: currentFacingMode
            }
        };
        try {
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            video.srcObject = stream;
            await video.play();
            updateModeUI();
            video.requestVideoFrameCallback(renderVideoFrame);
        } catch (err) {
            console.error('カメラへのアクセスが拒否されました: ' + err);
            isCameraMode = false;
            updateModeUI();
            alert('カメラへのアクセスが拒否されました。写真編集モードに切り替えます。');
            imageUpload.click();
        }
    }

    const rootStyles = getComputedStyle(document.documentElement);
    function getCSSVar(name) {
        return rootStyles.getPropertyValue(name).trim();
    }
    
    function updateFilterIcons(brightness, temp, contrast, saturation, fade, hue_shift) {
        const brightnessIntensity = Math.abs(brightness);
        filterIconTop.style.color = getCSSVar('--bright-color');
        filterIconTop.style.transform = `translateX(-50%) scale(${1.0 + brightnessIntensity * 0.2})`;

        const bottomIntensity = Math.max(Math.abs(contrast), Math.abs(saturation), Math.abs(fade));
        filterIconBottom.style.color = getCSSVar('--saturation-color');
        filterIconBottom.style.transform = `translateX(-50%) scale(${1.0 + bottomIntensity * 0.2})`;
        
        const hueShiftIntensity = Math.abs(hue_shift);
        filterIconLeft.style.color = getCSSVar('--hue-color');
        filterIconLeft.style.transform = `translateY(-50%) scale(${1.0 + hueShiftIntensity * 0.2})`;

        const tempIntensity = Math.abs(temp);
        filterIconRight.style.color = getCSSVar('--warm-color');
        filterIconRight.style.transform = `translateY(-50%) scale(${1.0 + tempIntensity * 0.2})`;
    }

    function render(time) {
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.uniform2f(gl.getUniformLocation(program, 'u_resolution'), gl.canvas.width, gl.canvas.height);
        gl.uniform1f(gl.getUniformLocation(program, 'u_time'), time * 0.001);
        
        const touchPosLocation = gl.getUniformLocation(program, 'u_touch_pos');
        if (touchPosLocation) {
            gl.uniform2f(touchPosLocation, lastProcessedPos ? lastProcessedPos.x : -1.0, lastProcessedPos ? lastProcessedPos.y : -1.0);
        }

        if (!isCameraMode && originalImage) {
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, originalImage);
        }
        
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        
        if (isCapturing) {
            captureFrame();
            isCapturing = false;
        }

        requestAnimationFrame(render);
    }
    
    function captureFrame() {
        const source = isCameraMode ? video : originalImage;
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

        const offscreenProgram = initWebGL(offscreenGl, vsSource, fsSource);
        offscreenGl.useProgram(offscreenProgram);

        const offscreenTexture = offscreenGl.createTexture();
        offscreenGl.bindTexture(offscreenGl.TEXTURE_2D, offscreenTexture);
        offscreenGl.texParameteri(offscreenGl.TEXTURE_2D, offscreenGl.TEXTURE_WRAP_S, offscreenGl.CLAMP_TO_EDGE);
        offscreenGl.texParameteri(offscreenGl.TEXTURE_2D, offscreenGl.TEXTURE_WRAP_T, offscreenGl.CLAMP_TO_EDGE);
        offscreenGl.texParameteri(offscreenGl.TEXTURE_2D, offscreenGl.TEXTURE_MIN_FILTER, offscreenGl.LINEAR);
        offscreenGl.texImage2D(offscreenGl.TEXTURE_2D, 0, offscreenGl.RGBA, offscreenGl.RGBA, offscreenGl.UNSIGNED_BYTE, source);

        offscreenGl.uniform2f(offscreenGl.getUniformLocation(offscreenProgram, 'u_resolution'), offscreenCanvas.width, offscreenCanvas.height);
        offscreenGl.uniform1f(offscreenGl.getUniformLocation(offscreenProgram, 'u_time'), 0);
        if (offscreenGl.getUniformLocation(offscreenProgram, 'u_touch_pos')) {
            offscreenGl.uniform2f(offscreenGl.getUniformLocation(offscreenProgram, 'u_touch_pos'), lastProcessedPos ? lastProcessedPos.x : -1.0, lastProcessedPos ? lastProcessedPos.y : -1.0);
        }
        
        offscreenGl.drawArrays(offscreenGl.TRIANGLES, 0, 6);

        const dataURL = offscreenCanvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.href = dataURL;
        link.download = `filtered_photo_${Date.now()}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
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
        
        touchIndicator.style.left = `${clampedX}px`;
        touchIndicator.style.top = `${clampedY}px`;
        touchIndicator.style.opacity = 1;
        
        lastProcessedPos = { 
            x: (clampedX - rectLeft) / rectWidth, 
            y: (clampedY - rectTop) / rectHeight 
        };
    }

    function handleEnd() {
        isTouching = false;
        touchIndicator.style.opacity = 0;
    }
    
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
        gl.viewport(0, 0, canvas.width, canvas.height);
        lastProcessedPos = null;
        gl.uniform2f(gl.getUniformLocation(program, 'u_touch_pos'), -1.0, -1.0);
    });
    window.dispatchEvent(new Event('resize'));

    function updateModeUI() {
        if (isCameraMode) {
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
        lastProcessedPos = null;
        gl.uniform2f(gl.getUniformLocation(program, 'u_touch_pos'), -1.0, -1.0);
    }

    // イベントリスナー
    modeToggleBtn.addEventListener('click', () => {
        isCameraMode = !isCameraMode;
        if (isCameraMode) {
            startCamera();
        } else {
            if (video.srcObject) {
                video.srcObject.getTracks().forEach(track => track.stop());
            }
            imageUpload.click();
        }
    });
    
    cameraSwitchBtn.addEventListener('click', () => {
        currentFacingMode = (currentFacingMode === 'user') ? 'environment' : 'user';
        startCamera();
    });

    imageUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) {
            isCameraMode = true;
            startCamera();
            return;
        }
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                originalImage = img;
                updateModeUI();
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    });

    shutterBtn.addEventListener('click', () => {
        if (isCameraMode) {
            isCapturing = true;
        }
    });
    
    saveBtn.addEventListener('click', () => {
        if (!isCameraMode && originalImage) {
            isCapturing = true;
        }
    });

    // 初期化と描画ループの開始
    program = initWebGL(gl, vsSource, fsSource);
    texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

    requestAnimationFrame(render);
    startCamera();
});