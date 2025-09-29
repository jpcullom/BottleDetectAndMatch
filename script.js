document.addEventListener('DOMContentLoaded', async () => {
    const imageInput = document.getElementById('imageInput');
    const processBtn = document.getElementById('processBtn');
    const imagePairsContainer = document.getElementById('imagePairs');
    const outputContainer = document.getElementById('outputContainer');

    let uploadedImages = [];
    let model;

    // Load COCO-SSD model
    try {
        model = await cocoSsd.load();
        console.log('Object detection model loaded successfully');
    } catch (error) {
        console.error('Error loading object detection model:', error);
    }

    // Handle image upload
    imageInput.addEventListener('change', (e) => {
        const files = Array.from(e.target.files);
        uploadedImages = [];
        imagePairsContainer.innerHTML = '';
        
        // Process each file
        files.forEach((file, index) => {
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    uploadedImages.push(img);
                    // If we have an even number of images, create a new pair preview
                    if (uploadedImages.length % 2 === 0) {
                        const pairIndex = Math.floor((uploadedImages.length - 1) / 2);
                        createPairPreview(
                            uploadedImages[uploadedImages.length - 2],
                            uploadedImages[uploadedImages.length - 1],
                            pairIndex
                        );
                    }
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
        });
    });

    // Create preview for a pair of images
    function createPairPreview(img1, img2, index) {
        const pairContainer = document.createElement('div');
        pairContainer.className = 'pair-container';
        pairContainer.innerHTML = `
            <h3>Pair ${index + 1}</h3>
            <div class="pair-preview">
                <img src="${img1.src}" alt="First image of pair ${index + 1}">
                <img src="${img2.src}" alt="Second image of pair ${index + 1}">
            </div>
        `;
        imagePairsContainer.appendChild(pairContainer);
    }

    // Function to detect objects in an image and get the main object's position
    async function detectMainObject(img) {
        try {
            const predictions = await model.detect(img);
            if (predictions && predictions.length > 0) {
                // Get the prediction with highest confidence
                const mainObject = predictions.reduce((prev, current) => 
                    (prev.score > current.score) ? prev : current
                );
                return {
                    x: mainObject.bbox[0],
                    y: mainObject.bbox[1],
                    width: mainObject.bbox[2],
                    height: mainObject.bbox[3],
                    centerX: mainObject.bbox[0] + mainObject.bbox[2] / 2,
                    centerY: mainObject.bbox[1] + mainObject.bbox[3] / 2,
                    class: mainObject.class,
                    score: mainObject.score
                };
            }
            return null;
        } catch (error) {
            console.error('Error detecting objects:', error);
            return null;
        }
    }

    // Splice images when button is clicked
    processBtn.addEventListener('click', async () => {
        if (uploadedImages.length < 2) {
            alert('Please upload at least 2 images');
            return;
        }

        outputContainer.innerHTML = ''; // Clear previous results

        // Process each pair of images
        for (let i = 0; i < uploadedImages.length - 1; i += 2) {
            const img1 = uploadedImages[i];
            const img2 = uploadedImages[i + 1];

            // Create temporary canvases for object detection
            const tempCanvas1 = document.createElement('canvas');
            const tempCanvas2 = document.createElement('canvas');
            const tempCtx1 = tempCanvas1.getContext('2d');
            const tempCtx2 = tempCanvas2.getContext('2d');

            // Set dimensions and draw images
            tempCanvas1.width = img1.width;
            tempCanvas1.height = img1.height;
            tempCanvas2.width = img2.width;
            tempCanvas2.height = img2.height;
            tempCtx1.drawImage(img1, 0, 0);
            tempCtx2.drawImage(img2, 0, 0);

            // Detect objects in both images
            const object1 = await detectMainObject(tempCanvas1);
            const object2 = await detectMainObject(tempCanvas2);

            // Create final canvas for this pair
            const resultContainer = document.createElement('div');
            resultContainer.className = 'spliced-result';
            resultContainer.innerHTML = `<h3>Spliced Pair ${Math.floor(i/2) + 1}</h3>`;
            
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            // Calculate dimensions maintaining aspect ratio
            const baseWidth = 1200; // Base width for consistent output
            const halfWidth = baseWidth / 2;
            
            // Calculate optimal heights based on original aspect ratios
            const aspect1 = img1.height / img1.width;
            const aspect2 = img2.height / img2.width;
            const height1 = halfWidth * aspect1;
            const height2 = halfWidth * aspect2;
            
            // Use the larger height for the canvas
            const outputHeight = Math.max(height1, height2);
            canvas.width = baseWidth;
            canvas.height = outputHeight;

            // Function to calculate drawing parameters with zoom
            const getDrawParameters = (img, object, isFirstImage) => {
                const halfWidth = canvas.width / 2;
                const targetAspectRatio = img.height / img.width;
                const targetHeight = halfWidth * targetAspectRatio;

                if (!object) {
                    return {
                        x: isFirstImage ? 0 : halfWidth,
                        y: (canvas.height - targetHeight) / 2, // Center vertically
                        width: halfWidth,
                        height: targetHeight,
                        sx: 0,
                        sy: 0,
                        sWidth: img.width,
                        sHeight: img.height
                    };
                }

                // Calculate zoom factor (make objects take up about 40% of their half)
                const targetObjectWidth = halfWidth * 0.3;
                const zoomFactor = targetObjectWidth / object.width;

                // Calculate the visible area around the object
                const visibleWidth = halfWidth / zoomFactor;
                const visibleHeight = targetHeight / zoomFactor;

                // Calculate source (original image) cropping
                const sx = Math.max(0, Math.min(
                    object.centerX - visibleWidth / 2,
                    img.width - visibleWidth
                ));
                const sy = Math.max(0, Math.min(
                    object.centerY - visibleHeight / 2,
                    img.height - visibleHeight
                ));
                const sWidth = Math.min(img.width - sx, visibleWidth);
                const sHeight = Math.min(img.height - sy, visibleHeight);

                // Calculate destination position
                const x = isFirstImage ? 0 : halfWidth;
                const y = (canvas.height - targetHeight) / 2; // Center vertically
                const width = halfWidth;
                const height = targetHeight;

                return { x, y, width, height, sx, sy, sWidth, sHeight };
            };

            // Draw the images with zoom effect
            const params1 = getDrawParameters(img1, object1, true);
            const params2 = getDrawParameters(img2, object2, false);

            // Clear canvas with white background
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Draw both images with their calculated parameters
            ctx.drawImage(
                img1,
                params1.sx, params1.sy, params1.sWidth, params1.sHeight,  // source rectangle
                params1.x, params1.y, params1.width, params1.height       // destination rectangle
            );
            ctx.drawImage(
                img2,
                params2.sx, params2.sy, params2.sWidth, params2.sHeight,  // source rectangle
                params2.x, params2.y, params2.width, params2.height       // destination rectangle
            );

            // Apply brightness effect
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            const brightnessAdjustment = 35; // Adjust this value to control brightness (0-255)

            for (let i = 0; i < data.length; i += 4) {
                // Increase RGB values while keeping them within valid range (0-255)
                data[i] = Math.min(255, data[i] + brightnessAdjustment);     // Red
                data[i + 1] = Math.min(255, data[i + 1] + brightnessAdjustment); // Green
                data[i + 2] = Math.min(255, data[i + 2] + brightnessAdjustment); // Blue
                // data[i + 3] is Alpha (unchanged)
            }

            ctx.putImageData(imageData, 0, 0);

            resultContainer.appendChild(canvas);
            outputContainer.appendChild(resultContainer);
        }
    });
});