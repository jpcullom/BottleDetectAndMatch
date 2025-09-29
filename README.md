# Image Processing with GitHub Pages

This is a simple web application that allows users to upload and process images directly in the browser using HTML5 Canvas.

## Features

- Image upload and preview
- Real-time image processing
- Side-by-side comparison of original and processed images
- Currently implements a basic grayscale filter as an example

## How to Use

1. Open `index.html` in your web browser or deploy to GitHub Pages
2. Click the file input button to upload an image
3. Click "Process Image" to apply the image processing effect
4. The original and processed images will be displayed side by side

## Customization

To add your own image processing effects, modify the processing logic in the `script.js` file. Look for the `processBtn.addEventListener('click', ...)` function where the image processing happens.

## GitHub Pages Deployment

To deploy this project to GitHub Pages:

1. Push this repository to GitHub
2. Go to repository Settings
3. Navigate to Pages section
4. Select your main branch as the source
5. Your site will be published at `https://[username].github.io/[repository-name]`