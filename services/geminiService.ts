import { GoogleGenAI } from "@google/genai";
import { TimelineSegment } from '../types';

const getClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API Key is missing from environment variables");
  }
  return new GoogleGenAI({ apiKey });
};

// Generate a "Style Bible" based on the full script to ensure consistency
export const generateStyleBible = async (
  fullScript: string,
  systemInstruction: string
): Promise<string> => {
  try {
    const ai = getClient();
    const model = 'gemini-2.0-flash-exp'; // Use a strong model for reasoning

    const prompt = `
      TASK: Create a "Visual Style Base" for a video based on this script.
      FULL SCRIPT: "${fullScript.substring(0, 10000)}"

      OUTPUT REQUIREMENTS:
      1. Main Character Description (detailed physical features, clothing, age).
      2. Setting/Environment Style (lighting, era, colors).
      3. Art Style (e.g., "Cinematic 35mm", "Cyberpunk Anime", "Oil Painting").
      4. Camera Language (e.g., "Wide angles", "Close ups").

      Keep it concise (approx 150 words). This text will be used to instruct an image generator for every single frame to ensure consistency.
    `;

    const response = await ai.models.generateContent({
      model: model,
      contents: { parts: [{ text: prompt }] },
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.5,
      }
    });

    return response.text?.trim() || "Cinematic, photorealistic, consistent character.";
  } catch (error) {
    console.error("Style Bible Error:", error);
    return "Cinematic, photorealistic, consistent character.";
  }
};

export const generatePromptForSegment = async (
  segment: TimelineSegment, 
  systemInstruction: string,
  styleBible: string,
  previousVisualContext: string
): Promise<string> => {
  try {
    const ai = getClient();
    const model = 'gemini-3-flash-preview';

    // Construct a context-aware prompt
    const content = `
      CURRENT INPUT SCRIPT SEGMENT: "${segment.originalText}"
      TIMESTAMP: ${segment.startTime} seconds.

      GLOBAL VISUAL STYLE (THE BIBLE - MUST FOLLOW):
      "${styleBible}"

      PREVIOUS SCENE CONTEXT (Connect to this):
      "${previousVisualContext || "Opening shot. Establish the scene based on the Style Bible."}"

      TASK:
      Generate a detailed image prompt for this specific script segment.
      
      STRICT RULES:
      1. CONSISTENCY IS KING. You MUST use the "GLOBAL VISUAL STYLE" for character details (face, clothes) and setting.
      2. If the character from the Style Bible is in this scene, describe them EXACTLY the same way.
      3. CONTINUITY: If the previous scene had specific lighting or position, transition logically.
      4. NO TEXT in the image.
      5. Output ONLY the raw image prompt text. No "Style Bible:" prefix. Just the description.
    `;

    const response = await ai.models.generateContent({
      model: model,
      contents: content,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.7,
        maxOutputTokens: 300,
      }
    });

    return response.text || "Failed to generate prompt.";
  } catch (error) {
    console.error("Gemini Prompt Error:", error);
    return `Error generating prompt: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
};

export const generateImageFromPrompt = async (prompt: string): Promise<string | undefined> => {
  try {
    const ai = getClient();
    // Using gemini-2.5-flash-image for generation
    const model = 'gemini-2.5-flash-image';

    const response = await ai.models.generateContent({
      model: model,
      contents: {
        parts: [{ text: prompt }]
      },
      config: {
        // No responseMimeType for image models
      }
    });

    // Extract image from response parts
    const candidates = response.candidates;
    if (candidates && candidates[0] && candidates[0].content && candidates[0].content.parts) {
        for (const part of candidates[0].content.parts) {
            if (part.inlineData && part.inlineData.data) {
                return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
            }
        }
    }
    return undefined;
  } catch (error) {
    console.error("Gemini Image Generation Error:", error);
    throw error;
  }
};

export const editImageWithFeedback = async (
  base64Image: string, 
  originalPrompt: string,
  feedback: string
): Promise<string | undefined> => {
  try {
    const ai = getClient();
    const model = 'gemini-2.5-flash-image';
    
    // Clean base64 string if it has prefix
    const data = base64Image.replace(/^data:image\/\w+;base64,/, "");
    
    const response = await ai.models.generateContent({
      model: model,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: 'image/png', // Assuming PNG or matching source
              data: data
            }
          },
          {
            text: `Original Prompt: ${originalPrompt}. \n\nInstruction: Modify the image. ${feedback}`
          }
        ]
      }
    });

    const candidates = response.candidates;
    if (candidates && candidates[0] && candidates[0].content && candidates[0].content.parts) {
        for (const part of candidates[0].content.parts) {
            if (part.inlineData && part.inlineData.data) {
                return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
            }
        }
    }
    return undefined;
  } catch (error) {
    console.error("Gemini Image Edit Error:", error);
    throw error;
  }
};

export const generateVideoTransition = async (
  startImageBase64: string, 
  endImageBase64: string,
  promptContext: string
): Promise<string | undefined> => {
  try {
    // Note: Creating a new client instance is recommended for Veo operations to ensure fresh key usage if selecting keys.
    const ai = getClient();
    const model = 'veo-3.1-fast-generate-preview'; // Using fast preview for speed

    // Clean base64 strings
    const startData = startImageBase64.replace(/^data:image\/\w+;base64,/, "");
    const endData = endImageBase64.replace(/^data:image\/\w+;base64,/, "");

    console.log("Starting video generation...");
    
    let operation = await ai.models.generateVideos({
      model: model,
      prompt: `Cinematic transition. ${promptContext}`, // Prompt is optional but helps context
      image: {
        imageBytes: startData,
        mimeType: 'image/png',
      },
      config: {
        numberOfVideos: 1,
        resolution: '720p',
        aspectRatio: '9:16', // Changed to 9:16 to match VSL vertical format request
        lastFrame: {
            imageBytes: endData,
            mimeType: 'image/png'
        }
      }
    });

    // Poll for completion
    while (!operation.done) {
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5s
      operation = await ai.operations.getVideosOperation({operation: operation});
      console.log("Video polling...", operation.metadata);
    }

    const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
    if (!downloadLink) return undefined;

    // Fetch the actual bytes using the key
    const response = await fetch(`${downloadLink}&key=${process.env.API_KEY}`);
    const blob = await response.blob();
    return URL.createObjectURL(blob);

  } catch (error) {
    console.error("Gemini Video Generation Error:", error);
    throw error;
  }
};