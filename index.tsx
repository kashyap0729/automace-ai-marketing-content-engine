/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Modality } from "@google/genai";

const VEO_POLLING_INTERVAL = 10000; // 10 seconds
const ELEVENLABS_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // Default voice: Rachel

// --- DOM Elements ---
const setupView = document.getElementById('setup-view')!;
const storyboardView = document.getElementById('storyboard-view')!;
const campaignForm = document.getElementById('campaign-form') as HTMLFormElement;
const generatePlanBtn = document.getElementById('generate-plan-btn') as HTMLButtonElement;
const storyboardContainer = document.getElementById('storyboard-container')!;
const generateAllImagesBtn = document.getElementById('generate-all-images-btn') as HTMLButtonElement;
const generateAllVoBtn = document.getElementById('generate-all-vo-btn') as HTMLButtonElement;
const generateAllVideosBtn = document.getElementById('generate-all-videos-btn') as HTMLButtonElement;
const generatePostCopyBtn = document.getElementById('generate-post-copy-btn') as HTMLButtonElement;
const postCopyView = document.getElementById('post-copy-view')!;
const postCopyContent = document.getElementById('post-copy-content')!;
const previewBtn = document.getElementById('preview-btn') as HTMLButtonElement;
const downloadBtn = document.getElementById('download-btn') as HTMLButtonElement;
const loader = document.getElementById('loader')!;
const loaderMessage = document.getElementById('loader-message')!;

// Preview Modal Elements
const previewModal = document.getElementById('preview-modal')!;
const sceneVideo = document.getElementById('scene-video') as HTMLVideoElement;
const textOverlay = document.getElementById('text-overlay')!;
const watermarkOverlay = document.getElementById('watermark-overlay')!;
const logoOverlay = document.getElementById('logo-overlay') as HTMLImageElement;
const closePreviewBtn = document.getElementById('close-preview')!;
const sceneIndicator = document.getElementById('scene-indicator')!;
const voiceoverAudioPlayer = document.getElementById('voiceover-audio-player') as HTMLAudioElement;

// --- Application State ---
let ai: GoogleGenAI;
type SceneAsset = {
    imageUrl?: string;
    imageB64?: string;
    audioUrl?: string;
    videoUrl?: string;
    imageStatus: 'ready' | 'generating' | 'complete' | 'failed';
    voStatus: 'ready' | 'generating' | 'complete' | 'failed';
    videoStatus: 'ready' | 'generating' | 'complete' | 'failed';
};

const state = {
  logo: {
    base64: null as string | null,
    mimeType: null as string | null,
    objectURL: null as string | null,
  },
  watermarkText: '',
  elevenApiKey: null as string | null,
  storyboard: null as any | null,
  sceneAssets: [] as SceneAsset[],
  isGenerating: false,
  aspectRatio: '9:16' as '9:16' | '1:1',
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  try {
    ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
  } catch(e) {
    console.error(e);
    showError("Failed to initialize AI. Check API Key.");
    return;
  }
  
  campaignForm.addEventListener('submit', onGeneratePlan);
  (document.getElementById('logo-file') as HTMLInputElement).addEventListener('change', onLogoChange);
  generateAllImagesBtn.addEventListener('click', handleGenerateAllImages);
  generateAllVideosBtn.addEventListener('click', handleGenerateAllVideos);
  generateAllVoBtn.addEventListener('click', handleGenerateAllVoiceovers);
  generatePostCopyBtn.addEventListener('click', handleGeneratePostCopy);
  previewBtn.addEventListener('click', showPreview);
  downloadBtn.addEventListener('click', handleDownloadVideo);
  closePreviewBtn.addEventListener('click', hidePreview);
});

// --- UI Control Functions ---
function showLoader(message: string) {
  loaderMessage.textContent = message;
  loader.classList.remove('hidden');
}

function hideLoader() {
  loader.classList.add('hidden');
}

function showError(message: string) {
  alert(`Error: ${message}`);
  hideLoader();
}

// --- Event Handlers ---
async function onLogoChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result as string;
    state.logo.base64 = dataUrl.split(',')[1];
    state.logo.mimeType = file.type;
    state.logo.objectURL = URL.createObjectURL(file);
  };
  reader.readAsDataURL(file);
}

