document.addEventListener('DOMContentLoaded', () => {
    // Elements
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const canvas = document.getElementById('pixel-canvas');
    const ctx = canvas.getContext('2d');
    const controls = document.getElementById('controls');

    // Sliders
    const resSlider = document.getElementById('resolution-slider');
    const resValue = document.getElementById('resolution-value');
    const paletteSlider = document.getElementById('palette-slider');
    const paletteValue = document.getElementById('palette-value');
    const detailSlider = document.getElementById('detail-slider');
    const detailValue = document.getElementById('detail-value');

    // Buttons
    const downloadBtn = document.getElementById('download-btn');

    // State
    let originalImage = new Image();
    let isImageLoaded = false;

    // Resolutions map (Power of 2s)
    const getResolution = (val) => Math.pow(2, 4 + parseInt(val));

    // --- Event Listeners ---

    // File Input
    dropZone.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            loadImage(e.target.files[0]);
        }
    });

    // Drag & Drop
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            loadImage(e.dataTransfer.files[0]);
        }
    });

    // Controls
    resSlider.addEventListener('input', () => {
        const size = getResolution(resSlider.value);
        resValue.textContent = `${size} px`;
        if (isImageLoaded) processImage();
    });

    paletteSlider.addEventListener('input', () => {
        paletteValue.textContent = `${paletteSlider.value} Colors`;
        if (isImageLoaded) processImage();
    });

    detailSlider.addEventListener('input', () => {
        detailValue.textContent = `${detailSlider.value}%`;
        if (isImageLoaded) processImage();
    });

    downloadBtn.addEventListener('click', downloadImage);

    // --- Core Functions ---

    function loadImage(file) {
        if (!file.type.match('image.*')) {
            alert('Please select an image file!');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            originalImage = new Image();
            originalImage.onload = () => {
                isImageLoaded = true;
                dropZone.classList.add('has-image');
                controls.classList.remove('disabled');

                // Initialize labels
                const size = getResolution(resSlider.value);
                resValue.textContent = `${size} px`;
                paletteValue.textContent = `${paletteSlider.value} Colors`;
                detailValue.textContent = `${detailSlider.value}%`;

                processImage();
            };
            originalImage.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    function processImage() {
        if (!isImageLoaded) return;

        // 1. Determine dimensions
        const targetWidth = getResolution(resSlider.value);
        const aspectRatio = originalImage.height / originalImage.width;
        const targetHeight = Math.round(targetWidth * aspectRatio);

        // Resize Canvas to small pixel art size
        canvas.width = targetWidth;
        canvas.height = targetHeight;

        // 2. Draw scaled down (Raw pixels)
        // disable smoothing to get hard edges
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(originalImage, 0, 0, targetWidth, targetHeight);

        // 3. Apply Detail / Sharpening (Optional)
        // We do this BEFORE quantization to help the quantizer pick up edges
        const sharpenAmount = parseInt(detailSlider.value) / 100;
        if (sharpenAmount > 0) {
            sharpenCanvas(ctx, targetWidth, targetHeight, sharpenAmount);
        }

        // 4. Apply Palette Quantization
        const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
        const quantizedData = quantizeImage(imageData, parseInt(paletteSlider.value));

        ctx.putImageData(quantizedData, 0, 0);
    }

    // Simple Unsharp Mask
    function sharpenCanvas(ctx, w, h, amount) {
        const imageData = ctx.getImageData(0, 0, w, h);
        const data = imageData.data;
        const copy = new Uint8ClampedArray(data);

        // Convolution kernel for highlighting edges
        //  0 -1  0
        // -1  5 -1
        //  0 -1  0
        // This is a basic sharpen kernel. 
        // We'll just manually apply a "pixel - neighbor" diff.

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const idx = (y * w + x) * 4;

                // Get neighbors (clamped)
                const up = ((Math.max(0, y - 1) * w) + x) * 4;
                const down = ((Math.min(h - 1, y + 1) * w) + x) * 4;
                const left = (y * w + Math.max(0, x - 1)) * 4;
                const right = (y * w + Math.min(w - 1, x + 1)) * 4;

                // Apply separate RGB channels
                for (let c = 0; c < 3; c++) {
                    const val = copy[idx + c];
                    // Simple Laplacian approximation
                    const neighborAvg = (copy[up + c] + copy[down + c] + copy[left + c] + copy[right + c]) * 0.25;
                    const diff = val - neighborAvg;

                    // Add difference back to original (Unsharp Mask)
                    data[idx + c] = Math.min(255, Math.max(0, val + diff * amount * 4));
                    // Multiplier * 4 makes the slider more impactful
                }
            }
        }
        ctx.putImageData(imageData, 0, 0);
    }

    // --- K-Means Clustering for Palette Quantization ---
    // This finds the 'k' best representative colors and snaps every pixel to one of them.
    function quantizeImage(imageData, k) {
        const data = imageData.data; // [r, g, b, a, r, g, b, a...]
        const pixelCount = data.length / 4;
        const pixels = [];

        // 1. Collect all pixels (ignore fully transparent ones)
        for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] < 128) continue; // Skip transparency
            pixels.push([data[i], data[i + 1], data[i + 2]]);
        }

        if (pixels.length === 0) return imageData;

        // 2. Sample K random pixels as initial centroids
        // Or better: use k-means++-ish approach (pick spaced out colors).
        // For speed in JS, random sample is okay-ish but can be unstable.
        // Let's just pick strictly random pixels to start.
        let centroids = [];
        for (let i = 0; i < k; i++) {
            centroids.push(pixels[Math.floor(Math.random() * pixels.length)]);
        }

        // 3. K-Means Iterations (Run 5-10 times for speed)
        // More iterations = better palette but slower. 5 is usually enough for visual approximation.
        const iterations = 5;

        for (let iter = 0; iter < iterations; iter++) {
            // Assign pixels to nearest centroid
            const clusters = new Array(k).fill(0).map(() => ({ r: 0, g: 0, b: 0, count: 0 }));

            for (let p of pixels) {
                let minDist = Infinity;
                let closestIndex = 0;

                // Find nearest centroid
                for (let j = 0; j < k; j++) {
                    const c = centroids[j];
                    // Euclidean distance squared
                    const dist = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
                    if (dist < minDist) {
                        minDist = dist;
                        closestIndex = j;
                    }
                }

                // Add to cluster sum
                clusters[closestIndex].r += p[0];
                clusters[closestIndex].g += p[1];
                clusters[closestIndex].b += p[2];
                clusters[closestIndex].count++;
            }

            // Recalculate centroids
            for (let j = 0; j < k; j++) {
                if (clusters[j].count > 0) {
                    centroids[j] = [
                        clusters[j].r / clusters[j].count,
                        clusters[j].g / clusters[j].count,
                        clusters[j].b / clusters[j].count
                    ];
                } else {
                    // Re-initialize empty cluster with random pixel
                    centroids[j] = pixels[Math.floor(Math.random() * pixels.length)];
                }
            }
        }

        // 4. Map entire image to finalized centroids
        for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] < 128) continue;

            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            let minDist = Infinity;
            let bestColor = centroids[0];

            for (let j = 0; j < k; j++) {
                const c = centroids[j];
                const dist = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2;
                if (dist < minDist) {
                    minDist = dist;
                    bestColor = c;
                }
            }

            data[i] = bestColor[0];
            data[i + 1] = bestColor[1];
            data[i + 2] = bestColor[2];
            // Leave Alpha (i+3) alone
        }

        return imageData;
    }

    function downloadImage() {
        if (!isImageLoaded) return;

        const scaleFactor = 20; // Big upscale for nice crispy pixels
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width * scaleFactor;
        tempCanvas.height = canvas.height * scaleFactor;
        const tCtx = tempCanvas.getContext('2d');

        tCtx.imageSmoothingEnabled = false;
        tCtx.drawImage(canvas, 0, 0, tempCanvas.width, tempCanvas.height);

        const link = document.createElement('a');
        link.download = 'pixi-art.png';
        link.href = tempCanvas.toDataURL('image/png');
        link.click();
    }
});
