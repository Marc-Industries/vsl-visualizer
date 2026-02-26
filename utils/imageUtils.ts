const BRIDGE_URL = import.meta.env.VITE_BRIDGE_URL || 'http://localhost:3001';

export const getProxiedImageUrl = (url?: string) => {
    if (!url) return undefined;
    if (url.includes('drive.google.com')) {
        return `${BRIDGE_URL}/proxy/image-drive?url=${encodeURIComponent(url)}`;
    }
    return url;
};
