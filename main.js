// main.js の先頭部分
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
    const filterRectangle = document.getElementById('filter-rectangle'); // IDを更新
    const filterIconTop = document.getElementById('filter-icon-top');
    const filterIconBottom = document.getElementById('filter-icon-bottom');
    const filterIconLeft = document.getElementById('filter-icon-left');
    const filterIconRight = document.getElementById('filter-icon-right');
    
    // ... (中略) ...
    
    // イベントリスナー
    // ⭐ 変更点: filterRectangleにイベントリスナーを設定
    filterRectangle.addEventListener('mousedown', handleStart);
    filterRectangle.addEventListener('mousemove', handleMove);
    filterRectangle.addEventListener('mouseup', handleEnd);
    filterRectangle.addEventListener('mouseleave', handleEnd);
    filterRectangle.addEventListener('touchstart', handleStart, { passive: false });
    filterRectangle.addEventListener('touchmove', handleMove, { passive: false });
    filterRectangle.addEventListener('touchend', handleEnd);
    
    // ... (残りのコードは変更なし) ...
});
