// Debug logging function
function debug(message, data = null) {
    const timestamp = new Date().toISOString();
    if (data) {
        console.log(`[${timestamp}] ${message}:`, data);
    } else {
        console.log(`[${timestamp}] ${message}`);
    }
}

// Global variables for DOM elements
let imageInput, processBtn, imagePairsContainer, outputContainer, loadingOverlay, processingModeToggle, modeText;

// Processing mode flag
let singleImageMode = false;

// Create and initialize the worker
let imageWorker = null;

// Function to show/hide loading overlay
function setLoading(isLoading) {
    if (!loadingOverlay) {
        loadingOverlay = document.getElementById('loadingOverlay');
    }
    if (loadingOverlay) {
        loadingOverlay.style.display = isLoading ? 'flex' : 'none';
        debug(`Loading overlay ${isLoading ? 'shown' : 'hidden'}`);
    } else {
        debug('Warning: Loading overlay element not found');
    }
}

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

// Create preview for a single image
function createSinglePreview(img, index) {
    const singleContainer = document.createElement('div');
    singleContainer.className = 'single-container';
    singleContainer.innerHTML = `
        <h3>Image ${index + 1}</h3>
        <div class="single-preview">
            <img src="${img.src}" alt="Image ${index + 1}">
        </div>
    `;
    imagePairsContainer.appendChild(singleContainer);
}

async function initializeWorker() {
    imageWorker = new Worker('imageWorker.js');
    
    imageWorker.onmessage = function(e) {
        const { type, data, error, imageData } = e.data;
        
        switch(type) {
            case 'modelLoaded':
                debug('Worker model loaded successfully');
                break;
                
            case 'debug':
                if (data.message) {
                    debug('Detection Debug:', data.message);
                } else if (data.image1 && data.image2) {
                    debug('Object Detection Results:', {
                        image1: {
                            dimensions: data.image1.dimensions || 'unknown',
                            detectedObjects: data.image1.detections && data.image1.detections.length > 0
                                ? data.image1.detections
                                    .map(d => `${d.class} (${(d.score * 100).toFixed(1)}%)`)
                                    .join(', ')
                                : 'no objects detected'
                        },
                        image2: {
                            dimensions: data.image2.dimensions || 'unknown',
                            detectedObjects: data.image2.detections && data.image2.detections.length > 0
                                ? data.image2.detections
                                    .map(d => `${d.class} (${(d.score * 100).toFixed(1)}%)`)
                                    .join(', ')
                                : 'no objects detected'
                        }
                    });
                } else if (data.image1) {
                    debug('Single Image Detection Results:', {
                        image1: {
                            dimensions: data.image1.dimensions || 'unknown',
                            detectedObjects: data.image1.detections && data.image1.detections.length > 0
                                ? data.image1.detections
                                    .map(d => `${d.class} (${(d.score * 100).toFixed(1)}%)`)
                                    .join(', ')
                                : 'no objects detected'
                        }
                    });
                }
                break;
                
            case 'processed':
                handleProcessedImage(imageData);
                processedPairs++;
                
                if (singleImageMode) {
                    debug(`Processed image ${processedPairs} of ${totalPairsToProcess} (${uploadedImages.length} total images available)`);
                } else {
                    debug(`Processed pair ${processedPairs} of ${totalPairsToProcess} (${uploadedImages.length} total images available)`);
                }
                
                if (processedPairs >= totalPairsToProcess) {
                    debug(`All ${singleImageMode ? 'images' : 'pairs'} processed successfully`);
                    isProcessing = false;
                    setLoading(false);
                }
                break;
                
            case 'error':
                console.error('Worker error:', error);
                const errorLines = error.split('Image');
                debug('Detection failure details:', {
                    image1: errorLines[1]?.trim(),
                    image2: errorLines[2]?.trim()
                });
                alert('Error processing images. Check console for details.');
                setLoading(false);
                break;
        }
    };

    imageWorker.onerror = function(error) {
        console.error('Worker error:', error);
        alert('Error in image processing worker');
        setLoading(false);
    };

    // Initialize the model in the worker
    imageWorker.postMessage({ type: 'init' });
}

function handleProcessedImage(imageData) {
    // Create a canvas to display the result
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const ctx = canvas.getContext('2d');
    
    // Convert the array buffer back to Uint8ClampedArray
    const uint8Array = new Uint8ClampedArray(imageData.data);
    const processedImageData = new ImageData(uint8Array, imageData.width, imageData.height);
    
    // Draw the processed image
    ctx.putImageData(processedImageData, 0, 0);
    
    // Create container and add canvas
    const resultContainer = document.createElement('div');
    resultContainer.className = 'result-container';
    resultContainer.appendChild(canvas);
    outputContainer.appendChild(resultContainer);
}

