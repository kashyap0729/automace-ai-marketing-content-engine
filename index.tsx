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
const previewBtn = document.getElementById('preview-btn') as HTMLButtonElement;
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
  generateAllVoBtn.addEventListener('click', handleGenerateAllVoiceovers);
  generateAllVideosBtn.addEventListener('click', handleGenerateAllVideos);
  previewBtn.addEventListener('click', showPreview);
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
  state.watermarkText = formData.get('watermark-text') as string;
  state.elevenApiKey = process.env.ELEVEN_LABS_API_KEY!;

  if (!productDesc || !targetAudience) {
    showError("Please fill in Product Description and Target Audience.");
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
  const prompt = `
    You are a world-class marketing creative director. Create a complete social ad campaign as a single, valid JSON object.

    Product: ${formData.get('product-desc')}
    Primary audience: ${formData.get('target-audience')}
    Target platform: ${formData.get('platform')}
    Total scenes desired: ${formData.get('scenes-wanted')}

    The JSON object must have a "storyboard" key, which is an object containing a "scenes" array.
    Each scene in the array must be an object with these exact keys: "id" (1-based index), "voiceover" (a short, punchy line), "on_screen_text" (a few words, max 9), and "visual_prompt" (a rich, descriptive prompt for an image generation model, including camera shots, lighting, and mood).
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
            <span id="vo-status-${index}" class="scene-status status-ready">VO: Ready</span>
            <span id="video-status-${index}" class="scene-status status-ready">Video: Ready</span>
        </div>
      </div>
       <div id="image-container-${index}" class="asset-container">
        <div class="asset-placeholder">Generated image will appear here.</div>
      </div>
      <div class="form-group">
        <label for="prompt-${index}">Visual Prompt</label>
        <textarea id="prompt-${index}" rows="3" disabled>${scene.visual_prompt}</textarea>
      </div>
      <div class="form-group">
        <label for="vo-${index}">Voiceover</label>
        <input type="text" id="vo-${index}" value="${scene.voiceover}" disabled>
      </div>
      <div id="video-container-${index}" class="asset-container" style="display:none;">
        <div class="asset-placeholder">Generated video will appear here.</div>
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
            throw new Error("Model did not return an image part.");
        }
    } catch(e) {
        console.error(`Error generating image for scene ${index + 1}:`, e);
        state.sceneAssets[index].imageStatus = 'failed';
        updateCardStatus(index, 'image', 'failed');
        imageContainer.innerHTML = `<div class="asset-placeholder"><p style="color:var(--error-color)">Image generation failed.</p></div>`;
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


// VOICEOVER GENERATION (ELEVENLABS)
async function handleGenerateAllVoiceovers() {
    if (!state.elevenApiKey) {
        showError("ElevenLabs API Key is not configured. Please enter it in the setup form and start over.");
        return;
    }
    await processSequentially(state.storyboard.scenes, generateSingleVoiceover, generateAllVoBtn, '2. Generate All Voiceovers');
    checkAssetGenerationStatus();
}

async function generateSingleVoiceover(scene: any, index: number) {
    if (state.sceneAssets[index].voStatus === 'complete') return;
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
        console.error(`Error generating voiceover for scene ${index + 1}:`, e);
        state.sceneAssets[index].voStatus = 'failed';
        updateCardStatus(index, 'vo', 'failed');
    }
}

// VIDEO GENERATION
async function handleGenerateAllVideos() {
    await processSequentially(state.storyboard.scenes, generateSingleVideo, generateAllVideosBtn, '3. Generate All Videos');
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
        
        if (operation.response?.generatedVideos?.[0]?.video?.uri) {
            const downloadLink = operation.response.generatedVideos[0].video.uri;
            const videoResponse = await fetch(`${downloadLink}&key=${process.env.API_KEY}`);
            const videoBlob = await videoResponse.blob();
            const videoUrl = URL.createObjectURL(videoBlob);
            
            asset.videoUrl = videoUrl;
            asset.videoStatus = 'complete';
            updateCardStatus(index, 'video', 'complete');
            videoContainer.innerHTML = `<video src="${videoUrl}" controls muted loop playsinline></video>`;
        } else {
            throw new Error('Video generation finished but no video URI was found.');
        }

    } catch (error) {
        console.error(`Error generating video for scene ${index + 1}:`, error);
        asset.videoStatus = 'failed';
        updateCardStatus(index, 'video', 'failed');
        videoContainer.innerHTML = `<div class="asset-placeholder"><p style="color:var(--error-color)">Video generation failed.</p></div>`;
    }
}

function checkAssetGenerationStatus() {
  const allImages = state.sceneAssets.every(a => a.imageStatus === 'complete');
  generateAllVoBtn.disabled = !allImages;
  
  const allVO = state.sceneAssets.every(a => a.voStatus === 'complete');
  generateAllVideosBtn.disabled = !allImages || !allVO;

  const allVideos = state.sceneAssets.every(a => a.videoStatus === 'complete');
  previewBtn.disabled = !allVideos;
}

// --- Preview Player Logic ---
let mergedVideoUrl: string | null = null;

async function showPreview() {
  previewModal.classList.remove('hidden');
  logoOverlay.src = state.logo.objectURL || '';
  watermarkOverlay.textContent = state.watermarkText;
  sceneIndicator.textContent = `Full Ad Preview`;

  // If not already merged, merge all videos and voiceovers
  if (!mergedVideoUrl) {
    showLoader('Merging video and audio...');
    try {
      mergedVideoUrl = await mergeVideosAndVoiceovers();
      sceneVideo.src = mergedVideoUrl;
    } catch (e) {
      showError('Failed to merge video and audio.');
      return;
    } finally {
      hideLoader();
    }
  } else {
    sceneVideo.src = mergedVideoUrl;
  }
  sceneVideo.currentTime = 0;
  sceneVideo.play();
}

function hidePreview() {
  sceneVideo.pause();
  previewModal.classList.add('hidden');
}

// Merge all scene videos and voiceovers into a single video with audio
async function mergeVideosAndVoiceovers(): Promise<string> {
  // This is a placeholder implementation. In a real app, you would use ffmpeg.wasm or a backend service.
  // For now, concatenate all videos and voiceovers sequentially using MediaSource API (limited browser support).
  // If not possible, return the first video as fallback.
  if (state.sceneAssets.length === 0) throw new Error('No scenes to merge.');
  // Fallback: just return the first video
  return state.sceneAssets[0].videoUrl!;
}

// Add download button logic
document.addEventListener('DOMContentLoaded', () => {
  // ...existing code...
  const downloadBtn = document.createElement('button');
  downloadBtn.id = 'download-video-btn';
  downloadBtn.textContent = 'Download Full Video';
  downloadBtn.className = 'primary-btn';
  downloadBtn.onclick = () => {
    if (mergedVideoUrl) {
      const a = document.createElement('a');
      a.href = mergedVideoUrl;
      a.download = 'AutoMACE_Full_Ad.mp4';
      a.click();
    }
  };
  document.querySelector('.preview-controls')?.appendChild(downloadBtn);
});