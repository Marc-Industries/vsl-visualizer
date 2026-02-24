/**
 * Webhook Service
 * Handles sending workflow data to the configured webhook endpoint
 */

export interface WebhookPayload {
    type: 'SRT' | 'PROMPTS';
    content: string | string[];
    sampling_sec?: number;
    user_agent_prompt?: string;
    callback_url: string;
}

export interface WebhookResponse {
    success: boolean;
    message?: string;
    data?: any;
}

/**
 * Send workflow data to the configured webhook
 * @param webhookUrl - The webhook endpoint URL
 * @param payload - The data to send
 * @throws Error if the request fails
 */
export async function sendToWebhook(
    webhookUrl: string,
    payload: WebhookPayload
): Promise<WebhookResponse> {
    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            throw new Error(
                `Webhook request failed: ${response.status} ${response.statusText}`
            );
        }

        const data = await response.json();
        return {
            success: true,
            data,
        };
    } catch (error) {
        if (error instanceof Error) {
            throw new Error(`Failed to send data to webhook: ${error.message}`);
        }
        throw new Error('Failed to send data to webhook: Unknown error');
    }
}

/**
 * Build webhook payload for SRT mode
 */
export function buildSRTPayload(
    srtContent: string,
    samplingSeconds: number,
    userAgentPrompt: string
): WebhookPayload {
    return {
        type: 'SRT',
        content: srtContent,
        sampling_sec: samplingSeconds,
        user_agent_prompt: userAgentPrompt,
        callback_url: '/api/v1/update-status',
    };
}

/**
 * Build webhook payload for Direct Prompts mode
 */
export function buildDirectPromptsPayload(
    prompts: string[],
    samplingSeconds: number,
    userAgentPrompt: string
): WebhookPayload {
    return {
        type: 'PROMPTS',
        content: prompts,
        sampling_sec: samplingSeconds,
        user_agent_prompt: userAgentPrompt,
        callback_url: '/api/v1/update-status',
    };
}