async function onGeneratePlan(event: Event) {
  event.preventDefault();
  if (state.isGenerating) return;

  const formData = new FormData(campaignForm);
  const productDesc = formData.get('product-desc') as string;
  const targetAudience = formData.get('target-audience') as string;
  const elevenApiKey = formData.get('eleven-api-key') as string;
  state.watermarkText = formData.get('watermark-text') as string;
  state.elevenApiKey = elevenApiKey;
  state.aspectRatio = formData.get('format') as '9:16' | '1:1';

  if (!productDesc || !targetAudience || !elevenApiKey) {
    showError("Please fill in Product Description, Target Audience, and your ElevenLabs API Key.");
    return;
  }
  if (!state.logo.base64) {
      showError("Please upload a brand logo to proceed.");
      return;
  }

  state.isGenerating = true;
  generatePlanBtn.disabled = true;
  showLoader("🧠 Gemini is crafting your marketing plan...");

  try {
    const plan = await generateMarketingPlan(formData);
    state.storyboard = plan.storyboard;
    state.sceneAssets = new Array(plan.storyboard.scenes.length).fill(null).map(() => ({
      imageStatus: 'ready', voStatus: 'ready', videoStatus: 'ready'
    }));
    renderStoryboard();
    setupView.classList.add('hidden');
    storyboardView.classList.remove('hidden');
  } catch (error) {
    console.error(error);
    showError("Failed to generate a marketing plan. Please check the console for details.");
  } finally {
    hideLoader();
    state.isGenerating = false;
    generatePlanBtn.disabled = false;
  }
}

// --- Core AI Functions ---

async function generateMarketingPlan(formData: FormData) {
  const format = formData.get('format') as string;
  const platformText = format === '9:16' 
    ? 'Vertical Video (9:16) for platforms like TikTok/Reels' 
    : 'Square Video (1:1) for feed posts';

  const prompt = `
    You are a world-class marketing creative director. Create a complete social ad campaign as a single, valid JSON object.

    Product: ${formData.get('product-desc')}
    Primary audience: ${formData.get('target-audience')}
    Ad Format: ${platformText}
    Total scenes desired: ${formData.get('scenes-wanted')}

    The JSON object must have a "storyboard" key, which is an object containing a "scenes" array.
    Each scene in the array must be an object with these exact keys: "id" (1-based index), "voiceover" (a short, punchy line), "on_screen_text" (a few words, max 9), and "visual_prompt" (a rich, descriptive prompt for an image generation model, including camera shots, lighting, and mood, suitable for the chosen ad format).
  `;
  
  const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: { responseMimeType: "application/json" }
  });

  try {
    return JSON.parse(response.text.trim());
  } catch (e) {
    console.error("Failed to parse JSON from model response:", response.text);
    throw new Error("The model did not return valid JSON. Please try again.");
  }
}

// --- UI Rendering ---

function renderStoryboard() {
  storyboardContainer.innerHTML = '';
  state.storyboard.scenes.forEach((scene: any, index: number) => {
    const card = document.createElement('div');
    card.className = 'scene-card';
    card.id = `scene-card-${index}`;
    card.innerHTML = `
      <div class="scene-card-header">
        <h3>Scene ${scene.id}</h3>
        <div class="scene-statuses">
            <span id="image-status-${index}" class="scene-status status-ready">Image: Ready</span>
            <span id="video-status-${index}" class="scene-status status-ready">Video: Ready</span>
            <span id="vo-status-${index}" class="scene-status status-ready">VO: Ready</span>
        </div>
      </div>
       <div id="image-container-${index}" class="asset-container">
        <div class="asset-placeholder">Generated image will appear here.</div>
      </div>
      <div class="form-group">
        <label for="prompt-${index}">Visual Prompt</label>
        <textarea id="prompt-${index}" rows="3" disabled>${scene.visual_prompt}</textarea>
      </div>
      <div id="video-container-${index}" class="asset-container" style="display:none;">
        <div class="asset-placeholder">Generated video will appear here.</div>
      </div>
      <div class="form-group">
        <label for="vo-${index}">Voiceover</label>
        <input type="text" id="vo-${index}" value="${scene.voiceover}" disabled>
      </div>
    `;
    storyboardContainer.appendChild(card);
  });
}

