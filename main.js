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
    const controls = document.getElementById('controls');
    const gl = canvas.getContext('webgl');

    const filterIconTop = document.getElementById('filter-icon-top');
    const filterIconBottom = document.getElementById('filter-icon-bottom');
    const filterIconLeft = document.getElementById('filter-icon-left');
    const filterIconRight = document.getElementById('filter-icon-right');

    const state = {
        isCameraMode: true,
        currentFacingMode: 'environment',
        originalImage: null,
        texture: null,
        isCapturing: false,
        filterValues: {
            brightness: 0.0,
            temp: 0.0,
            contrast: 0.0,
            saturation: 0.0,
            fade: 0.0,
            hue_shift: 0.0
        },
        isTouching: false,
        touchPoint: null,
    };
    
    // 省略：WebGLのセットアップコード（変更なし）
    if (!gl) {
        alert('WebGLは現在のブラウザでサポートされていません。');
        return;
    }
    const vsSource = `...`; // 変更なし
    const fsSource = `...`; // 変更なし
    function createShader(gl, type, source) { ... } // 変更なし
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
    state.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, state.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

    // 新しいカメラ開始関数
    function startCamera() {
        const constraints = {
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: state.currentFacingMode
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
                const message = 'カメラへのアクセスが拒否されました。設定を確認してください。';
                alert(message);
                console.error(err);
                state.isCameraMode = false;
                updateModeUI();
                imageUpload.click();
            });
    }

    function updateFilterIcons(values) {
        const { brightness, temp, contrast, saturation, fade, hue_shift } = values;
        const brightnessIntensity = Math.abs(brightness);
        filterIconTop.style.color = `mix(var(--base-color), var(--bright-color), ${brightnessIntensity})`;
        filterIconTop.style.transform = `translateX(-50%) scale(${1.0 + brightnessIntensity * 0.2})`;
        const bottomIntensity = Math.max(Math.abs(contrast), Math.abs(saturation), Math.abs(fade));
        filterIconBottom.style.color = `mix(var(--base-color), var(--saturation-color), ${bottomIntensity})`;
        filterIconBottom.style.transform = `translateX(-50%) scale(${1.0 + bottomIntensity * 0.2})`;
        const hueShiftIntensity = Math.abs(hue_shift);
        filterIconLeft.style.color = `mix(var(--base-color), var(--cool-color), ${hueShiftIntensity})`;
        filterIconLeft.style.transform = `translateY(-50%) scale(${1.0 + hueShiftIntensity * 0.2})`;
        const tempIntensity = Math.abs(temp);
        filterIconRight.style.color = `mix(var(--base-color), var(--warm-color), ${tempIntensity})`;
        filterIconRight.style.transform = `translateY(-50%) scale(${1.0 + tempIntensity * 0.2})`;
    }

    function render() {
        if (state.isCameraMode && video.readyState >= 2) {
            gl.bindTexture(gl.TEXTURE_2D, state.texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
        } else if (!state.isCameraMode && state.originalImage) {
            gl.bindTexture(gl.TEXTURE_2D, state.texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, state.originalImage);
        }

        const { brightness, temp, contrast, saturation, fade, hue_shift } = state.filterValues;
        gl.uniform1f(brightnessLocation, brightness);
        gl.uniform1f(tempLocation, temp);
        gl.uniform1f(contrastLocation, contrast);
        gl.uniform1f(saturationLocation, saturation);
        gl.uniform1f(fadeLocation, fade);
        gl.uniform1f(hueShiftLocation, hue_shift);
        
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        
        if (state.isCapturing) {
            captureFrame();
            state.isCapturing = false;
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

    // タッチイベントハンドラの改善
    function handleStart(e) {
        const targetTagName = e.target.tagName.toLowerCase();
        if (targetTagName === 'button' || targetTagName === 'svg' || targetTagName === 'path') {
            return;
        }
        state.isTouching = true;
        handleMove(e);
    }
    
    function handleMove(e) {
        if (!state.isTouching) return;

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
        const dx = x - circleCenterX;
        const dy = y - circleCenterY;
        const distFromCenter = Math.sqrt(dx * dx + dy * dy);

        if (distFromCenter <= circleRadius) {
            state.touchPoint = { x, y };
        } else {
            const angle = Math.atan2(dy, dx);
            const clampedX = circleCenterX + circleRadius * Math.cos(angle);
            const clampedY = circleCenterY + circleRadius * Math.sin(angle);
            state.touchPoint = { x: clampedX, y: clampedY };
        }
        
        touchIndicator.style.left = `${state.touchPoint.x}px`;
        touchIndicator.style.top = `${state.touchPoint.y}px`;
        touchIndicator.style.opacity = 1;

        const normalizedX = (state.touchPoint.x - circleCenterX) / circleRadius;
        const normalizedY = (state.touchPoint.y - circleCenterY) / circleRadius;
        
        state.filterValues.brightness = -normalizedY;
        state.filterValues.temp = normalizedX;
        const clampedDistFromCenter = Math.min(distFromCenter / circleRadius, 1.0); 
        state.filterValues.contrast = clampedDistFromCenter;
        state.filterValues.saturation = clampedDistFromCenter;
        state.filterValues.fade = clampedDistFromCenter * 0.5;
        state.filterValues.hue_shift = normalizedX * 0.5;

        updateFilterIcons(state.filterValues);
        
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
        state.isTouching = false;
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
        state.filterValues = { brightness: 0.0, temp: 0.0, contrast: 0.0, saturation: 0.0, fade: 0.0, hue_shift: 0.0 };
        updateFilterIcons(state.filterValues);
    });
    window.dispatchEvent(new Event('resize'));

    function updateModeUI() {
        if (state.isCameraMode) {
            modeToggleBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v16H4z"/><path d="M9 12h6"/><path d="M12 9v6"/></svg>';
            modeToggleBtn.setAttribute('title', '写真編集モード');
            shutterBtn.classList.remove('hidden');
            saveBtn.classList.add('hidden');
            cameraSwitchBtn.classList.remove('hidden');
            imageUpload.classList.add('hidden-file-input');
            startCamera();
        } else {
            modeToggleBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>';
            modeToggleBtn.setAttribute('title', 'リアルタイム撮影モード');
            shutterBtn.classList.add('hidden');
            saveBtn.classList.remove('hidden');
            cameraSwitchBtn.classList.add('hidden');
            imageUpload.classList.remove('hidden-file-input');
            imageUpload.click();
        }
        state.filterValues = { brightness: 0.0, temp: 0.0, contrast: 0.0, saturation: 0.0, fade: 0.0, hue_shift: 0.0 };
        updateFilterIcons(state.filterValues);
    }

    modeToggleBtn.addEventListener('click', () => {
        state.isCameraMode = !state.isCameraMode;
        updateModeUI();
    });
    
    cameraSwitchBtn.addEventListener('click', () => {
        state.currentFacingMode = (state.currentFacingMode === 'user') ? 'environment' : 'user';
        startCamera();
    });

    imageUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    state.originalImage = img;
                    gl.bindTexture(gl.TEXTURE_2D, state.texture);
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, state.originalImage);
                    render();
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
        } else {
            state.isCameraMode = true;
            updateModeUI();
        }
    });

    shutterBtn.addEventListener('click', () => {
        if (state.isCameraMode) {
            state.isCapturing = true;
        }
    });
    
    saveBtn.addEventListener('click', () => {
        if (!state.isCameraMode) {
            state.isCapturing = true;
        }
    });
    
    // 初回起動時のUI設定
    updateModeUI();
});
