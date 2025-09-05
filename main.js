document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('gl-canvas');
    const video = document.getElementById('video-feed');
    const modeToggleBtn = document.getElementById('mode-toggle-btn');
    const cameraSwitchBtn = document.getElementById('camera-switch-btn');
    const shutterBtn = document.getElementById('shutter-btn');
    const saveBtn = document.getElementById('save-btn');
    const imageUpload = document.getElementById('image-upload');
    const touchIndicator = document.getElementById('touch-indicator');
    const circleOverlay = document.getElementById('circle-overlay'); // サークルオーバーレイ要素を取得
    const gl = canvas.getContext('webgl');

    let isCameraMode = true;
    let currentFacingMode = 'user';
    let originalImage = null;
    let mousePos = { x: 0.5, y: 0.5 };
    let texture = null;
    let isCapturing = false;

    if (!gl) {
        alert('WebGLは現在のブラウザでサポートされていません。');
        return;
    }

    const vsSource = `
        attribute vec4 a_position;
        varying vec2 v_texCoord;
        void main() {
            gl_Position = a_position;
            v_texCoord = a_position.xy * 0.5 + 0.5;
        }
    `;

    // 💡 修正: フィルターをフィルムライクでリッチな雰囲気に変更
    const fsSource = `
        precision mediump float;
        uniform sampler2D u_image;
        uniform float u_brightness;
        uniform float u_temp;
        uniform float u_contrast;
        uniform float u_saturation;
        uniform float u_fade; // 新しいフェードパラメータ
        uniform float u_hue_shift; // 新しい色相シフトパラメータ
        varying vec2 v_texCoord;
        
        // RGB to HSL and HSL to RGB conversion functions from https://gist.github.com/mjackson/5311256
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
            vec2 texCoord = vec2(v_texCoord.x, 1.0 - v_texCoord.y);
            vec4 original_color = texture2D(u_image, texCoord);
            vec4 final_color = original_color;

            // 1. フェード効果 (ブラックポイント/ホワイトポイントの調整)
            final_color.rgb = mix(final_color.rgb, vec3(dot(final_color.rgb, vec3(0.299, 0.587, 0.114))), u_fade * 0.4); // シャドウを明るくしてマットに
            final_color.rgb = mix(final_color.rgb, vec3(1.0), u_fade * 0.2); // ハイライトを柔らかく

            // 2. 明るさ調整 (ガンマ補正をより洗練されたものに)
            float brightness_factor = 1.0 + u_brightness * 0.5; // -0.5 ~ 1.5
            final_color.rgb = pow(final_color.rgb, vec3(1.0 / brightness_factor));

            // 3. 色温度調整 (より自然なフィルムトーン)
            vec3 color_temp_matrix = vec3(1.0);
            if (u_temp > 0.0) { // 暖色
                color_temp_matrix = vec3(1.0 + u_temp * 0.3, 1.0 + u_temp * 0.05, 1.0 - u_temp * 0.2); // 赤と緑を強調、青を抑える
            } else { // 寒色
                color_temp_matrix = vec3(1.0 + u_temp * 0.2, 1.0 + u_temp * 0.05, 1.0 - u_temp * 0.3); // 青を強調、赤を抑える
            }
            final_color.rgb *= color_temp_matrix;

            // 4. コントラストと彩度
            final_color.rgb = (final_color.rgb - 0.5) * (1.0 + u_contrast * 0.8) + 0.5; // コントラストを強調
            float luma = dot(final_color.rgb, vec3(0.299, 0.587, 0.114));
            final_color.rgb = mix(vec3(luma), final_color.rgb, 1.0 + u_saturation * 0.5); // 彩度を強調

            // 5. 色相シフト (わずかな色味の統一感)
            if (abs(u_hue_shift) > 0.001) {
                vec3 hsl = rgb2hsl(final_color.rgb);
                hsl.x += u_hue_shift * 0.05; // わずかに色相をシフト
                hsl.x = mod(hsl.x, 1.0); // 0-1の範囲にクリップ
                final_color.rgb = hsl2rgb(hsl);
            }
            
            gl_FragColor = final_color;
        }
    `;

    function createShader(gl, type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('An error occurred compiling the shaders: ' + gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }
        return shader;
    }

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

    const imageLocation = gl.getUniformLocation(program, 'u_image');
    const brightnessLocation = gl.getUniformLocation(program, 'u_brightness');
    const tempLocation = gl.getUniformLocation(program, 'u_temp');
    const contrastLocation = gl.getUniformLocation(program, 'u_contrast');
    const saturationLocation = gl.getUniformLocation(program, 'u_saturation');
    const fadeLocation = gl.getUniformLocation(program, 'u_fade'); // 新しいUniform
    const hueShiftLocation = gl.getUniformLocation(program, 'u_hue_shift'); // 新しいUniform

    texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

    function startCamera() {
        const constraints = {
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: currentFacingMode
            }
        };
        
        if (video.srcObject) {
            video.srcObject.getTracks().forEach(track => track.stop());
        }

        navigator.mediaDevices.getUserMedia(constraints)
            .then(stream => {
                video.srcObject = stream;
                video.onloadedmetadata = () => {
                    video.play();
                    requestAnimationFrame(render);
                };
            })
            .catch(err => {
                alert('カメラへのアクセスが拒否されました: ' + err);
            });
    }

    function render() {
        if (isCameraMode && video.readyState >= 2) {
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
        } else if (!isCameraMode && originalImage) {
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, originalImage);
        }
        
        // 💡 修正: 操作範囲をサークル内に限定
        const circleRect = circleOverlay.getBoundingClientRect();
        const circleCenterX = circleRect.left + circleRect.width / 2;
        const circleCenterY = circleRect.top + circleRect.height / 2;
        const circleRadius = circleRect.width / 2;

        let currentMouseX = mousePos.x * canvas.width;
        let currentMouseY = (1.0 - mousePos.y) * canvas.height;

        const distFromCircleCenter = Math.sqrt(
            Math.pow(currentMouseX - circleCenterX, 2) + 
            Math.pow(currentMouseY - circleCenterY, 2)
        );

        let brightness = 0.0;
        let temp = 0.0;
        let contrast = 0.0;
        let saturation = 0.0;
        let fade = 0.0;
        let hue_shift = 0.0;

        if (distFromCircleCenter <= circleRadius) { // サークル内でのみフィルターを適用
            const normalizedX = (currentMouseX - circleCenterX) / circleRadius; // -1 to 1
            const normalizedY = (currentMouseY - circleCenterY) / circleRadius; // -1 to 1

            brightness = -normalizedY; // 上で明るく、下で暗く
            temp = normalizedX; // 右で暖かく、左で寒く
            
            const effectStrength = Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY); // 中心からの距離で効果の強さを調整
            contrast = effectStrength;
            saturation = effectStrength;
            fade = effectStrength * 0.5; // フェード効果も強さに応じて
            hue_shift = normalizedX * 0.5; // 色相シフトも横軸に連動
        }
        // サークル外では、フィルター値はデフォルト（0）のままなので、効果なしになる

        gl.uniform1f(brightnessLocation, brightness);
        gl.uniform1f(tempLocation, temp);
        gl.uniform1f(contrastLocation, contrast);
        gl.uniform1f(saturationLocation, saturation);
        gl.uniform1f(fadeLocation, fade); // 新しいUniformをセット
        gl.uniform1f(hueShiftLocation, hue_shift); // 新しいUniformをセット

        gl.drawArrays(gl.TRIANGLES, 0, 6);
        
        if (isCapturing) {
            captureFrame();
            isCapturing = false;
        }

        requestAnimationFrame(render);
    }
    
    function captureFrame() {
        const dataURL = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.href = dataURL;
        link.download = `filtered_photo_${Date.now()}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    function handleMove(e) {
        let x, y;
        const appContainerRect = canvas.getBoundingClientRect(); // アプリコンテナ全体のサイズ
        if (e.touches) {
            x = e.touches[0].clientX;
            y = e.touches[0].clientY;
        } else {
            x = e.clientX;
            y = e.clientY;
        }
        
        // タッチインジケーターの表示位置
        touchIndicator.style.opacity = 1;
        touchIndicator.style.left = `${x}px`;
        touchIndicator.style.top = `${y}px`;

        // WebGLシェーダー用の正規化された座標
        mousePos.x = (x - appContainerRect.left) / appContainerRect.width;
        mousePos.y = 1.0 - ((y - appContainerRect.top) / appContainerRect.height);
    }

    function handleEnd() {
        touchIndicator.style.opacity = 0;
    }

    canvas.addEventListener('mousemove', handleMove);
    canvas.addEventListener('touchmove', handleMove);
    canvas.addEventListener('touchend', handleEnd);
    canvas.addEventListener('mouseleave', handleEnd); // マウスがキャンバス外に出たとき

    window.addEventListener('resize', () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        gl.viewport(0, 0, canvas.width, canvas.height);
    });
    window.dispatchEvent(new Event('resize'));

    modeToggleBtn.addEventListener('click', () => {
        isCameraMode = !isCameraMode;
        if (isCameraMode) {
            modeToggleBtn.textContent = '写真編集モード';
            shutterBtn.classList.remove('hidden');
            saveBtn.classList.add('hidden');
            cameraSwitchBtn.classList.remove('hidden');
            imageUpload.classList.add('hidden');
            startCamera();
        } else {
            modeToggleBtn.textContent = 'リアルタイム撮影モード';
            shutterBtn.classList.add('hidden');
            saveBtn.classList.remove('hidden');
            cameraSwitchBtn.classList.add('hidden');
            imageUpload.click();
        }
    });
    
    cameraSwitchBtn.addEventListener('click', () => {
        currentFacingMode = (currentFacingMode === 'user') ? 'environment' : 'user';
        startCamera();
    });

    imageUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    originalImage = img;
                    gl.bindTexture(gl.TEXTURE_2D, texture);
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, originalImage);
                    render();
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
        }
    });

    shutterBtn.addEventListener('click', () => {
        if (isCameraMode) {
            isCapturing = true;
        }
    });
    
    saveBtn.addEventListener('click', () => {
        if (!isCameraMode) {
            isCapturing = true;
        }
    });

    startCamera();
});
