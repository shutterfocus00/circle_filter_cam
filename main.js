document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('gl-canvas');
    const video = document.getElementById('video-feed');
    const modeToggleBtn = document.getElementById('mode-toggle-btn');
    const shutterBtn = document.getElementById('shutter-btn');
    const saveBtn = document.getElementById('save-btn');
    const imageUpload = document.getElementById('image-upload');
    const gl = canvas.getContext('webgl');

    let isCameraMode = true;
    let originalImage = null;
    let mousePos = { x: 0.5, y: 0.5 };
    let texture = null;

    if (!gl) {
        alert('WebGLがサポートされていません。');
        return;
    }

    // シェーダーソースコード
    const vsSource = `
        attribute vec4 a_position;
        void main() {
            gl_Position = a_position;
        }
    `;

    const fsSource = `
        precision mediump float;
        uniform sampler2D u_image;
        uniform vec2 u_resolution;
        uniform vec2 u_mouse_pos;
        
        void main() {
            vec2 normalized_coord = gl_FragCoord.xy / u_resolution;
            vec2 center_pos = u_mouse_pos;
            
            vec2 direction = normalized_coord - center_pos;
            float dist_from_center = length(direction);
            
            vec4 original_color = texture2D(u_image, normalized_coord);
            vec4 final_color = original_color;
            
            float max_dist = 0.5; // サークルの最大半径
            
            if (dist_from_center < max_dist) {
                // 💡 修正点1: フィルターの強度を計算
                // 中心で0、マウス位置で100%になるように調整
                float effect_strength = dist_from_center / max_dist;
                
                // 💡 修正点2: 方向に基づいたフィルターの調整
                // 上下方向: 明るさ調整
                float brightness_factor = -direction.y * effect_strength;
                // 左右方向: 色温度調整
                float temp_factor = direction.x * effect_strength;
                
                // 明るさ調整: ガンマ補正を模倣し、より自然な明るさ変化に
                float gamma = 1.0 + brightness_factor * 2.0;
                final_color.rgb = pow(final_color.rgb, vec3(1.0 / gamma));

                // 色温度調整: RGB値を直接操作
                vec3 temp_adjust = vec3(0.0);
                if (temp_factor > 0.0) { // 暖色
                    temp_adjust = vec3(0.15, 0.0, -0.15) * temp_factor;
                } else { // 寒色
                    temp_adjust = vec3(0.15, 0.0, -0.15) * -temp_factor;
                }
                final_color.rgb += temp_adjust;

                // 💡 修正点3: コントラストと彩度を強調し「かかってる感」を出す
                float contrast = 1.0 + effect_strength * 0.5;
                final_color.rgb = (final_color.rgb - 0.5) * contrast + 0.5;
                
                float saturation = 1.0 + effect_strength * 0.3;
                float luma = dot(final_color.rgb, vec3(0.299, 0.587, 0.114));
                final_color.rgb = mix(vec3(luma), final_color.rgb, saturation);
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
    const resolutionLocation = gl.getUniformLocation(program, 'u_resolution');
    const mousePosLocation = gl.getUniformLocation(program, 'u_mouse_pos');
    
    texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

    function startCamera() {
        navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } })
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
        }
        
        gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
        gl.uniform2f(mousePosLocation, mousePos.x, mousePos.y);
        
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        requestAnimationFrame(render);
    }
    
    canvas.addEventListener('mousemove', (e) => {
        mousePos.x = e.offsetX / canvas.width;
        mousePos.y = 1.0 - (e.offsetY / canvas.height);
    });
    
    // ウィンドウサイズ変更時にキャンバスをリサイズ
    window.addEventListener('resize', () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        gl.viewport(0, 0, canvas.width, canvas.height);
    });
    window.dispatchEvent(new Event('resize')); // 初回実行

    modeToggleBtn.addEventListener('click', () => {
        isCameraMode = !isCameraMode;
        if (isCameraMode) {
            modeToggleBtn.textContent = '写真編集モード';
            shutterBtn.classList.remove('hidden');
            saveBtn.classList.add('hidden');
            imageUpload.classList.add('hidden');
            startCamera();
        } else {
            modeToggleBtn.textContent = 'リアルタイム撮影モード';
            shutterBtn.classList.add('hidden');
            saveBtn.classList.remove('hidden');
            imageUpload.click();
        }
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
        const finalCanvas = document.createElement('canvas');
        const finalCtx = finalCanvas.getContext('2d');
        finalCanvas.width = video.videoWidth;
        finalCanvas.height = video.videoHeight;
        
        finalCtx.drawImage(video, 0, 0, finalCanvas.width, finalCanvas.height);
        
        const dataURL = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.href = dataURL;
        link.download = `photo_${Date.now()}.png`;
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