function updateCardStatus(index: number, type: 'image' | 'vo' | 'video', status: 'ready' | 'generating' | 'complete' | 'failed') {
    const statusEl = document.getElementById(`${type}-status-${index}`)!;
    statusEl.textContent = `${type.toUpperCase()}: ${status.charAt(0).toUpperCase() + status.slice(1)}`;
    statusEl.className = `scene-status status-${status}`;
}

// --- Asset Generation ---

async function processSequentially<T>(
    items: T[],
    processor: (item: T, index: number) => Promise<void>,
    button: HTMLButtonElement,
    buttonText: string
) {
    button.disabled = true;
    button.textContent = 'Generating...';

    for (let i = 0; i < items.length; i++) {
        await processor(items[i], i);
    }

    button.disabled = false;
    button.textContent = buttonText;
}

// IMAGE GENERATION
async function handleGenerateAllImages() {
    await processSequentially(state.storyboard.scenes, generateSingleImage, generateAllImagesBtn, '1. Generate All Images');
    checkAssetGenerationStatus();
}

async function generateSingleImage(scene: any, index: number) {
    if (state.sceneAssets[index].imageStatus === 'complete') return;
    state.sceneAssets[index].imageStatus = 'generating';
    updateCardStatus(index, 'image', 'generating');

    const imageContainer = document.getElementById(`image-container-${index}`)!;
    imageContainer.innerHTML = `<div class="asset-placeholder"><div class="spinner"></div><p>Generating Image...</p></div>`;

    try {
        const visualPrompt = (document.getElementById(`prompt-${index}`) as HTMLTextAreaElement).value;
        const augmentedPrompt = `Generate a photorealistic image based on this description: "${visualPrompt}". The second image provided is a logo. Please place this logo naturally and realistically onto the main product described in the scene.`;
        
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image-preview',
            contents: {
                parts: [
                    { text: augmentedPrompt },
                    { inlineData: { data: state.logo.base64!, mimeType: state.logo.mimeType! } }
                ],
            },
            config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
        });

        const imagePart = response.candidates?.[0]?.content?.parts.find(p => p.inlineData);
        if (imagePart?.inlineData) {
            const base64Data = imagePart.inlineData.data;
            const mimeType = imagePart.inlineData.mimeType;
            state.sceneAssets[index].imageB64 = base64Data;
            
            const watermarkedUrl = await applyWatermark(`data:${mimeType};base64,${base64Data}`);
            state.sceneAssets[index].imageUrl = watermarkedUrl;

            imageContainer.innerHTML = `<img src="${watermarkedUrl}" alt="Scene ${scene.id} Visual">`;
            state.sceneAssets[index].imageStatus = 'complete';
            updateCardStatus(index, 'image', 'complete');
        } else {
            throw new Error("Model did not return an image part. The prompt may have been blocked.");
        }
    } catch(e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        console.error(`Error generating image for scene ${index + 1}:`, e);
        state.sceneAssets[index].imageStatus = 'failed';
        updateCardStatus(index, 'image', 'failed');
        imageContainer.innerHTML = `<div class="asset-placeholder"><p style="color:var(--error-color)">Image generation failed.</p><p class="error-details">${errorMessage}</p></div>`;
    }
}

async function applyWatermark(imageUrl: string): Promise<string> {
    if (!state.watermarkText) return imageUrl;

    return new Promise((resolve) => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);
            
            ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.font = `${Math.max(12, canvas.width / 50)}px ${getComputedStyle(document.body).fontFamily}`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'bottom';
            ctx.fillText(state.watermarkText, 20, canvas.height - 20);
            
            resolve(canvas.toDataURL());
        };
        img.src = imageUrl;
    });
}

// VIDEO GENERATION
async function handleGenerateAllVideos() {
    await processSequentially(state.storyboard.scenes, generateSingleVideo, generateAllVideosBtn, '2. Generate All Videos');
    checkAssetGenerationStatus();
}

