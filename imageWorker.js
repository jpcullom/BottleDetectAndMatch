// Import TensorFlow.js for the worker
importScripts('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs');
importScripts('https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd');

let model = null;

// Global constants for uniform image sizes
const UNIFORM_DIMENSIONS = {
    height: 500,    // Fixed height for all images
    width: 240,     // Fixed width for all images
    border: 20,     // Border width
    separator: 10   // Separator width
};

// Initialize the COCO-SSD model
async function initModel() {
    try {
        model = await cocoSsd.load();
        self.postMessage({ type: 'modelLoaded' });
    } catch (error) {
        self.postMessage({ type: 'error', error: 'Failed to load model: ' + error.message });
    }
}

// Process a pair of images
async function processImagePair(img1Data, img2Data) {
    try {
        // Helper function to create a scaled canvas
        function createScaledCanvas(imageData, maxDimension = 1024) {
            const scale = Math.min(1, maxDimension / Math.max(imageData.width, imageData.height));
            const width = Math.round(imageData.width * scale);
            const height = Math.round(imageData.height * scale);
            
            const canvas = new OffscreenCanvas(width, height);
            const ctx = canvas.getContext('2d');
            
            // Create temporary canvas with original size
            const tempCanvas = new OffscreenCanvas(imageData.width, imageData.height);
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.putImageData(imageData, 0, 0);
            
            // Scale down to target size
            ctx.drawImage(tempCanvas, 0, 0, width, height);
            
            return canvas;
        }

        // Helper function to enhance contrast
        function enhanceContrast(canvas) {
            const ctx = canvas.getContext('2d');
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            
            // Find min and max values
            let min = 255, max = 0;
            for (let i = 0; i < data.length; i += 4) {
                const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
                if (avg < min) min = avg;
                if (avg > max) max = avg;
            }
            
            // Apply contrast stretch
            const range = max - min;
            for (let i = 0; i < data.length; i += 4) {
                for (let j = 0; j < 3; j++) {
                    data[i + j] = ((data[i + j] - min) / range) * 255;
                }
            }
            
            ctx.putImageData(imageData, 0, 0);
            return canvas;
        }

        // Create and process images
        const imageData1 = new ImageData(new Uint8ClampedArray(img1Data.data), img1Data.width, img1Data.height);
        const imageData2 = new ImageData(new Uint8ClampedArray(img2Data.data), img2Data.width, img2Data.height);

        // Create scaled canvases
        const canvas1 = createScaledCanvas(imageData1);
        const canvas2 = createScaledCanvas(imageData2);

        // Enhance contrast
        enhanceContrast(canvas1);
        enhanceContrast(canvas2);

        // Helper function to clone an OffscreenCanvas
        function cloneCanvas(original) {
            const clone = new OffscreenCanvas(original.width, original.height);
            const ctx = clone.getContext('2d');
            ctx.drawImage(original, 0, 0);
            return clone;
        }

        // Helper function to rotate canvas
        function rotateCanvas(canvas, degrees) {
            const clone = new OffscreenCanvas(canvas.width, canvas.height);
            const ctx = clone.getContext('2d');
            
            // Move to center, rotate, and move back
            ctx.translate(canvas.width/2, canvas.height/2);
            ctx.rotate(degrees * Math.PI/180);
            ctx.translate(-canvas.width/2, -canvas.height/2);
            
            // Draw the original image
            ctx.drawImage(canvas, 0, 0);
            return clone;
        }

        // Helper function to try different preprocessing approaches
        async function tryDetection(canvas) {
            const attempts = [
                { name: 'original', angle: 0 },
                { name: 'rotated slightly left', angle: -5 },
                { name: 'rotated slightly right', angle: 5 },
                { name: 'rotated left', angle: -10 },
                { name: 'rotated right', angle: 10 },
                { name: 'rotated more left', angle: -15 },
                { name: 'rotated slight more left', angle: -12 },
                { name: 'rotated slight more right', angle: 12 },
                { name: 'rotated more right', angle: 15 },
                // Add finer gradients around -15 degrees where we've seen success
                { name: 'rotated precise 1', angle: -13 },
                { name: 'rotated precise 2', angle: -14 },
                { name: 'rotated precise 3', angle: -16 },
                { name: 'rotated precise 4', angle: -17 }
            ];

            for (const attempt of attempts) {
                try {
                    const processedCanvas = rotateCanvas(canvas, attempt.angle);
                    const predictions = await model.detect(processedCanvas);
                    
                    // Log more detailed information about each attempt
                    self.postMessage({ 
                        type: 'debug', 
                        data: { 
                            message: `Attempt with ${attempt.name} (angle: ${attempt.angle}°): found ${predictions.length} objects` + 
                                   (predictions.length > 0 
                                    ? ` (${predictions.map(p => 
                                        `${p.class} ${(p.score * 100).toFixed(1)}% at [${p.bbox.map(v => v.toFixed(1)).join(', ')}]`
                                    ).join(', ')})` 
                                    : '') +
                                   `\nCanvas dimensions: ${processedCanvas.width}x${processedCanvas.height}`
                        } 
                    });
                    
                    // Filter predictions with more strict criteria
                    const goodPredictions = predictions.filter(p => {
                        // Basic confidence threshold
                        if (p.score <= 0.3) return false;
                        
                        // Get bounding box dimensions
                        const [x, y, width, height] = p.bbox;
                        const aspectRatio = height / width;
                        const relativeSize = (width * height) / (processedCanvas.width * processedCanvas.height);
                        
                        // For bottle class, check aspect ratio and size
                        if (p.class === 'bottle') {
                            const validAspectRatio = aspectRatio > 1.5; // Bottles should be taller than wide
                            const validSize = relativeSize < 0.5; // Shouldn't take up more than 50% of image
                            return validAspectRatio && validSize;
                        }
                        
                        // For non-bottle objects, be very strict about size
                        return relativeSize < 0.3; // Non-bottle objects shouldn't take up more than 30% of image
                    });

                    // Sort by score and prefer bottles over other objects
                    goodPredictions.sort((a, b) => {
                        if (a.class === 'bottle' && b.class !== 'bottle') return -1;
                        if (a.class !== 'bottle' && b.class === 'bottle') return 1;
                        return b.score - a.score;
                    });

                    if (goodPredictions.length > 0) {
                        // Log the successful prediction details
                        const best = goodPredictions[0];
                        const [x, y, width, height] = best.bbox;
                        const aspectRatio = height / width;
                        const relativeSize = (width * height) / (processedCanvas.width * processedCanvas.height);
                        
                        self.postMessage({
                            type: 'debug',
                            data: {
                                message: `Using ${attempt.name} attempt - Best prediction: ` +
                                        `${best.class} (${(best.score * 100).toFixed(1)}%) ` +
                                        `bbox: [${best.bbox.map(v => v.toFixed(1)).join(', ')}]\n` +
                                        `Aspect ratio: ${aspectRatio.toFixed(2)}, ` +
                                        `Relative size: ${(relativeSize * 100).toFixed(1)}% of image`
                            }
                        });
                        return goodPredictions;
                    }
                } catch (error) {
                    self.postMessage({ 
                        type: 'debug', 
                        data: { 
                            message: `Error in ${attempt.name} attempt: ${error.message}` 
                        } 
                    });
                }
            }
            
            // If we get here, no attempt found anything
            self.postMessage({ 
                type: 'debug', 
                data: { 
                    message: 'No objects detected in any orientation attempt' 
                } 
            });

            // Try one last time with original orientation and lower confidence threshold
            try {
                const finalAttempt = await model.detect(canvas, { scoreThreshold: 0.1 });
                if (finalAttempt.length > 0) {
                    self.postMessage({ 
                        type: 'debug', 
                        data: { 
                            message: `Found objects with lower confidence: ${finalAttempt.map(p => `${p.class} ${(p.score * 100).toFixed(1)}%`).join(', ')}` 
                        } 
                    });
                    return finalAttempt;
                }
            } catch (error) {
                self.postMessage({ 
                    type: 'debug', 
                    data: { 
                        message: `Error in final low-confidence attempt: ${error.message}` 
                    } 
                });
            }
            
            return [];
        }

        // Try detection with multiple approaches
        self.postMessage({ type: 'debug', data: { message: 'Starting detection attempts...' } });
        
        let predictions1 = await tryDetection(canvas1);
        let predictions2 = await tryDetection(canvas2);

        self.postMessage({ 
            type: 'debug', 
            data: { 
                message: `Final results - Image 1: ${predictions1.length} objects, Image 2: ${predictions2.length} objects` 
            } 
        });

        // Log all detected objects
        self.postMessage({ 
            type: 'debug', 
            data: {
                image1: {
                    dimensions: { width: canvas1.width, height: canvas1.height },
                    detections: predictions1.map(p => ({ class: p.class, score: p.score }))
                },
                image2: {
                    dimensions: { width: canvas2.width, height: canvas2.height },
                    detections: predictions2.map(p => ({ class: p.class, score: p.score }))
                }
            }
        });

        // Try to find bottles or similar objects with lower confidence threshold
        const validClasses = ['bottle', 'wine glass', 'vase'];
        let bottle1 = predictions1
            .filter(p => validClasses.includes(p.class) && p.score > 0.3)
            .sort((a, b) => b.score - a.score)[0];
        
        let bottle2 = predictions2
            .filter(p => validClasses.includes(p.class) && p.score > 0.3)
            .sort((a, b) => b.score - a.score)[0];

        // If no bottles found, try to use any large detected object
        if (!bottle1 || !bottle2) {
            const getLargestObject = (predictions) => {
                if (predictions.length === 0) return null;
                return predictions
                    .map(p => ({
                        ...p,
                        area: p.bbox[2] * p.bbox[3] // width * height
                    }))
                    .sort((a, b) => b.area - a.area)[0];
            };

            const mainObject1 = bottle1 || getLargestObject(predictions1);
            const mainObject2 = bottle2 || getLargestObject(predictions2);

            if (!mainObject1 || !mainObject2) {
                self.postMessage({ 
                    type: 'debug', 
                    data: { 
                        message: 'Detection Summary:',
                        details: {
                            image1Size: `${canvas1.width}x${canvas1.height}`,
                            image2Size: `${canvas2.width}x${canvas2.height}`,
                            image1Objects: predictions1.map(p => `${p.class} (${(p.score * 100).toFixed(1)}%)`),
                            image2Objects: predictions2.map(p => `${p.class} (${(p.score * 100).toFixed(1)}%)`)
                        }
                    } 
                });
                
                throw new Error(
                    `Object detection failed. Try adjusting the angle of your camera slightly when taking the photos.`
                );
            }

            // Use the largest objects instead
            bottle1 = mainObject1;
            bottle2 = mainObject2;
        }

        // Calculate target dimensions
        function calculateTargetDimensions(width1, height1, width2, height2) {
            return {
                width: UNIFORM_DIMENSIONS.width,
                height: UNIFORM_DIMENSIONS.height
            };
        }

        // Get crop dimensions from predictions
        function getCropDimensions(predictions, originalWidth, originalHeight) {
            if (!predictions || predictions.length === 0) {
                return { x: 0, y: 0, width: originalWidth, height: originalHeight };
            }

            // Get the bounding box of the detected object
            const bbox = predictions[0].bbox;
            
            // Target aspect ratio for bottles (height/width)
            const TARGET_ASPECT_RATIO = 2.1;  // More consistent bottle shape
            const padding = 0.25; // 25% padding around the object

            // Calculate initial padded dimensions
            let paddedWidth = bbox[2] * (1 + padding * 2);
            let paddedHeight = bbox[3] * (1 + padding * 2);
            
            // Adjust dimensions to match target aspect ratio while maintaining center
            const currentAspectRatio = paddedHeight / paddedWidth;
            if (currentAspectRatio < TARGET_ASPECT_RATIO) {
                // Too wide, increase height
                paddedHeight = paddedWidth * TARGET_ASPECT_RATIO;
            } else {
                // Too tall, increase width
                paddedWidth = paddedHeight / TARGET_ASPECT_RATIO;
            }

            // Calculate crop position (centered on object)
            let x = bbox[0] + (bbox[2] / 2) - (paddedWidth / 2);
            let y = bbox[1] + (bbox[3] / 2) - (paddedHeight / 2);
            
            // Ensure we don't crop outside the image bounds
            x = Math.max(0, Math.min(x, originalWidth - paddedWidth));
            y = Math.max(0, Math.min(y, originalHeight - paddedHeight));

            return { 
                x: Math.round(x), 
                y: Math.round(y), 
                width: Math.round(paddedWidth), 
                height: Math.round(paddedHeight)
            };
        }

        // Get crop dimensions
        const crop1 = getCropDimensions([bottle1], canvas1.width, canvas1.height);
        const crop2 = getCropDimensions([bottle2], canvas2.width, canvas2.height);

        // Log crop dimensions
        self.postMessage({
            type: 'debug',
            data: {
                message: `Crop dimensions:\nImage 1: ${crop1.width}x${crop1.height} at (${crop1.x},${crop1.y})\nImage 2: ${crop2.width}x${crop2.height} at (${crop2.x},${crop2.y})`
            }
        });

        // Create temporary canvases for cropped and scaled images
        const temp1 = new OffscreenCanvas(UNIFORM_DIMENSIONS.width, UNIFORM_DIMENSIONS.height);
        const temp2 = new OffscreenCanvas(UNIFORM_DIMENSIONS.width, UNIFORM_DIMENSIONS.height);
        
        // Get contexts and copy cropped regions
        const ctx1 = temp1.getContext('2d');
        const ctx2 = temp2.getContext('2d');
        
        // Enable smooth scaling
        ctx1.imageSmoothingEnabled = true;
        ctx1.imageSmoothingQuality = 'high';
        ctx2.imageSmoothingEnabled = true;
        ctx2.imageSmoothingQuality = 'high';

        // Draw scaled images centered in their canvases
        function drawCenteredAndScaled(ctx, canvas, cropData) {
            const aspectRatio = cropData.width / cropData.height;
            
            // Always try to fill the full height first
            let scaledHeight = UNIFORM_DIMENSIONS.height;
            let scaledWidth = scaledHeight * aspectRatio;
            
            // If width is too wide, scale based on width instead
            if (scaledWidth > UNIFORM_DIMENSIONS.width) {
                scaledWidth = UNIFORM_DIMENSIONS.width;
                scaledHeight = scaledWidth / aspectRatio;
            }
            
            // Calculate centered position
            const x = Math.round((UNIFORM_DIMENSIONS.width - scaledWidth) / 2);
            const y = Math.round((UNIFORM_DIMENSIONS.height - scaledHeight) / 2);
            
            // Fill background with white
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, UNIFORM_DIMENSIONS.width, UNIFORM_DIMENSIONS.height);
            
            // Draw the image with consistent scaling
            ctx.drawImage(canvas, 
                cropData.x, cropData.y, cropData.width, cropData.height,
                x, y, scaledWidth, scaledHeight
            );
        }

        // Draw both images scaled and centered
        drawCenteredAndScaled(ctx1, canvas1, crop1);
        drawCenteredAndScaled(ctx2, canvas2, crop2);

        // Get the scaled image data
        const scaledData1 = ctx1.getImageData(0, 0, UNIFORM_DIMENSIONS.width, UNIFORM_DIMENSIONS.height);
        const scaledData2 = ctx2.getImageData(0, 0, UNIFORM_DIMENSIONS.width, UNIFORM_DIMENSIONS.height);

        // Create result canvas with uniform dimensions
        const resultCanvas = new OffscreenCanvas(
            UNIFORM_DIMENSIONS.width * 2 + UNIFORM_DIMENSIONS.separator + (UNIFORM_DIMENSIONS.border * 2),
            UNIFORM_DIMENSIONS.height + (UNIFORM_DIMENSIONS.border * 2)
        );
        const resultCtx = resultCanvas.getContext('2d');

        // Fill the entire canvas with white for the border
        resultCtx.fillStyle = '#ffffff';
        resultCtx.fillRect(0, 0, resultCanvas.width, resultCanvas.height);

        // Draw scaled images side by side with border offset
        resultCtx.putImageData(scaledData1, UNIFORM_DIMENSIONS.border, UNIFORM_DIMENSIONS.border);
        resultCtx.putImageData(
            scaledData2, 
            UNIFORM_DIMENSIONS.border + UNIFORM_DIMENSIONS.width + UNIFORM_DIMENSIONS.separator,
            UNIFORM_DIMENSIONS.border
        );

        // Draw separator
        resultCtx.fillStyle = '#ffffff';
        resultCtx.fillRect(
            UNIFORM_DIMENSIONS.border + UNIFORM_DIMENSIONS.width,
            UNIFORM_DIMENSIONS.border,
            UNIFORM_DIMENSIONS.separator,
            resultCanvas.height - (UNIFORM_DIMENSIONS.border * 2)
        );

        // Calculate brightness adjustment
        function calculateAverageBrightness(imageData) {
            const data = imageData.data;
            let totalBrightness = 0;
            let pixels = 0;
            
            for (let i = 0; i < data.length; i += 4) {
                const r = data[i] / 255;
                const g = data[i + 1] / 255;
                const b = data[i + 2] / 255;
                const brightness = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                totalBrightness += brightness;
                pixels++;
            }
            
            return totalBrightness / pixels;
        }

        // Get the final image data
        const finalImageData = resultCtx.getImageData(0, 0, resultCanvas.width, resultCanvas.height);

        // Calculate the brightness adjustment needed
        const targetBrightness = 0.65; // Target 65% brightness (increased from 50%)
        const currentBrightness = calculateAverageBrightness(finalImageData);
        const brightnessAdjustment = Math.round((targetBrightness - currentBrightness) * 100);

        // Log brightness information
        self.postMessage({
            type: 'debug',
            data: {
                message: `Brightness adjustment: Current=${(currentBrightness * 100).toFixed(1)}%, ` +
                        `Target=${(targetBrightness * 100).toFixed(1)}%, ` +
                        `Adjustment=${brightnessAdjustment}`
            }
        });

        // Apply brightness adjustment more effectively
        if (Math.abs(brightnessAdjustment) > 2) {
            const data = finalImageData.data;
            const factor = 1 + (brightnessAdjustment / 100);  // Convert to multiplier
            
            for (let i = 0; i < data.length; i += 4) {
                // Apply multiplicative brightness adjustment
                data[i] = Math.min(255, Math.max(0, Math.round(data[i] * factor)));
                data[i + 1] = Math.min(255, Math.max(0, Math.round(data[i + 1] * factor)));
                data[i + 2] = Math.min(255, Math.max(0, Math.round(data[i + 2] * factor)));
            }
            
            // Put the adjusted data back
            resultCtx.putImageData(finalImageData, 0, 0);
        }

        // Log final dimensions
        self.postMessage({
            type: 'debug',
            data: {
                message: `Final output dimensions:\n` +
                        `Target dimensions per image: ${UNIFORM_DIMENSIONS.width}x${UNIFORM_DIMENSIONS.height}\n` +
                        `Full canvas: ${resultCanvas.width}x${resultCanvas.height}\n` +
                        `Border width: ${UNIFORM_DIMENSIONS.border}, Separator width: ${UNIFORM_DIMENSIONS.separator}`
            }
        });

        // Send the processed image data back
        self.postMessage({
            type: 'processed',
            imageData: {
                data: finalImageData.data.buffer,
                width: resultCanvas.width,
                height: resultCanvas.height
            }
        }, [finalImageData.data.buffer]);

    } catch (error) {
        self.postMessage({ type: 'error', error: error.message });
    }
}

// Handle messages from the main thread
self.onmessage = async function(e) {
    const { type, data } = e.data;

    switch (type) {
        case 'init':
            await initModel();
            break;

        case 'process':
            if (!model) {
                self.postMessage({ type: 'error', error: 'Model not initialized' });
                return;
            }
            await processImagePair(data.img1, data.img2);
            break;

        default:
            self.postMessage({ type: 'error', error: 'Unknown command' });
    }
};