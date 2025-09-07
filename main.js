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
        
        // フィルムグレインのシミュレーション
        float rand(vec2 co) {
            return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
        }

        void main() {
            vec4 original_color = texture2D(u_image, vec2(v_texCoord.x, 1.0 - v_texCoord.y));
            vec4 final_color = original_color;
            
            // フィルムライクなフェードとコントラスト
            // u_fadeはセンターからの距離で制御される
            final_color.rgb = mix(final_color.rgb, vec3(dot(final_color.rgb, vec3(0.299, 0.587, 0.114))), u_fade * 0.4);
            final_color.rgb = mix(final_color.rgb, vec3(1.0), u_fade * 0.2);

            // 輝度調整（上方向: 太陽 - 明るくきらきらと）
            float brightness_factor = u_brightness * 1.5;
            final_color.rgb = final_color.rgb * (1.0 + brightness_factor);
            // きらめき感を出すためにコントラストを調整
            final_color.rgb = pow(final_color.rgb, vec3(1.0 + brightness_factor * 0.3));
            
            // 色温度調整（右方向: 焚火 - 黄色すぎない温かさ）
            vec3 color_temp_matrix = vec3(1.0);
            if (u_temp > 0.0) {
                // 黄色成分を抑えて赤みを強調
                color_temp_matrix = vec3(1.0 + u_temp * 0.4, 1.0 + u_temp * 0.1, 1.0 - u_temp * 0.3);
            } else {
                // 青色成分を抑えてクールな白さを強調
                color_temp_matrix = vec3(1.0 + u_temp * 0.3, 1.0 + u_temp * 0.1, 1.0 - u_temp * 0.4);
            }
            final_color.rgb *= color_temp_matrix;
            
            // コントラスト調整（下方向: 月 - つやのある闇）
            final_color.rgb = (final_color.rgb - 0.5) * (1.0 + u_contrast * 0.5) + 0.5;
            float luma = dot(final_color.rgb, vec3(0.299, 0.587, 0.114));
            // 彩度調整
            final_color.rgb = mix(vec3(luma), final_color.rgb, 1.0 + u_saturation * 0.5);

            // 下方向（月）の「つやのある闇」を表現するために、コントラストを強調し、輝度を落とす
            float darkness_factor = u_contrast * 0.7;
            final_color.rgb = (final_color.rgb - 0.5) * (1.0 + darkness_factor) + 0.5 - darkness_factor * 0.2;

            // 色相調整（左方向: 雪の結晶）
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
    function initWebGL(context) {
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

    function render() {
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);

        let brightness = 0.0;
        let temp = 0.0;
        let contrast = 0.0;
        let saturation = 0.0;
        let fade = 0.0;
        let hue_shift = 0.0;
        
        const brightnessLocation = gl.getUniformLocation(program, 'u_brightness');
        const tempLocation = gl.getUniformLocation(program, 'u_temp');
        const contrastLocation = gl.getUniformLocation(program, 'u_contrast');
        const saturationLocation = gl.getUniformLocation(program, 'u_saturation');
        const fadeLocation = gl.getUniformLocation(program, 'u_fade');
        const hueShiftLocation = gl.getUniformLocation(program, 'u_hue_shift');
        
        // プレビュー画面のアスペクト比維持はCSSに任せるため、WebGLのクロップは行わない
        const cropRectLocation = gl.getUniformLocation(program, 'u_crop_rect');
        if (cropRectLocation) { // シェーダーにu_crop_rectがある場合のみ
            gl.uniform4f(cropRectLocation, 0.0, 0.0, 1.0, 1.0);
        }

        if (!isCameraMode && originalImage) {
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, originalImage);
        }
        
        if (lastProcessedPos) {
            // 長方形内の正規化された座標からフィルター値を計算
            const normalizedX = lastProcessedPos.x;
            const normalizedY = lastProcessedPos.y;

            brightness = -(normalizedY - 0.5) * 2.0; // Y軸は上方向が明るさ
            temp = (normalizedX - 0.5) * 2.0; // X軸は色温度
            
            const distFromCenter = Math.sqrt(
                Math.pow(normalizedX - 0.5, 2) + 
                Math.pow(normalizedY - 0.5, 2)
            ) * 2.0;
            const clampedDistFromCenter = Math.min(distFromCenter, 1.0); 

            contrast = clampedDistFromCenter;
            saturation = clampedDistFromCenter;
            fade = clampedDistFromCenter * 0.5;
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

        const offscreenProgram = initWebGL(offscreenGl);
        offscreenGl.useProgram(offscreenProgram);

        const offscreenTexture = offscreenGl.createTexture();
        offscreenGl.bindTexture(offscreenGl.TEXTURE_2D, offscreenTexture);
        offscreenGl.texParameteri(offscreenGl.TEXTURE_2D, offscreenGl.TEXTURE_WRAP_S, offscreenGl.CLAMP_TO_EDGE);
        offscreenGl.texParameteri(offscreenGl.TEXTURE_2D, offscreenGl.TEXTURE_WRAP_T, offscreenGl.CLAMP_TO_EDGE);
        offscreenGl.texParameteri(offscreenGl.TEXTURE_2D, offscreenGl.TEXTURE_MIN_FILTER, offscreenGl.LINEAR);
        offscreenGl.texImage2D(offscreenGl.TEXTURE_2D, 0, offscreenGl.RGBA, offscreenGl.RGBA, offscreenGl.UNSIGNED_BYTE, source);

        // プレビューのフィルター値を再適用
        let brightness = 0, temp = 0, contrast = 0, saturation = 0, fade = 0, hue_shift = 0;
        if (lastProcessedPos) {
            const normalizedX = lastProcessedPos.x;
            const normalizedY = lastProcessedPos.y;
            brightness = -(normalizedY - 0.5) * 2.0;
            temp = (normalizedX - 0.5) * 2.0;
            const distFromCenter = Math.sqrt(Math.pow(normalizedX - 0.5, 2) + Math.pow(normalizedY - 0.5, 2)) * 2.0;
            const clampedDistFromCenter = Math.min(distFromCenter, 1.0);
            contrast = clampedDistFromCenter;
            saturation = clampedDistFromCenter;
            fade = clampedDistFromCenter * 0.5;
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

        if (navigator.vibrate) {
            const distFromCenter = Math.sqrt(
                Math.pow(lastProcessedPos.x - 0.5, 2) + 
                Math.pow(lastProcessedPos.y - 0.5, 2)
            );
            const normalizedDist = Math.min(distFromCenter * 2.0, 1.0);
            if (normalizedDist > 0.95) {
                navigator.vibrate(20);
            } else if (normalizedDist < 0.05) {
                navigator.vibrate(10);
            }
        }
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
        gl.uniform1f(gl.getUniformLocation(program, 'u_brightness'), 0.0);
        gl.uniform1f(gl.getUniformLocation(program, 'u_temp'), 0.0);
        gl.uniform1f(gl.getUniformLocation(program, 'u_contrast'), 0.0);
        gl.uniform1f(gl.getUniformLocation(program, 'u_saturation'), 0.0);
        gl.uniform1f(gl.getUniformLocation(program, 'u_fade'), 0.0);
        gl.uniform1f(gl.getUniformLocation(program, 'u_hue_shift'), 0.0);
        updateFilterIcons(0, 0, 0, 0, 0, 0);
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
        gl.uniform1f(gl.getUniformLocation(program, 'u_brightness'), 0.0);
        gl.uniform1f(gl.getUniformLocation(program, 'u_temp'), 0.0);
        gl.uniform1f(gl.getUniformLocation(program, 'u_contrast'), 0.0);
        gl.uniform1f(gl.getUniformLocation(program, 'u_saturation'), 0.0);
        gl.uniform1f(gl.getUniformLocation(program, 'u_fade'), 0.0);
        gl.uniform1f(gl.getUniformLocation(program, 'u_hue_shift'), 0.0);
        updateFilterIcons(0, 0, 0, 0, 0, 0);
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
    program = initWebGL(gl);
    texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

    requestAnimationFrame(render);
    startCamera();
});