async function generateSingleVideo(scene: any, index: number) {
    const asset = state.sceneAssets[index];
    if (asset.videoStatus === 'complete' || asset.imageStatus !== 'complete') return;

    asset.videoStatus = 'generating';
    updateCardStatus(index, 'video', 'generating');
    
    const videoContainer = document.getElementById(`video-container-${index}`)!;
    videoContainer.style.display = 'block';
    videoContainer.innerHTML = `<div class="asset-placeholder"><div class="spinner"></div><p id="progress-message-${index}">Initializing video...</p></div>`;

    try {
        const visualPrompt = (document.getElementById(`prompt-${index}`) as HTMLTextAreaElement).value;
        let operation = await ai.models.generateVideos({
            model: 'veo-2.0-generate-001',
            prompt: `Animate this image according to the following description: "${visualPrompt}"`,
            image: { imageBytes: asset.imageB64!, mimeType: 'image/png' },
            config: { numberOfVideos: 1 },
        });
        
        while (!operation.done) {
            await new Promise(resolve => setTimeout(resolve, VEO_POLLING_INTERVAL));
            operation = await ai.operations.getVideosOperation({ operation });
        }
        
        if (operation.error) {
            console.error('Video generation operation failed:', operation.error);
            const errorMessage = (operation.error as any).message || 'Unknown video generation error.';
            throw new Error(`Video generation failed: ${errorMessage}`);
        }

        if (operation.response?.generatedVideos?.[0]?.video?.uri) {
            const downloadLink = operation.response.generatedVideos[0].video.uri;
            const videoResponse = await fetch(`${downloadLink}&key=${process.env.API_KEY}`);
             if (!videoResponse.ok) {
                throw new Error(`Failed to download video: ${videoResponse.statusText}`);
            }
            const videoBlob = await videoResponse.blob();
            const videoUrl = URL.createObjectURL(videoBlob);
            
            asset.videoUrl = videoUrl;
            asset.videoStatus = 'complete';
            updateCardStatus(index, 'video', 'complete');
            videoContainer.innerHTML = `<video src="${videoUrl}" controls muted loop playsinline></video>`;
        } else {
            console.error("Video generation operation completed but no video URI found. Full operation object:", operation);
            throw new Error('Video generation finished but no video URI was found.');
        }

    } catch (error) {
        console.error(`Error generating video for scene ${index + 1}:`, error);
        asset.videoStatus = 'failed';
        updateCardStatus(index, 'video', 'failed');
        const errorMessage = error instanceof Error ? error.message : String(error);
        videoContainer.innerHTML = `<div class="asset-placeholder"><p style="color:var(--error-color)">Video generation failed.</p><p class="error-details">${errorMessage}</p></div>`;
    }
}

// VOICEOVER GENERATION (ELEVENLABS)
async function handleGenerateAllVoiceovers() {
    if (!state.elevenApiKey) {
        showError("ElevenLabs API Key is not configured. Please enter it in the setup form and start over.");
        return;
    }
    await processSequentially(state.storyboard.scenes, generateSingleVoiceover, generateAllVoBtn, '3. Generate All Voiceovers');
    checkAssetGenerationStatus();
}

async function generateSingleVoiceover(scene: any, index: number) {
    if (state.sceneAssets[index].voStatus === 'complete') return;
    
    // Clear previous errors
    const voGroup = document.getElementById(`vo-${index}`)?.parentElement;
    voGroup?.querySelector('.error-details')?.remove();

    state.sceneAssets[index].voStatus = 'generating';
    updateCardStatus(index, 'vo', 'generating');

    try {
        const voiceoverText = (document.getElementById(`vo-${index}`) as HTMLInputElement).value;
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
            method: 'POST',
            headers: {
                'Accept': 'audio/mpeg',
                'Content-Type': 'application/json',
                'xi-api-key': state.elevenApiKey!
            },
            body: JSON.stringify({
                text: voiceoverText,
                model_id: 'eleven_multilingual_v2',
                voice_settings: { stability: 0.5, similarity_boost: 0.75 }
            })
        });

        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`ElevenLabs API Error: ${response.statusText} - ${errorData}`);
        }

        const audioBlob = await response.blob();
        state.sceneAssets[index].audioUrl = URL.createObjectURL(audioBlob);
        state.sceneAssets[index].voStatus = 'complete';
        updateCardStatus(index, 'vo', 'complete');

    } catch(e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        console.error(`Error generating voiceover for scene ${index + 1}:`, e);
        state.sceneAssets[index].voStatus = 'failed';
        updateCardStatus(index, 'vo', 'failed');
        voGroup?.insertAdjacentHTML('beforeend', `<p class="error-details" style="color:var(--error-color)">${errorMessage}</p>`);
    }
}


