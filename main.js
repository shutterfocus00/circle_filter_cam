document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('gl-canvas');
    const video = document.getElementById('video-feed');
    const modeToggleBtn = document.getElementById('mode-toggle-btn');
    const cameraSwitchBtn = document.getElementById('camera-switch-btn');
    const shutterBtn = document.getElementById('shutter-btn');
    const saveBtn = document.getElementById('save-btn');
    const imageUpload = document.getElementById('image-upload');
    const touchIndicator = document.getElementById('touch-indicator');
    const circleOverlay = document.getElementById('circle-overlay');
    const gl = canvas.getContext('webgl');

    // フィルターアイコンの要素を取得
    const filterIconTop = document.getElementById('filter-icon-top');
    const filterIconBottom = document.getElementById('filter-icon-bottom');
    const filterIconLeft = document.getElementById('filter-icon-left');
    const filterIconRight = document.getElementById('filter-icon-right');

    let isCameraMode = true;
    let currentFacingMode = 'environment';
    let originalImage = null;
    let texture = null;
    let isCapturing = false;
    let lastProcessedPos = null;

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
            vec2 texCoord = vec2(v_texCoord.x, 1.0 - v_texCoord.y);
            vec4 original_color = texture2D(u_image, texCoord);
            vec4 final_color = original_color;

            final_color.rgb = mix(final_color.rgb, vec3(dot(final_color.rgb, vec3(0.299, 0.587, 0.114))), u_fade * 0.4);
            final_color.rgb = mix(final_color.rgb, vec3(1.0), u_fade * 0.2);

            float brightness_factor = 1.0 + u_brightness * 0.5;
            final_color.rgb = pow(final_color.rgb, vec3(1.0 / brightness_factor));

            vec3 color_temp_matrix = vec3(1.0);
            if (u_temp > 0.0) {
                color_temp_matrix = vec3(1.0 + u_temp * 0.3, 1.0 + u_temp * 0.05, 1.0 - u_temp * 0.2);
            } else {
                color_temp_matrix = vec3(1.0 + u_temp * 0.2, 1.0 + u_temp * 0.05, 1.0 - u_temp * 0.3);
            }
            final_color.rgb *= color_temp_matrix;

            final_color.rgb = (final_color.rgb - 0.5) * (1.0 + u_contrast * 0.8) + 0.5;
            float luma = dot(final_color.rgb, vec3(0.299, 0.587, 0.114));
            final_color.rgb = mix(vec3(luma), final_color.rgb, 1.0 + u_saturation * 0.5);

            if (abs(u_hue_shift) > 0.001) {
                vec3 hsl = rgb2hsl(final_color.rgb);
                hsl.x += u_hue_shift * 0.05;
                hsl.x = mod(hsl.x, 1.0);
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
    const fadeLocation = gl.getUniformLocation(program, 'u_fade');
    const hueShiftLocation = gl.getUniformLocation(program, 'u_hue_shift');

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
                isCameraMode = false;
                updateModeUI();
                imageUpload.click();
            });
    }

    function updateFilterIcons(brightness, temp, contrast, saturation, fade, hue_shift) {
        const baseColor = '#fff';
        const brightColor = '#FFD700'; // 太陽
        const warmColor = '#FF4500'; // 焚き火
        const coolColor = '#87CEEB'; // 雪
        const saturationColor = '#ADFF2F'; // 月

        // 明るさ (Brightness) - top
        const brightnessIntensity = Math.abs(brightness);
        filterIconTop.style.color = `mix(${baseColor}, ${brightColor}, ${brightnessIntensity})`;

        // コントラスト/彩度/フェード - bottom
        const bottomIntensity = Math.max(Math.abs(contrast), Math.abs(saturation), Math.abs(fade));
        filterIconBottom.style.color = `mix(${baseColor}, ${saturationColor}, ${bottomIntensity})`;
        
        // 色相 (Hue Shift) - left
        const hueShiftIntensity = Math.abs(hue_shift);
        filterIconLeft.style.color = `mix(${baseColor}, ${coolColor}, ${hueShiftIntensity})`;

        // 色温度 (Temperature) - right
        const tempIntensity = Math.abs(temp);
        filterIconRight.style.color = `mix(${baseColor}, ${warmColor}, ${tempIntensity})`;

        // アイコンの拡大縮小も追加で維持
        filterIconTop.style.transform = `translate(-50%, -50%) scale(${1.0 + brightnessIntensity * 0.2})`;
        filterIconBottom.style.transform = `translate(-50%, -50%) scale(${1.0 + bottomIntensity * 0.2})`;
        filterIconLeft.style.transform = `translate(-50%, -50%) scale(${1.0 + hueShiftIntensity * 0.2})`;
        filterIconRight.style.transform = `translate(-50%, -50%) scale(${1.0 + tempIntensity * 0.2})`;
    }


    function render() {
        if (isCameraMode && video.readyState >= 2) {
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
        } else if (!isCameraMode && originalImage) {
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, originalImage);
        }
        
        let brightness = 0.0;
        let temp = 0.0;
        let contrast = 0.0;
        let saturation = 0.0;
        let fade = 0.0;
        let hue_shift = 0.0;
        
        if (lastProcessedPos) {
            const circleRect = circleOverlay.getBoundingClientRect();
            const circleCenterX = circleRect.left + circleRect.width / 2;
            const circleCenterY = circleRect.top + circleRect.height / 2;
            const circleRadius = circleRect.width / 2;

            const normalizedX = (lastProcessedPos.x - circleCenterX) / circleRadius;
            const normalizedY = (lastProcessedPos.y - circleCenterY) / circleRadius;

            brightness = -normalizedY;
            temp = normalizedX;
            
            const distFromCenter = Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY);
            contrast = distFromCenter;
            saturation = distFromCenter;
            fade = distFromCenter * 0.5;
            hue_shift = normalizedX * 0.5;
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
        const dataURL = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.href = dataURL;
        link.download = `filtered_photo_${Date.now()}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    let isTouching = false;
    let touchPoint = null;

    function handleStart(e) {
        const targetTagName = e.target.tagName.toLowerCase();
        if (targetTagName === 'button' || targetTagName === 'svg' || targetTagName === 'path') {
            return;
        }
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

        const circleRect = circleOverlay.getBoundingClientRect();
        const circleCenterX = circleRect.left + circleRect.width / 2;
        const circleCenterY = circleRect.top + circleRect.height / 2;
        const circleRadius = circleRect.width / 2;

        const distFromCenter = Math.sqrt(
            Math.pow(x - circleCenterX, 2) + 
            Math.pow(y - circleCenterY, 2)
        );

        if (distFromCenter <= circleRadius) {
            touchPoint = { x, y };
            touchIndicator.style.left = `${x}px`;
            touchIndicator.style.top = `${y}px`;
            touchIndicator.style.opacity = 1;
        } else {
            if (touchPoint) {
                const angle = Math.atan2(y - circleCenterY, x - circleCenterX);
                const clampedX = circleCenterX + circleRadius * Math.cos(angle);
                const clampedY = circleCenterY + circleRadius * Math.sin(angle);
                touchPoint = { x: clampedX, y: clampedY };
                
                touchIndicator.style.left = `${clampedX}px`;
                touchIndicator.style.top = `${clampedY}px`;
                touchIndicator.style.opacity = 1;
            } else {
                touchIndicator.style.opacity = 0;
                lastProcessedPos = null;
                gl.uniform1f(brightnessLocation, 0.0);
                gl.uniform1f(tempLocation, 0.0);
                gl.uniform1f(contrastLocation, 0.0);
                gl.uniform1f(saturationLocation, 0.0);
                gl.uniform1f(fadeLocation, 0.0);
                gl.uniform1f(hueShiftLocation, 0.0);
                updateFilterIcons(0, 0, 0, 0, 0, 0);
                return;
            }
        }
        
        lastProcessedPos = touchPoint;

        if (navigator.vibrate) {
            const normalizedDist = distFromCenter / circleRadius;
            if (normalizedDist > 0.95 && normalizedDist <= 1.0) {
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
    
    canvas.addEventListener('mousedown', handleStart);
    canvas.addEventListener('mousemove', handleMove);
    canvas.addEventListener('mouseup', handleEnd);
    canvas.addEventListener('mouseleave', handleEnd);
    canvas.addEventListener('touchstart', handleStart, { passive: false });
    canvas.addEventListener('touchmove', handleMove, { passive: false });
    canvas.addEventListener('touchend', handleEnd);

    window.addEventListener('resize', () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        gl.viewport(0, 0, canvas.width, canvas.height);
        lastProcessedPos = null;
        touchPoint = null;
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
            startCamera();
        } else {
            modeToggleBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>';
            modeToggleBtn.setAttribute('title', 'リアルタイム撮影モード');
            shutterBtn.classList.add('hidden');
            saveBtn.classList.remove('hidden');
            cameraSwitchBtn.classList.add('hidden');
            imageUpload.classList.remove('hidden');
            imageUpload.click();
        }
        lastProcessedPos = null;
        gl.uniform1f(brightnessLocation, 0.0);
        gl.uniform1f(tempLocation, 0.0);
        gl.uniform1f(contrastLocation, 0.0);
        gl.uniform1f(saturationLocation, 0.0);
        gl.uniform1f(fadeLocation, 0.0);
        gl.uniform1f(hueShiftLocation, 0.0);
        updateFilterIcons(0, 0, 0, 0, 0, 0);
    }

    modeToggleBtn.addEventListener('click', () => {
        isCameraMode = !isCameraMode;
        updateModeUI();
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
                    const imgAspectRatio = img.width / img.height;
                    const canvasAspectRatio = canvas.width / canvas.height;

                    let targetWidth, targetHeight;
                    if (imgAspectRatio > canvasAspectRatio) {
                        targetWidth = canvas.width;
                        targetHeight = canvas.width / imgAspectRatio;
                    } else {
                        targetHeight = canvas.height;
                        targetWidth = canvas.height * imgAspectRatio;
                    }

                    gl.bindTexture(gl.TEXTURE_2D, texture);
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, originalImage);
                    
                    render();
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
        } else {
            isCameraMode = true;
            updateModeUI();
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

    isCameraMode = true;
    updateModeUI();
});