// Helper function to load an image
function loadImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('Failed to load image'));
            img.src = event.target.result;
        };
        
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
}

// Global state variables
let uploadedImages = [];
let processedPairs = 0;
let totalPairsToProcess = 0;
let isProcessing = false;

// Function to handle image upload and preview
function setupImageUpload() {
    // Initialize DOM element references
    imageInput = document.getElementById('imageInput');
    processBtn = document.getElementById('processBtn');
    imagePairsContainer = document.getElementById('imagePairs');
    outputContainer = document.getElementById('outputContainer');

    // Track upload processing state
    let isProcessingUpload = false;
    let uploadCounter = 0;

    // Remove any existing listeners
    const newImageInput = imageInput.cloneNode(true);
    imageInput.parentNode.replaceChild(newImageInput, imageInput);
    imageInput = newImageInput;

    // Handle image upload with debounce
    imageInput.addEventListener('change', async (e) => {
        const currentUpload = ++uploadCounter;
        debug(`Change event fired. Upload #${currentUpload}`);
        
        // Prevent duplicate processing
        if (isProcessingUpload) {
            debug(`Skipping upload #${currentUpload} - already processing`);
            return;
        }
        
        isProcessingUpload = true;
        debug(`Starting upload #${currentUpload}`);
        
        try {
            const files = Array.from(e.target.files);
            debug('Files selected:', files.length);
            
            // Reset state
            uploadedImages = [];
            imagePairsContainer.innerHTML = '';
            
            debug(`Processing ${files.length} files for upload #${currentUpload}`);
            
            // Create array of promises for loading images
            const imagePromises = files.map((file, index) => {
                return new Promise(async (resolve, reject) => {
                    try {
                        debug(`[Upload #${currentUpload}] Loading file ${index}: ${file.name}`);
                        const img = await loadImage(file);
                        debug(`[Upload #${currentUpload}] Successfully loaded file ${index}: ${file.name}`);
                        resolve({ index, img });
                    } catch (error) {
                        debug(`[Upload #${currentUpload}] Error loading file ${index}: ${file.name}`, error);
                        reject(error);
                    }
                });
            });
            
            debug(`[Upload #${currentUpload}] Waiting for all images to load...`);
            const results = await Promise.all(imagePromises);
            
            // Verify this is still the current upload
            if (currentUpload !== uploadCounter) {
                debug(`[Upload #${currentUpload}] Aborted - newer upload in progress`);
                return;
            }
            
            debug(`[Upload #${currentUpload}] All images loaded, sorting...`);
            results.sort((a, b) => a.index - b.index);
            
            debug(`[Upload #${currentUpload}] Storing images...`);
            if (!Array.isArray(results)) {
                debug(`[Upload #${currentUpload}] ERROR: results is not an array`);
                return;
            }
            uploadedImages = results.map(r => r.img).filter(img => img instanceof HTMLImageElement);
            debug(`[Upload #${currentUpload}] Stored ${uploadedImages.length} valid images`);
            debug(`[Upload #${currentUpload}] First image details:`, uploadedImages[0] ? {
                width: uploadedImages[0].width,
                height: uploadedImages[0].height,
                src: uploadedImages[0].src.substring(0, 50) + '...'
            } : 'No valid images');
            
            debug(`[Upload #${currentUpload}] Creating previews...`);
            imagePairsContainer.innerHTML = ''; // Clear existing previews
            
            if (singleImageMode) {
                // Create individual image previews
                for (let i = 0; i < uploadedImages.length; i++) {
                    debug(`[Upload #${currentUpload}] Creating preview for image ${i}`);
                    createSinglePreview(uploadedImages[i], i);
                }
            } else {
                // Create pair previews
                const pairCount = Math.floor(uploadedImages.length / 2);
                for (let i = 0; i < pairCount; i++) {
                    debug(`[Upload #${currentUpload}] Creating preview for pair ${i}`);
                    createPairPreview(
                        uploadedImages[i * 2],
                        uploadedImages[i * 2 + 1],
                        i
                    );
                }
            }
            
            debug(`[Upload #${currentUpload}] Upload processing complete`);
        } catch (error) {
            console.error('Error processing images:', error);
        } finally {
            isProcessingUpload = false;
        }
    });

    // Helper function to load an image
    function loadImage(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = () => reject(new Error('Failed to load image'));
                img.src = event.target.result;
            };
            
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsDataURL(file);
        });
    }

    // Process handler function
    const handleProcess = async () => {
        debug('-------- Raw Process Button Click --------');
        if (!uploadedImages) {
            debug('WARNING: uploadedImages is undefined or null');
        } else {
            debug(`uploadedImages array length: ${uploadedImages.length}`);
            if (uploadedImages.length > 0) {
                debug('First image source:', uploadedImages[0]?.src?.substring(0, 50) + '...');
            }
        }
        
        try {
            debug('-------- Starting Process Attempt --------');
            debug(`Processing state before checks: isProcessing=${isProcessing}`);
            
            // Set processing flag immediately
            if (isProcessing) {
                debug('Already processing images, ignoring click');
                return;
            }
            isProcessing = true;
            debug('Set isProcessing flag to true');
            
            debug(`Current state: ${uploadedImages?.length || 0} images, processing=${isProcessing}`);
            
            if (!uploadedImages || !Array.isArray(uploadedImages)) {
                debug('Error: uploadedImages is not a valid array');
                isProcessing = false;
                alert(`Please upload at least ${singleImageMode ? '1 image' : '2 images'}`);
                return;
            }
            
            const minImages = singleImageMode ? 1 : 2;
            if (uploadedImages.length < minImages) {
                debug(`Error: Not enough images uploaded (found ${uploadedImages.length})`);
                debug('Current images state:', {
                    length: uploadedImages.length,
                    hasValidImages: uploadedImages.every(img => img instanceof HTMLImageElement)
                });
                isProcessing = false;
                alert(`Please upload at least ${minImages} image${minImages > 1 ? 's' : ''}`);
                return;
            }

            debug('Validation passed, proceeding with processing');
            await setLoading(true);
            outputContainer.innerHTML = '';
            
            // Reset the counter for processed items
            processedPairs = 0;
            
            if (singleImageMode) {
                totalPairsToProcess = uploadedImages.length;
                debug(`Starting to process ${totalPairsToProcess} individual images`);

                for (let i = 0; i < uploadedImages.length; i++) {
                    const img = uploadedImages[i];

                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

                    imageWorker.postMessage({
                        type: 'processSingle',
                        data: {
                            img: {
                                data: imageData.data.buffer,
                                width: canvas.width,
                                height: canvas.height
                            }
                        }
                    }, [imageData.data.buffer]);
                }
            } else {
                totalPairsToProcess = Math.floor(uploadedImages.length / 2);
                debug(`Starting to process ${totalPairsToProcess} pairs of images`);

                for (let i = 0; i < uploadedImages.length - 1; i += 2) {
                    const img1 = uploadedImages[i];
                    const img2 = uploadedImages[i + 1];

                    const canvas1 = document.createElement('canvas');
                    canvas1.width = img1.width;
                    canvas1.height = img1.height;
                    const ctx1 = canvas1.getContext('2d');
                    ctx1.drawImage(img1, 0, 0);
                    const imageData1 = ctx1.getImageData(0, 0, canvas1.width, canvas1.height);

                    const canvas2 = document.createElement('canvas');
                    canvas2.width = img2.width;
                    canvas2.height = img2.height;
                    const ctx2 = canvas2.getContext('2d');
                    ctx2.drawImage(img2, 0, 0);
                    const imageData2 = ctx2.getImageData(0, 0, canvas2.width, canvas2.height);

                    imageWorker.postMessage({
                        type: 'process',
                        data: {
                            img1: {
                                data: imageData1.data.buffer,
                                width: canvas1.width,
                                height: canvas1.height
                            },
                            img2: {
                                data: imageData2.data.buffer,
                                width: canvas2.width,
                                height: canvas2.height
                            }
                        }
                    }, [imageData1.data.buffer, imageData2.data.buffer]);
                }
            }
        } catch (error) {
            console.error('Error processing images:', error);
            setLoading(false);
            isProcessing = false;
            alert('An error occurred while processing the images');
            debug('Processing failed:', error);
        }
    };
    // Add click handler with simple cooldown
    let lastClickTime = 0;
    const CLICK_COOLDOWN = 1000; // 1 second cooldown between clicks
    
    processBtn.addEventListener('click', () => {
        const now = Date.now();
        debug('Process button raw click event');
        
        if (now - lastClickTime < CLICK_COOLDOWN) {
            debug('Click ignored - too soon after last click');
            return;
        }
        
        lastClickTime = now;
        handleProcess();
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    // Initialize DOM elements
    loadingOverlay = document.getElementById('loadingOverlay');
    imageInput = document.getElementById('imageInput');
    processingModeToggle = document.getElementById('processingModeToggle');
    modeText = document.getElementById('modeText');
    debug('DOM Content Loaded');
    
    // Setup mode toggle handler
    if (processingModeToggle && modeText) {
        processingModeToggle.addEventListener('change', () => {
            singleImageMode = processingModeToggle.checked;
            modeText.textContent = singleImageMode ? 'Single Mode' : 'Pair Mode';
            debug(`Processing mode changed to: ${singleImageMode ? 'Single' : 'Pair'} Mode`);
            
            // Clear existing previews when mode changes
            if (imagePairsContainer) {
                imagePairsContainer.innerHTML = '';
            }
            
            // Re-create previews if images are already loaded
            if (uploadedImages && uploadedImages.length > 0) {
                if (singleImageMode) {
                    for (let i = 0; i < uploadedImages.length; i++) {
                        createSinglePreview(uploadedImages[i], i);
                    }
                } else {
                    const pairCount = Math.floor(uploadedImages.length / 2);
                    for (let i = 0; i < pairCount; i++) {
                        createPairPreview(
                            uploadedImages[i * 2],
                            uploadedImages[i * 2 + 1],
                            i
                        );
                    }
                }
            }
        });
    }
    
    try {
        await initializeWorker();
        setupImageUpload();

    debug('Elements initialized:', {
        imageInput: !!imageInput,
        processBtn: !!processBtn,
        imagePairsContainer: !!imagePairsContainer,
        outputContainer: !!outputContainer
    });

    let model;

    // Load COCO-SSD model
    try {
        debug('Starting to load COCO-SSD model...');
        if (!cocoSsd) {
            throw new Error('cocoSsd is not defined - TensorFlow.js libraries may not be loaded properly');
        }
        model = await cocoSsd.load();
        debug('Object detection model loaded successfully');
    } catch (error) {
        debug('Error loading object detection model', error);
        console.error('Detailed error:', error);
        alert('Error loading image processing model. Please check the console for details.');
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

    // Function to set loading state
    let isProcessing = false;

    async function setLoading(loading) {
        const overlay = document.getElementById('loadingOverlay');
        if (!overlay) {
            console.error('Loading overlay not found!');
            return;
        }
        debug('Setting loading state:', loading);
        
        isProcessing = loading;
        processBtn.disabled = loading;

        if (loading) {
            // Force immediate display change
            overlay.style.display = 'flex';
            
            // Wait for next frame to ensure display change is applied
            await new Promise(resolve => requestAnimationFrame(resolve));
            
            // Double-check the display state
            debug('Overlay display after setting:', overlay.style.display);
            
            // Force a reflow
            void overlay.offsetHeight;
            
            // Verify the change took effect
            const computedStyle = window.getComputedStyle(overlay);
            debug('Computed display style:', computedStyle.display);
            
            // If not visible, try forcing it with a timeout
            if (computedStyle.display !== 'flex') {
                debug('Forcing display with timeout');
                await new Promise(resolve => setTimeout(resolve, 0));
                overlay.style.display = 'flex';
            }
        } else {
            overlay.style.display = 'none';
        }
        
        console.log('Loading state changed:', {
            isProcessing: loading,
            overlayVisible: overlay.style.display,
            buttonDisabled: processBtn.disabled
        });
    }

    // Process button handler is now in setupImageUpload
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

            // Add padding for borders
            const borderWidth = 20; // Width of the border
            const separatorWidth = 4; // Width of the separator between images
            
            // Adjust canvas size to accommodate borders
            canvas.width = baseWidth + (borderWidth * 2);
            canvas.height = outputHeight + (borderWidth * 2);

            // Clear canvas with white background
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Create a slight shadow effect
            ctx.shadowColor = 'rgba(0, 0, 0, 0.1)';
            ctx.shadowBlur = 8;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 2;

            // Draw background rectangles for each image
            ctx.fillStyle = '#ffffff';
            // Left image background
            ctx.fillRect(
                borderWidth - 4, 
                borderWidth - 4, 
                (canvas.width - borderWidth * 2) / 2 + 8, 
                canvas.height - borderWidth * 2 + 8
            );
            // Right image background
            ctx.fillRect(
                canvas.width/2, 
                borderWidth - 4, 
                (canvas.width - borderWidth * 2) / 2 + 4, 
                canvas.height - borderWidth * 2 + 8
            );

            // Reset shadow for image drawing
            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;

            // Draw both images with their calculated parameters, adjusted for borders
            ctx.drawImage(
                img1,
                params1.sx, params1.sy, params1.sWidth, params1.sHeight,  // source rectangle
                params1.x + borderWidth, params1.y + borderWidth, params1.width - separatorWidth, params1.height // destination rectangle
            );
            ctx.drawImage(
                img2,
                params2.sx, params2.sy, params2.sWidth, params2.sHeight,  // source rectangle
                params2.x + borderWidth + separatorWidth, params2.y + borderWidth, params2.width - separatorWidth, params2.height // destination rectangle
            );

            // Draw separator line
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(canvas.width/2 - separatorWidth/2, 0, separatorWidth, canvas.height);

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

        // Set up the file input and button handlers
        setupImageUpload();
    } catch (error) {
        console.error('Error in initialization:', error);
        alert('An error occurred while initializing the application');
    }
});