function checkAssetGenerationStatus() {
  const allImages = state.sceneAssets.every(a => a.imageStatus === 'complete');
  generateAllVideosBtn.disabled = !allImages;
  
  const allVideos = state.sceneAssets.every(a => a.videoStatus === 'complete');
  generateAllVoBtn.disabled = !allVideos;

  const allVO = state.sceneAssets.every(a => a.voStatus === 'complete');
  previewBtn.disabled = !allVideos || !allVO;
  downloadBtn.disabled = !allVideos || !allVO;
  generatePostCopyBtn.disabled = !allVideos || !allVO;
}

// --- POST COPY GENERATION ---
async function handleGeneratePostCopy() {
    if (state.isGenerating || !state.storyboard) return;

    state.isGenerating = true;
    generatePostCopyBtn.disabled = true;
    showLoader("✍️ Gemini is writing your social media post...");

    try {
        const formData = new FormData(campaignForm);
        const productDesc = formData.get('product-desc') as string;
        const targetAudience = formData.get('target-audience') as string;
        const format = formData.get('format') as string;
        const platformText = format === '9:16' 
            ? 'vertical video platforms like TikTok, Instagram Reels, and YouTube Shorts' 
            : 'feed-based platforms like Instagram and Facebook';


        const storyboardSummary = state.storyboard.scenes.map((scene: any) => {
            return `Scene ${scene.id}:
- Visuals: ${scene.visual_prompt}
- Voiceover: ${scene.voiceover}
- On-screen text: ${scene.on_screen_text}`;
        }).join('\n\n');

        const prompt = `
You are a social media marketing expert specializing in creating viral short-form video content.
Based on the following ad campaign details, generate a compelling post copy and relevant hashtags.

**Campaign Details:**
- **Product:** ${productDesc}
- **Target Audience:** ${targetAudience}
- **Platform:** ${platformText}

**Video Storyboard Summary:**
${storyboardSummary}

**Instructions:**
1.  Write a captivating and concise caption for the post. It should grab attention, explain the value proposition, and have a clear call-to-action.
2.  Provide a list of 5-7 highly relevant and trending hashtags.

Please format your response as a single, valid JSON object with two keys: "caption" (a string) and "hashtags" (an array of strings).
`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: { responseMimeType: "application/json" }
        });

        const postData = JSON.parse(response.text.trim());
        renderPostCopy(postData.caption, postData.hashtags);

    } catch (error) {
        console.error("Failed to generate post copy:", error);
        showError("Failed to generate post copy. Please check the console for details.");
    } finally {
        hideLoader();
        state.isGenerating = false;
        generatePostCopyBtn.disabled = false;
    }
}

function renderPostCopy(caption: string, hashtags: string[]) {
    const hashtagsString = hashtags.join(' ');
    const fullPostText = `${caption}\n\n${hashtagsString}`;

    postCopyContent.innerHTML = `
        <button class="copy-btn" id="copy-post-btn" title="Copy to clipboard">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor"><path d="M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-720v480-480Z"/></svg>
            Copy
        </button>
        <pre>${caption}</pre>
        <div class="hashtags">${hashtagsString}</div>
    `;

    postCopyView.classList.remove('hidden');

    const copyBtn = document.getElementById('copy-post-btn')!;
    copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(fullPostText).then(() => {
            copyBtn.innerHTML = `Copied!`;
            setTimeout(() => {
                copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor"><path d="M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-720v480-480Z"/></svg> Copy`;
            }, 2000);
        });
    });
}


