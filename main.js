document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('gl-canvas');
    const video = document.getElementById('video-feed');
    const modeToggleBtn = document.getElementById('mode-toggle-btn');
    const cameraSwitchBtn = document.getElementById('camera-switch-btn');
    const shutterBtn = document.getElementById('shutter-btn');
    const saveBtn = document.getElementById('save-btn');
    const imageUpload = document.getElementById('image-upload');
    const touchIndicator = document.getElementById('touch-indicator');
    const gl = canvas.getContext('webgl');

    let isCameraMode = true;
    let currentFacingMode = 'user'; // 'user' はインカメラ, 'environment' は外カメラ
    let originalImage = null;
    let mousePos = { x: 0.5, y: 0.5 };
    let texture = null;

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
        varying vec2 v_texCoord;
        
        void main() {
            vec2 texCoord = vec2(v_texCoord.x, 1.0 - v_texCoord.y);
            vec4 original_color = texture2D(u_image, texCoord);
            vec4 final_color = original_color;

            // 明るさ調整
            float gamma = 1.0 + u_brightness * 2.0;
            final_color.rgb = pow(final_color.rgb, vec3(1.0 / gamma));

            // 色温度調整
            vec3 temp_adjust = vec3(0.0);
            if (u_temp > 0.0) {
                temp_adjust = vec3(u_temp, 0.0, -u_temp);
            } else {
                temp_adjust = vec3(u_temp, 0.0, -u_temp);
            }
            final_color.rgb += temp_adjust;

            // コントラストと彩度を強調
            final_color.rgb = (final_color.rgb - 0.5) * u_contrast + 0.5;
            float luma = dot(final_color.rgb, vec3(0.299, 0.587, 0.114));
            final_color.rgb = mix(vec3(luma), final_color.rgb, u_saturation);

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
        
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const dist = Math.sqrt(Math.pow(mousePos.x * canvas.width - centerX, 2) + Math.pow((1 - mousePos.y) * canvas.height - centerY, 2));
        const maxDist = Math.min(centerX, centerY);
        const effectStrength = Math.min(dist / maxDist, 1.0);
        
        const directionY = ((1 - mousePos.y) * canvas.height - centerY) / maxDist;
        const directionX = (mousePos.x * canvas.width - centerX) / maxDist;

        gl.uniform1f(brightnessLocation, -directionY * effectStrength);
        gl.uniform1f(tempLocation, directionX * effectStrength);
        gl.uniform1f(contrastLocation, 1.0 + effectStrength * 0.5);
        gl.uniform1f(saturationLocation, 1.0 + effectStrength * 0.3);

        gl.drawArrays(gl.TRIANGLES, 0, 6);
        requestAnimationFrame(render);
    }
    
    function handleMove(e) {
        let x, y;
        if (e.touches) {
            x = e.touches[0].clientX;
            y = e.touches[0].clientY;
            touchIndicator.style.opacity = 1;
            touchIndicator.style.left = `${x}px`;
            touchIndicator.style.top = `${y}px`;
        } else {
            x = e.clientX;
            y = e.clientY;
            touchIndicator.style.opacity = 1;
            touchIndicator.style.left = `${x}px`;
            touchIndicator.style.top = `${y}px`;
        }
        mousePos.x = x / canvas.width;
        mousePos.y = 1.0 - (y / canvas.height);
    }

    function handleEnd() {
        touchIndicator.style.opacity = 0;
    }

    canvas.addEventListener('mousemove', handleMove);
    canvas.addEventListener('touchmove', handleMove);
    canvas.addEventListener('touchend', handleEnd);

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
        const dataURL = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.href = dataURL;
        link.download = `edited_photo_${Date.now()}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });
    
    saveBtn.addEventListener('click', () => {
        const dataURL = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.href = dataURL;
        link.download = `edited_photo_${Date.now()}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });

    startCamera();
});