// --- Preview Player Logic ---
let currentSceneIndex = 0;

function showPreview() {
  currentSceneIndex = 0;
  const videoWrapper = document.querySelector('.video-wrapper') as HTMLDivElement;
  if (videoWrapper) {
    videoWrapper.style.setProperty('--video-aspect-ratio', state.aspectRatio.replace(':', ' / '));
  }
  previewModal.classList.remove('hidden');
  logoOverlay.src = state.logo.objectURL || '';
  watermarkOverlay.textContent = state.watermarkText;
  playScene(currentSceneIndex);
}

function hidePreview() {
  sceneVideo.pause();
  voiceoverAudioPlayer.pause();
  previewModal.classList.add('hidden');
}

function playScene(index: number) {
  if (index >= state.sceneAssets.length) {
    hidePreview();
    return;
  }
  
  const sceneAsset = state.sceneAssets[index];
  const sceneData = state.storyboard.scenes[index];
  
  // Update UI
  sceneIndicator.textContent = `Scene ${index + 1} / ${state.sceneAssets.length}`;
  textOverlay.textContent = sceneData.on_screen_text;
  
  // Fade in overlays
  textOverlay.style.opacity = '1';
  logoOverlay.style.opacity = '1';
  watermarkOverlay.style.opacity = '1';
  
  // Play Video & Audio
  sceneVideo.src = sceneAsset.videoUrl!;
  voiceoverAudioPlayer.src = sceneAsset.audioUrl!;
  sceneVideo.currentTime = 0;
  voiceoverAudioPlayer.currentTime = 0;
  sceneVideo.play();
  voiceoverAudioPlayer.play();

  // Go to next scene when video ends
  sceneVideo.onended = () => {
    textOverlay.style.opacity = '0';
    logoOverlay.style.opacity = '0';
    watermarkOverlay.style.opacity = '0';
    currentSceneIndex++;
    // Add a small delay between scenes
    setTimeout(() => playScene(currentSceneIndex), 300);
  };
}

// --- Video Download Logic ---
async function handleDownloadVideo() {
    if (state.isGenerating || state.sceneAssets.some(a => a.videoStatus !== 'complete' || a.voStatus !== 'complete')) {
        showError("All assets must be generated before downloading.");
        return;
    }

    state.isGenerating = true;
    showLoader("🎬 Rendering final video... This may take a moment.");

    try {
        const [width, height] = state.aspectRatio === '9:16' ? [720, 1280] : [1080, 1080];
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, width, height);

        // 1. Set up combined audio track
        const audioContext = new AudioContext();
        const audioDestination = audioContext.createMediaStreamDestination();
        const audioBuffers = await Promise.all(
            state.sceneAssets.map(asset =>
                fetch(asset.audioUrl!)
                    .then(res => res.arrayBuffer())
                    .then(buffer => audioContext.decodeAudioData(buffer))
            )
        );

        let audioStartTime = 0;
        for (const buffer of audioBuffers) {
            const source = audioContext.createBufferSource();
            source.buffer = buffer;
            source.connect(audioDestination);
            source.start(audioStartTime);
            audioStartTime += buffer.duration;
        }
        const audioTrack = audioDestination.stream.getAudioTracks()[0];

        // 2. Set up video track from canvas
        const videoStream = canvas.captureStream(30);
        const videoTrack = videoStream.getVideoTracks()[0];

        // 3. Combine tracks and set up recorder
        const combinedStream = new MediaStream([videoTrack, audioTrack]);
        const recorder = new MediaRecorder(combinedStream, { mimeType: 'video/webm; codecs=vp9,opus' });

        const chunks: Blob[] = [];
        recorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                chunks.push(event.data);
            }
        };

        recorder.onstop = () => {
            const blob = new Blob(chunks, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `automace_ad_${new Date().toISOString().slice(0,10)}.webm`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            state.isGenerating = false;
            hideLoader();
        };

        // 4. Start recording and render scenes
        recorder.start();

        const tempVideo = document.createElement('video');
        tempVideo.muted = true;
        
        const logoImg = new Image();
        let logoLoaded = false;
        if (state.logo.objectURL) {
            logoImg.src = state.logo.objectURL;
            await new Promise(resolve => { logoImg.onload = resolve; });
            logoLoaded = true;
        }

        for (let i = 0; i < state.sceneAssets.length; i++) {
            const sceneAsset = state.sceneAssets[i];
            const sceneData = state.storyboard.scenes[i];
            
            tempVideo.src = sceneAsset.videoUrl!;
            await new Promise(resolve => { tempVideo.onloadeddata = resolve; });

            let resolveScene: (value: unknown) => void;
            const scenePromise = new Promise(resolve => { resolveScene = resolve; });
            tempVideo.onended = () => resolveScene(true);
            
            tempVideo.currentTime = 0;
            await tempVideo.play();
            
            const renderFrame = () => {
                if (tempVideo.paused || tempVideo.ended) {
                    return;
                }
                
                const videoRatio = tempVideo.videoWidth / tempVideo.videoHeight;
                const canvasRatio = width / height;
                let dWidth, dHeight, dx, dy;

                if (videoRatio > canvasRatio) { 
                    dHeight = height;
                    dWidth = dHeight * videoRatio;
                } else {
                    dWidth = width;
                    dHeight = dWidth / videoRatio;
                }
                dx = (width - dWidth) / 2;
                dy = (height - dHeight) / 2;

                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(tempVideo, dx, dy, dWidth, dHeight);

                // Draw overlays
                if (logoLoaded) {
                    const logoMaxW = width * 0.15;
                    const logoMaxH = height * 0.08;
                    const logoRatio = logoImg.width / logoImg.height;
                    let logoW = logoMaxW;
                    let logoH = logoMaxW / logoRatio;
                    if (logoH > logoMaxH) {
                        logoH = logoMaxH;
                        logoW = logoMaxH * logoRatio;
                    }
                    ctx.drawImage(logoImg, width - logoW - 20, 20, logoW, logoH);
                }
                if(state.watermarkText) {
                    ctx.font = `${height * 0.015}px ${getComputedStyle(document.body).fontFamily}`;
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'bottom';
                    ctx.fillText(state.watermarkText, 20, height - 20);
                }
                if (sceneData.on_screen_text) {
                    ctx.font = `bold ${height * 0.04}px ${getComputedStyle(document.body).fontFamily}`;
                    ctx.fillStyle = 'white';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
                    ctx.lineWidth = height * 0.01;
                    const textX = width / 2;
                    const textY = height * 0.85;
                    ctx.strokeText(sceneData.on_screen_text, textX, textY);
                    ctx.fillText(sceneData.on_screen_text, textX, textY);
                }

                requestAnimationFrame(renderFrame);
            };
            requestAnimationFrame(renderFrame);
            await scenePromise;
        }

        // 5. Render end card with logo
        if (logoLoaded) {
            const LOGO_END_CARD_DURATION_MS = 3000; // 3 seconds

            // Clear canvas to black
            ctx.fillStyle = 'black';
            ctx.fillRect(0, 0, width, height);

            // Calculate logo dimensions to fit and center
            const maxLogoWidth = width * 0.5;
            const maxLogoHeight = height * 0.5;
            const logoRatio = logoImg.width / logoImg.height;
            
            let logoW = maxLogoWidth;
            let logoH = logoW / logoRatio;

            if (logoH > maxLogoHeight) {
                logoH = maxLogoHeight;
                logoW = logoH * logoRatio;
            }

            const logoX = (width - logoW) / 2;
            const logoY = (height - logoH) / 2;
            
            ctx.drawImage(logoImg, logoX, logoY, logoW, logoH);
            
            // Hold this frame for the duration
            await new Promise(resolve => setTimeout(resolve, LOGO_END_CARD_DURATION_MS));
        }

        recorder.stop();
        audioContext.close();

    } catch (error) {
        console.error("Failed to render video:", error);
        showError("An error occurred while rendering the video. Please check the console.");
        state.isGenerating = false;
        hideLoader();
    }
}